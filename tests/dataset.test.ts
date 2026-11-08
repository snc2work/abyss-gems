import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_MIX, parseMix, planGame, type DatasetPlan } from '../src/dataset/plan';
import { ruleEngine } from '../src/engine';
import { buildRecord, toJsonlLine } from '../src/logger';
import { createAi, NoisyPlayer } from '../src/players';

const plan: DatasetPlan = { baseSeed: 1, mix: parseMix(DEFAULT_MIX), noise: 0.1, valPercent: 10, chunkGames: 200 };

describe('dataset plan', () => {
  it('gives the same game for the same index', () => {
    expect(planGame(plan, 42)).toEqual(planGame(plan, 42));
  });

  it('follows the mix, the validation share and the noise share', () => {
    const games = Array.from({ length: 5000 }, (_, index) => planGame(plan, index));
    const share = (test: (game: (typeof games)[number]) => boolean) => games.filter(test).length / games.length;
    expect(share((game) => game.p1 === 'chain' && game.p2 === 'chain')).toBeCloseTo(0.4, 1);
    expect(share((game) => game.split === 'val')).toBeCloseTo(0.1, 1);
    expect(share((game) => game.noise > 0)).toBeCloseTo(0.5, 1);
    expect(share((game) => game.p1 === 'random' && game.p2 === 'greedy')).toBeCloseTo(0.075, 1);
    expect(share((game) => game.p1 === 'greedy' && game.p2 === 'random')).toBeCloseTo(0.075, 1);
  });

  it('rejects a bad mix', () => {
    expect(() => parseMix('chain-nobody:3')).toThrow();
    expect(() => parseMix('chain-greedy')).toThrow();
    expect(() => parseMix('chain-greedy:0')).toThrow();
  });
});

describe('NoisyPlayer', () => {
  it('only plays legal moves and differs from the player it wraps', async () => {
    const state = ruleEngine.initState(3);
    const legal = ruleEngine.legalMoves(state, 0);
    const inner = createAi('greedy', ruleEngine, 3, 0);
    const noisy = new NoisyPlayer(inner, 1, 3, 1);
    const moves = await Promise.all(Array.from({ length: 30 }, () => noisy.chooseMove(state, legal)));
    for (const { move } of moves) expect(legal).toContainEqual(move);
    expect(new Set(moves.map(({ move }) => `${move.column}/${move.rotation}`)).size).toBeGreaterThan(1);
  });

  it('never interferes at a rate of zero', async () => {
    const state = ruleEngine.initState(3);
    const legal = ruleEngine.legalMoves(state, 0);
    const plain = await createAi('greedy', ruleEngine, 3, 0).chooseMove(state, legal);
    const wrapped = await new NoisyPlayer(createAi('greedy', ruleEngine, 3, 0), 0, 3, 1).chooseMove(state, legal);
    expect(wrapped).toEqual(plain);
  });
});

describe('dataset command', () => {
  const root = mkdtempSync(join(tmpdir(), 'abyss-dataset-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const FAST = ['--mix', 'random-random:1,random-greedy:1', '--chunk-games', '5', '--val', '20'];

  function run(out: string, ...args: string[]) {
    return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/dataset.ts', '--out', out, ...FAST, ...args], { encoding: 'utf8' });
  }

  function hashes(dir: string): Record<string, string> {
    return Object.fromEntries(
      readdirSync(dir)
        .filter((name) => name.endsWith('.jsonl'))
        .map((name) => [name, createHash('sha256').update(readFileSync(join(dir, name))).digest('hex')]),
    );
  }

  it('resumes to the same bytes as one straight run, and keeps games apart by split', () => {
    const straight = join(root, 'straight');
    const resumed = join(root, 'resumed');
    expect(run(straight, '--games', '12').status).toBe(0);
    expect(run(resumed, '--games', '7').status).toBe(0);
    const second = run(resumed, '--games', '12');
    expect(second.status).toBe(0);
    expect(second.stdout).toContain('resuming: 5 of 12');

    expect(hashes(resumed)).toEqual(hashes(straight));
    const manifest = JSON.parse(readFileSync(join(resumed, 'manifest.json'), 'utf8'));
    expect(manifest.totals.games).toBe(12);

    const seedsOf = (prefix: string) =>
      new Set(
        readdirSync(resumed)
          .filter((name) => name.startsWith(prefix))
          .flatMap((name) => readFileSync(join(resumed, name), 'utf8').trim().split('\n'))
          .map((line) => JSON.parse(line).seed),
      );
    const train = seedsOf('train-');
    const val = seedsOf('val-');
    expect(train.size + val.size).toBe(12);
    expect([...train].filter((seed) => val.has(seed))).toEqual([]);
    expect(readdirSync(resumed).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  }, 60000);

  it('continues after a run was stopped during its first chunk', () => {
    const out = join(root, 'first-chunk');
    mkdirSync(out);
    writeFileSync(join(out, 'train-00000.jsonl.tmp'), 'partial');
    expect(run(out, '--games', '3').status).toBe(0);
    expect(readdirSync(out).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  }, 60000);

  it('will not write into a folder holding other files', () => {
    const out = join(root, 'occupied');
    mkdirSync(out);
    writeFileSync(join(out, 'notes.txt'), 'keep me');
    expect(run(out, '--games', '1').status).toBe(1);
  }, 60000);

  it('refuses to mix settings in one folder', () => {
    const out = join(root, 'settings');
    expect(run(out, '--games', '2').status).toBe(0);
    const other = run(out, '--games', '2', '--noise', '0.5');
    expect(other.status).toBe(1);
    expect(other.stderr).toContain('other settings');
  }, 60000);
});

describe('the sample game in docs/samples', () => {
  const records = readFileSync('docs/samples/sample-game.jsonl', 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

  it('replays exactly on the current rules', () => {
    let state = ruleEngine.initState(records[0].seed);
    for (const record of records) {
      const result = ruleEngine.step(state, record.move);
      expect(toJsonlLine(buildRecord(state, record.move, result))).toBe(JSON.stringify(record));
      state = result.next;
    }
    expect(state.winner).toBe(records.at(-1).events.winner);
  });

  it('follows the relations between lines that the document describes', () => {
    records.forEach((record, index) => {
      const { events } = record;
      expect(record.frames[0].kind).toBe('place');
      expect(record.frames.filter((frame: { kind: string }) => frame.kind === 'clear').length).toBe(events.chains);

      const following = records[index + 1];
      if (!following) {
        expect(events.winner).not.toBeNull();
        return;
      }
      expect(events.winner).toBeNull();
      expect(following.player).toBe(1 - record.player);
      expect(following.board_self).toEqual(record.next_board_opp);
      expect(following.board_opp).toEqual(record.next_board_self);
      expect(following.garbage_pending.self).toBe(events.garbageSent + events.garbagePressure);
      expect(following.garbage_pending.opp).toBe(record.garbage_pending.self - events.garbageOffset);
      if (records[index + 2]) expect(records[index + 2].pair).toEqual(record.next);
    });
  });
});

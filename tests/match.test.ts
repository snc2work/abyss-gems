import { describe, expect, it } from 'vitest';
import { ruleEngine, type StepResult, type GameState } from '../src/engine';
import { runMatch } from '../src/game/match';
import { buildRecord, toJsonlLine } from '../src/logger';
import { createAi, type AiKind, type Decision } from '../src/players';

async function playToJsonl(seed: number, p1: AiKind, p2: AiKind): Promise<string[]> {
  const lines: string[] = [];
  await runMatch({
    engine: ruleEngine,
    players: [createAi(p1, ruleEngine, seed, 0), createAi(p2, ruleEngine, seed, 1)],
    seed,
    maxTurns: 5000,
    hooks: {
      onStep: (before: GameState, decision: Decision, result: StepResult) => {
        lines.push(toJsonlLine(buildRecord(before, decision.move, result)));
      },
    },
  });
  return lines;
}

describe('runMatch', () => {
  it('reaches a winner and reproduces the same log from the same seed', async () => {
    const first = await playToJsonl(7, 'random', 'greedy');
    const second = await playToJsonl(7, 'random', 'greedy');
    expect(first.length).toBeGreaterThan(0);
    expect(first).toEqual(second);
    expect(JSON.parse(first.at(-1)!).events.winner).not.toBeNull();
  });

  it('gives a different match for a different seed', async () => {
    expect(await playToJsonl(7, 'random', 'random')).not.toEqual(await playToJsonl(8, 'random', 'random'));
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runMatch({
      engine: ruleEngine,
      players: [createAi('random', ruleEngine, 1, 0), createAi('random', ruleEngine, 1, 1)],
      seed: 1,
      signal: controller.signal,
    });
    expect(result.aborted).toBe(true);
    expect(result.turns).toBe(0);
  });
});

describe('GreedyPlayer', () => {
  it('beats the random player most of the time', async () => {
    let wins = 0;
    const games = 30;
    for (let seed = 0; seed < games; seed++) {
      const result = await runMatch({
        engine: ruleEngine,
        players: [createAi('random', ruleEngine, seed, 0), createAi('greedy', ruleEngine, seed, 1)],
        seed,
        maxTurns: 5000,
      });
      if (result.winner === 1) wins++;
    }
    expect(wins).toBeGreaterThan(games * 0.8);
  });
});

describe('ChainPlayer', () => {
  it('builds longer chains than the greedy player and beats it', async () => {
    let wins = 0;
    let bestChain = 0;
    const games = 6;
    for (let seed = 0; seed < games; seed++) {
      const result = await runMatch({
        engine: ruleEngine,
        players: [createAi('chain', ruleEngine, seed, 0), createAi('greedy', ruleEngine, seed, 1)],
        seed,
        maxTurns: 5000,
        hooks: {
          onStep: (before, _decision, stepResult) => {
            if (before.current === 0) bestChain = Math.max(bestChain, stepResult.events.chains);
          },
        },
      });
      if (result.winner === 0) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(5);
    expect(bestChain).toBeGreaterThanOrEqual(4);
  }, 60000);

  it('fires what it has instead of waiting when heavy garbage is announced', async () => {
    const start = ruleEngine.initState(1);
    const board = start.players[0].board.map((row) => [...row]);
    const bottom = board.length - 1;
    // Placing the pair of 1s on column 1 sets off a two-step chain.
    [[bottom, 0, 1], [bottom - 1, 0, 1], [bottom - 2, 0, 2], [bottom - 3, 0, 2], [bottom, 1, 2], [bottom, 2, 2], [bottom, 3, 2]].forEach(
      ([row, col, color]) => {
        board[row][col] = color;
      },
    );
    const players = [...start.players] as GameState['players'];
    players[0] = { ...players[0], board, pair: [1, 1], pending: 40 };
    const state: GameState = { ...start, players };

    const player = createAi('chain', ruleEngine, 1, 0);
    const { move } = await player.chooseMove(state, ruleEngine.legalMoves(state, 0));
    expect(ruleEngine.step(state, move).events.garbageOffset).toBeGreaterThan(0);
  });

  it('plays the same match from the same seed', async () => {
    const first = await playToJsonl(11, 'chain', 'chain');
    expect(first).toEqual(await playToJsonl(11, 'chain', 'chain'));
  }, 60000);
});

describe('log record', () => {
  it('contains every required field, seen from the mover', async () => {
    const [line] = await playToJsonl(3, 'greedy', 'greedy');
    const record = JSON.parse(line);
    expect(Object.keys(record)).toEqual([
      'seed', 'turn', 'player', 'board_self', 'board_opp', 'pair', 'next',
      'garbage_pending', 'move', 'frames', 'next_board_self', 'next_board_opp', 'events',
    ]);
    expect(record.seed).toBe(3);
    expect(record.player).toBe(0);
    expect(record.frames[0].kind).toBe('place');
  });
});

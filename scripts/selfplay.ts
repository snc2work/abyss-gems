// Generates a JSONL dataset without a browser.
//   npm run selfplay -- --games 10000 --p1 random --p2 greedy

import { once } from 'node:events';
import { createWriteStream, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { ruleEngine } from '../src/engine';
import { runMatch } from '../src/game/match';
import { buildRecord, toJsonlLine } from '../src/logger';
import { AI_KINDS, createAi, isAiKind, type AiKind } from '../src/players';

const MAX_TURNS = 5000;

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function aiKind(value: string, flag: string): AiKind {
  if (!isAiKind(value)) fail(`${flag} must be one of: ${AI_KINDS.join(', ')}`);
  return value;
}

function integer(value: string, flag: string, min: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) fail(`${flag} must be an integer >= ${min}`);
  return parsed;
}

const { values } = parseArgs({
  options: {
    games: { type: 'string', default: '100' },
    p1: { type: 'string', default: 'random' },
    p2: { type: 'string', default: 'greedy' },
    seed: { type: 'string', default: '1' },
    out: { type: 'string' },
  },
});

const games = integer(values.games, '--games', 1);
const baseSeed = integer(values.seed, '--seed', 0);
const p1 = aiKind(values.p1, '--p1');
const p2 = aiKind(values.p2, '--p2');
const outPath = values.out ?? `data/selfplay-${p1}-vs-${p2}-${games}.jsonl`;

mkdirSync(dirname(outPath), { recursive: true });
const stream = createWriteStream(outPath);

const wins = [0, 0];
let unfinished = 0;
let totalTurns = 0;
const startedAt = Date.now();

for (let game = 0; game < games; game++) {
  const seed = baseSeed + game;
  const result = await runMatch({
    engine: ruleEngine,
    players: [createAi(p1, ruleEngine, seed, 0), createAi(p2, ruleEngine, seed, 1)],
    seed,
    maxTurns: MAX_TURNS,
    hooks: {
      onStep: async (before, decision, stepResult) => {
        const line = toJsonlLine(buildRecord(before, decision.move, stepResult));
        if (!stream.write(`${line}\n`)) await once(stream, 'drain');
      },
    },
  });
  totalTurns += result.turns;
  if (result.winner === null) unfinished++;
  else wins[result.winner]++;
}

stream.end();
await once(stream, 'finish');

const seconds = (Date.now() - startedAt) / 1000;
const megabytes = statSync(outPath).size / 1024 / 1024;
console.log(`games      ${games} (seeds ${baseSeed}..${baseSeed + games - 1})`);
console.log(`p1 ${p1.padEnd(7)} ${wins[0]} wins`);
console.log(`p2 ${p2.padEnd(7)} ${wins[1]} wins`);
if (unfinished > 0) console.log(`unfinished ${unfinished} (hit the ${MAX_TURNS} turn limit)`);
console.log(`turns      ${totalTurns} (avg ${(totalTurns / games).toFixed(1)})`);
console.log(`time       ${seconds.toFixed(1)}s (${(games / seconds).toFixed(1)} games/s)`);
console.log(`output     ${outPath} (${megabytes.toFixed(1)} MB)`);

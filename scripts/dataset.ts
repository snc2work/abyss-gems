// Generates a training dataset without a browser. Stopping is safe: running the
// same command again continues from the last finished chunk.
//   npm run dataset -- --games 10000 --out data/v1

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { CONFIG, ruleEngine, type PlayerId } from '../src/engine';
import { createGamePlayers, DEFAULT_MIX, parseMix, planGame, type DatasetPlan, type Split } from '../src/dataset/plan';
import { runMatch } from '../src/game/match';
import { buildRecord, toJsonlLine } from '../src/logger';

const FORMAT_VERSION = 1;
const MAX_TURNS = 5000;
const SPLITS: readonly Split[] = ['train', 'val'];
const DATA_FILE = /^(train|val)-\d+\.jsonl(\.tmp)?$/;
/** The rules as plain data; formulas are kept as their source text. */
const RULES = JSON.parse(JSON.stringify(CONFIG, (_key, value: unknown) => (typeof value === 'function' ? value.toString() : value))) as unknown;

interface FileEntry {
  split: Split;
  file: string;
  games: number;
  moves: number;
  bytes: number;
}

interface GameEntry {
  seed: number;
  p1: string;
  p2: string;
  noise: number;
  split: Split;
  turns: number;
  winner: PlayerId | null;
  best_chain: number;
}

interface ChunkEntry {
  index: number;
  files: FileEntry[];
  games: GameEntry[];
  /** Number of moves that set off exactly this many chains. */
  chain_histogram: Record<string, number>;
}

interface Manifest {
  format_version: number;
  plan: DatasetPlan;
  config: unknown;
  totals: { games: number; moves: number; bytes: number; unfinished: number; chain_histogram: Record<string, number> };
  chunks: ChunkEntry[];
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function integer(value: string, flag: string, min: number, max = Infinity): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) fail(`${flag} must be an integer from ${min}${max === Infinity ? ' up' : ` to ${max}`}`);
  return parsed;
}

function parseDatasetMix(text: string): DatasetPlan['mix'] {
  try {
    return parseMix(text);
  } catch (error) {
    return fail((error as Error).message);
  }
}

const { values } = parseArgs({
  options: {
    games: { type: 'string', default: '100' },
    out: { type: 'string', default: 'data/dataset' },
    seed: { type: 'string', default: '1' },
    mix: { type: 'string', default: DEFAULT_MIX },
    noise: { type: 'string', default: '0.1' },
    val: { type: 'string', default: '10' },
    'chunk-games': { type: 'string', default: '200' },
  },
});

const games = integer(values.games, '--games', 1);
const outDir = values.out;
const noise = Number(values.noise);
if (!(noise >= 0 && noise <= 1)) fail('--noise must be between 0 and 1');
const plan: DatasetPlan = {
  baseSeed: integer(values.seed, '--seed', 0),
  mix: parseDatasetMix(values.mix),
  noise,
  valPercent: integer(values.val, '--val', 0, 100),
  chunkGames: integer(values['chunk-games'], '--chunk-games', 1),
};

const manifestPath = join(outDir, 'manifest.json');

/** Writes through a temporary file, so that a stopped run never leaves a partial file. */
function writeAtomically(path: string, text: string): void {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

function emptyManifest(): Manifest {
  return {
    format_version: FORMAT_VERSION,
    plan,
    config: RULES,
    totals: { games: 0, moves: 0, bytes: 0, unfinished: 0, chain_histogram: {} },
    chunks: [],
  };
}

function loadManifest(): Manifest {
  if (!existsSync(manifestPath)) {
    // Files from a run stopped during its first chunk get regenerated, so they may stay.
    const foreign = existsSync(outDir) ? readdirSync(outDir).filter((name) => !DATA_FILE.test(name)) : [];
    if (foreign.length > 0) fail(`${outDir} has other files but no manifest.json; choose another --out`);
    return emptyManifest();
  }
  const saved = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const sameSettings =
    saved.format_version === FORMAT_VERSION &&
    JSON.stringify(saved.plan) === JSON.stringify(plan) &&
    JSON.stringify(saved.config) === JSON.stringify(RULES);
  if (!sameSettings) fail(`${outDir} was made with other settings or rules; choose another --out`);
  return saved;
}

function addCounts(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, count] of Object.entries(source)) target[key] = (target[key] ?? 0) + count;
}

function updateTotals(manifest: Manifest): void {
  manifest.chunks.sort((a, b) => a.index - b.index);
  const totals: Manifest['totals'] = { games: 0, moves: 0, bytes: 0, unfinished: 0, chain_histogram: {} };
  for (const chunk of manifest.chunks) {
    totals.games += chunk.games.length;
    totals.unfinished += chunk.games.filter((game) => game.winner === null).length;
    for (const file of chunk.files) {
      totals.moves += file.moves;
      totals.bytes += file.bytes;
    }
    addCounts(totals.chain_histogram, chunk.chain_histogram);
  }
  manifest.totals = totals;
}

async function generateChunk(chunkIndex: number, firstGame: number, count: number): Promise<ChunkEntry> {
  const label = String(chunkIndex).padStart(5, '0');
  const open = new Map<Split, { fd: number; path: string; name: string; games: number; moves: number }>();
  const entry: ChunkEntry = { index: chunkIndex, files: [], games: [], chain_histogram: {} };

  const outputFor = (split: Split) => {
    let output = open.get(split);
    if (!output) {
      const name = `${split}-${label}.jsonl`;
      const path = join(outDir, name);
      output = { fd: openSync(`${path}.tmp`, 'w'), path, name, games: 0, moves: 0 };
      open.set(split, output);
    }
    return output;
  };

  for (let index = firstGame; index < firstGame + count; index++) {
    const game = planGame(plan, index);
    const output = outputFor(game.split);
    let bestChain = 0;
    const result = await runMatch({
      engine: ruleEngine,
      players: createGamePlayers(ruleEngine, game),
      seed: game.seed,
      maxTurns: MAX_TURNS,
      hooks: {
        onStep: (before, decision, stepResult) => {
          writeSync(output.fd, `${toJsonlLine(buildRecord(before, decision.move, stepResult))}\n`);
          output.moves++;
          const { chains } = stepResult.events;
          bestChain = Math.max(bestChain, chains);
          entry.chain_histogram[chains] = (entry.chain_histogram[chains] ?? 0) + 1;
        },
      },
    });
    output.games++;
    entry.games.push({
      seed: game.seed,
      p1: game.p1,
      p2: game.p2,
      noise: game.noise,
      split: game.split,
      turns: result.turns,
      winner: result.winner,
      best_chain: bestChain,
    });
  }

  for (const split of SPLITS) {
    const output = open.get(split);
    if (!output) continue;
    closeSync(output.fd);
    renameSync(`${output.path}.tmp`, output.path);
    entry.files.push({ split, file: output.name, games: output.games, moves: output.moves, bytes: statSync(output.path).size });
  }
  return entry;
}

const manifest = loadManifest();
mkdirSync(outDir, { recursive: true });

const chunkCount = Math.ceil(games / plan.chunkGames);
const startedAt = Date.now();
let doneThisRun = 0;
const toGenerate: { index: number; first: number; count: number }[] = [];
for (let index = 0; index < chunkCount; index++) {
  const first = index * plan.chunkGames;
  const count = Math.min(plan.chunkGames, games - first);
  const saved = manifest.chunks.find((chunk) => chunk.index === index);
  // A short last chunk from a smaller earlier run gets replaced by the full one.
  if (!saved || saved.games.length < count) toGenerate.push({ index, first, count });
}
const gamesToPlay = toGenerate.reduce((sum, chunk) => sum + chunk.count, 0);
if (gamesToPlay < games) console.log(`resuming: ${games - gamesToPlay} of ${games} games are already done`);

for (const { index, first, count } of toGenerate) {
  const chunk = await generateChunk(index, first, count);
  manifest.chunks = manifest.chunks.filter((saved) => saved.index !== index);
  manifest.chunks.push(chunk);
  updateTotals(manifest);
  writeAtomically(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);

  doneThisRun += count;
  const seconds = (Date.now() - startedAt) / 1000;
  const minutesLeft = ((gamesToPlay - doneThisRun) * seconds) / doneThisRun / 60;
  console.log(`chunk ${index + 1}/${chunkCount}  ${doneThisRun}/${gamesToPlay} games  ${(doneThisRun / seconds).toFixed(1)} games/s  about ${minutesLeft.toFixed(1)} min left`);
}

const { totals } = manifest;
const seconds = (Date.now() - startedAt) / 1000;
console.log(`games      ${totals.games}`);
console.log(`moves      ${totals.moves}`);
if (totals.unfinished > 0) console.log(`unfinished ${totals.unfinished} (hit the ${MAX_TURNS} turn limit)`);
console.log(`chains     ${JSON.stringify(totals.chain_histogram)}`);
console.log(`time       ${seconds.toFixed(1)}s this run`);
console.log(`output     ${outDir} (${(totals.bytes / 1024 / 1024).toFixed(1)} MB)`);

// Decides how each game of a dataset is played. Everything here depends only on
// the plan and the game's index, so a dataset can be resumed or extended later.

import type { EngineApi, PlayerId } from '../engine';
import { Prng } from '../lib/prng';
import { AI_KINDS, createAi, isAiKind, NoisyPlayer, type AiKind, type Player } from '../players';

export const DEFAULT_MIX = 'chain-chain:40,chain-greedy:20,greedy-greedy:15,random-greedy:15,random-random:10';

const PLAN_SALT = 7000;
const NOISE_SALT = 7100;

export interface MixEntry {
  p1: AiKind;
  p2: AiKind;
  weight: number;
}

export interface DatasetPlan {
  baseSeed: number;
  mix: MixEntry[];
  /** Share of moves replaced by a random move, in the games that use noise. */
  noise: number;
  /** Percentage of games held out for validation. */
  valPercent: number;
  chunkGames: number;
}

export type Split = 'train' | 'val';

export interface GamePlan {
  index: number;
  seed: number;
  p1: AiKind;
  p2: AiKind;
  noise: number;
  split: Split;
}

/** Parses text such as `chain-chain:40,random-greedy:10`. */
export function parseMix(text: string): MixEntry[] {
  const mix = text.split(',').map((part): MixEntry => {
    const match = /^(\w+)-(\w+):(\d+)$/.exec(part.trim());
    if (!match || !isAiKind(match[1]) || !isAiKind(match[2]) || Number(match[3]) < 1) {
      throw new Error(`bad mix entry "${part}": expected <p1>-<p2>:<weight> with ${AI_KINDS.join(', ')}`);
    }
    return { p1: match[1], p2: match[2], weight: Number(match[3]) };
  });
  return mix;
}

function pickMatchup(mix: MixEntry[], roll: number): MixEntry {
  let rest = roll;
  for (const entry of mix) {
    rest -= entry.weight;
    if (rest < 0) return entry;
  }
  return mix[mix.length - 1];
}

export function planGame(plan: DatasetPlan, index: number): GamePlan {
  const seed = plan.baseSeed + index;
  const rng = new Prng(seed, PLAN_SALT);
  const totalWeight = plan.mix.reduce((sum, entry) => sum + entry.weight, 0);
  const matchup = pickMatchup(plan.mix, rng.int(totalWeight));
  // Both seats move first in turn, so swap them to avoid tying a player to one seat.
  const swapped = rng.int(2) === 1;
  // Half the games stay clean, because noise makes long chains rarer.
  const noisy = rng.int(2) === 1;
  const held = rng.int(100) < plan.valPercent;
  return {
    index,
    seed,
    p1: swapped ? matchup.p2 : matchup.p1,
    p2: swapped ? matchup.p1 : matchup.p2,
    noise: noisy ? plan.noise : 0,
    split: held ? 'val' : 'train',
  };
}

export function createGamePlayers(engine: EngineApi, game: GamePlan): [Player, Player] {
  const make = (kind: AiKind, seat: PlayerId): Player => {
    const player = createAi(kind, engine, game.seed, seat);
    // A random player's moves are all random already.
    return game.noise > 0 && kind !== 'random' ? new NoisyPlayer(player, game.noise, game.seed, NOISE_SALT + seat) : player;
  };
  return [make(game.p1, 0), make(game.p2, 1)];
}

import type { EngineApi, PlayerId } from '../engine';
import { ChainPlayer } from './chain';
import { GreedyPlayer } from './greedy';
import { RandomPlayer } from './random';
import type { Player } from './types';

export { ChainPlayer } from './chain';
export { GreedyPlayer } from './greedy';
export { HumanPlayer, type MoveInput } from './human';
export { NoisyPlayer } from './noisy';
export { RandomPlayer } from './random';
export type { Decision, Player } from './types';

export type AiKind = 'random' | 'greedy' | 'chain';
export const AI_KINDS: readonly AiKind[] = ['random', 'greedy', 'chain'];

export function isAiKind(value: string): value is AiKind {
  return (AI_KINDS as readonly string[]).includes(value);
}

/** Seat-specific salt keeps the two players' random streams independent. */
export function createAi(kind: AiKind, engine: EngineApi, seed: number, seat: PlayerId): Player {
  const salt = 1000 + seat;
  switch (kind) {
    case 'chain':
      return new ChainPlayer(engine, seed, salt);
    case 'greedy':
      return new GreedyPlayer(engine, seed, salt);
    case 'random':
      return new RandomPlayer(seed, salt);
  }
}

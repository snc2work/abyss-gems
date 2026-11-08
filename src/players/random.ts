import type { GameState, Move } from '../engine';
import { Prng } from '../lib/prng';
import type { Decision, Player } from './types';

const CANDIDATE_COUNT = 3;

export class RandomPlayer implements Player {
  readonly name = 'Random';
  private readonly rng: Prng;

  /** The seed makes the player part of the reproducible match. */
  constructor(seed: number, salt = 0) {
    this.rng = new Prng(seed, salt);
  }

  async chooseMove(_state: GameState, legalMoves: Move[]): Promise<Decision> {
    const candidates = this.rng.shuffled(legalMoves).slice(0, CANDIDATE_COUNT);
    return {
      move: candidates[0],
      candidates,
      thought: `${legalMoves.length} moves to choose from. This one, just because.`,
    };
  }
}

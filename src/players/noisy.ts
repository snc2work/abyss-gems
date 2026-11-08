import type { GameState, Move } from '../engine';
import { Prng } from '../lib/prng';
import type { Decision, Player } from './types';

const RESOLUTION = 1_000_000;

/**
 * Replaces some of another player's moves with a random legal move, so that a
 * dataset also shows what happens after moves a good player would never choose.
 */
export class NoisyPlayer implements Player {
  readonly name: string;
  private readonly rng: Prng;

  constructor(
    private readonly inner: Player,
    private readonly rate: number,
    seed: number,
    salt: number,
  ) {
    this.name = inner.name;
    this.rng = new Prng(seed, salt);
  }

  async chooseMove(state: GameState, legalMoves: Move[]): Promise<Decision> {
    const decision = await this.inner.chooseMove(state, legalMoves);
    if (this.rng.int(RESOLUTION) >= this.rate * RESOLUTION) return decision;
    return { move: legalMoves[this.rng.int(legalMoves.length)] };
  }
}

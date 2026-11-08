import type { GameState, Move } from '../engine';
import type { Decision, Player } from './types';

/** Supplied by the UI layer, which keeps this class free of DOM code. */
export interface MoveInput {
  select(state: GameState, legalMoves: Move[]): Promise<Move>;
}

export class HumanPlayer implements Player {
  readonly name = 'You';

  constructor(private readonly input: MoveInput) {}

  async chooseMove(state: GameState, legalMoves: Move[]): Promise<Decision> {
    return { move: await this.input.select(state, legalMoves) };
  }
}

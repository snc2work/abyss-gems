import type { GameState, Move } from '../engine';

export interface Decision {
  move: Move;
  /** Free-form reasoning shown in the thought bubble. */
  thought?: string;
  /** Moves the player considered; the UI previews each with `step`. */
  candidates?: Move[];
}

export interface Player {
  readonly name: string;
  chooseMove(state: GameState, legalMoves: Move[]): Promise<Decision>;
}

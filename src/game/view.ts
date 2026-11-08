// What the turn loop needs from a display. The renderer implements this,
// and the game layer never touches canvas or DOM directly.

import type { Board, BoardFrame, Events, GameState, Move, Pair, PlayerId } from '../engine';

export interface ThoughtItem {
  /** Shown instead of the move, for items that are not candidate moves. */
  title?: string;
  move: Move;
  /** The mover's board after trying this move with `step`. */
  board: Board;
  chains: number;
  cleared: number;
  sent: number;
  loses: boolean;
  chosen: boolean;
}

export interface ThoughtView {
  status: 'thinking' | 'decided';
  text: string;
  /** Replaces the default heading above the items. */
  heading?: string;
  /** A short result shown above the text, green when good and red otherwise. */
  verdict?: { text: string; good: boolean };
  items: ThoughtItem[];
}

export interface LanePiece {
  pair: Pair;
  move: Move;
}

export interface CellPosition {
  row: number;
  col: number;
}

export interface GhostCell extends CellPosition {
  color: number;
}

export interface MatchView {
  showState(state: GameState): void;
  setThought(player: PlayerId, thought: ThoughtView | null): void;
  setLanePiece(player: PlayerId, piece: LanePiece | null): void;
  setGhost(player: PlayerId, cells: GhostCell[] | null): void;
  playFrames(frames: BoardFrame[]): Promise<void>;
  noteEvents(events: Events): void;
}

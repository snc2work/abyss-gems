// Public data model of the rules. Everything here is plain JSON-serializable data.

/** board[row][col]. Row 0 is the hidden top row. 0 = empty, 1-4 = color, 5 = garbage. */
export type Board = number[][];

export type PlayerId = 0 | 1;

/** [axis color, child color]. */
export type Pair = [number, number];

/** Position of the child relative to the axis: 0 = up, 1 = right, 2 = down, 3 = left. */
export type Rotation = 0 | 1 | 2 | 3;

export interface Move {
  /** Column of the axis block. */
  column: number;
  rotation: Rotation;
}

export interface PlayerState {
  board: Board;
  pair: Pair;
  next: Pair;
  /** Index of `pair` in the shared pair sequence. */
  pairIndex: number;
  /** Garbage announced against this player. */
  pending: number;
}

export interface GameState {
  seed: number;
  /** PRNG state consumed by garbage placement. */
  rng: number;
  turn: number;
  current: PlayerId;
  players: [PlayerState, PlayerState];
  winner: PlayerId | null;
}

export type FrameKind = 'place' | 'fall' | 'clear' | 'garbage';

export interface ClearedCell {
  row: number;
  col: number;
  color: number;
}

export interface BoardFrame {
  kind: FrameKind;
  /** Whose board this frame shows. */
  player: PlayerId;
  /** The whole board after this frame. */
  board: Board;
  /** Chain count reached so far in this move. */
  chain: number;
  /** Only on `clear` frames: the cells removed by this frame. */
  cleared?: ClearedCell[];
}

export interface Events {
  player: PlayerId;
  /** Colored blocks cleared. */
  cleared: number;
  /** Garbage blocks cleared by being next to a cleared group. */
  clearedGarbage: number;
  chains: number;
  /** Garbage added to the opponent's announcement, after offsetting. */
  garbageSent: number;
  /** Garbage removed from the mover's own announcement. */
  garbageOffset: number;
  /** Garbage added to the opponent's announcement by the long-game pressure rule. */
  garbagePressure: number;
  /** Garbage that actually dropped on the opponent at the start of their turn. */
  garbageFallen: number;
  winner: PlayerId | null;
}

export interface StepResult {
  next: GameState;
  frames: BoardFrame[];
  events: Events;
}

/**
 * The only surface the rest of the app may use.
 * A learned world model can replace the rules by implementing this interface.
 */
export interface EngineApi {
  initState(seed: number): GameState;
  legalMoves(state: GameState, player: PlayerId): Move[];
  step(state: GameState, move: Move): StepResult;
}

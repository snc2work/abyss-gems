import type {
  Board,
  BoardFrame,
  Events,
  GameState,
  Move,
  Pair,
  PlayerId,
  StepResult,
} from '../engine';

/** One line of the JSONL dataset, written from the mover's point of view. */
export interface LogRecord {
  seed: number;
  turn: number;
  player: PlayerId;
  board_self: Board;
  board_opp: Board;
  pair: Pair;
  next: Pair;
  garbage_pending: { self: number; opp: number };
  move: Move;
  frames: BoardFrame[];
  next_board_self: Board;
  next_board_opp: Board;
  events: Events;
}

export function buildRecord(before: GameState, move: Move, result: StepResult): LogRecord {
  const player = before.current;
  const opponent: PlayerId = player === 0 ? 1 : 0;
  const self = before.players[player];
  const opp = before.players[opponent];
  return {
    seed: before.seed,
    turn: before.turn,
    player,
    board_self: self.board,
    board_opp: opp.board,
    pair: self.pair,
    next: self.next,
    garbage_pending: { self: self.pending, opp: opp.pending },
    move,
    frames: result.frames,
    next_board_self: result.next.players[player].board,
    next_board_opp: result.next.players[opponent].board,
    events: result.events,
  };
}

export function toJsonlLine(record: LogRecord): string {
  return JSON.stringify(record);
}

/** Keeps the lines of the current match in memory, for the download button. */
export class MemoryLog {
  private readonly lines: string[] = [];

  add(record: LogRecord): void {
    this.lines.push(toJsonlLine(record));
  }

  get size(): number {
    return this.lines.length;
  }

  toJsonl(): string {
    return this.lines.length === 0 ? '' : `${this.lines.join('\n')}\n`;
  }
}

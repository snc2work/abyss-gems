// The JSON a world model server receives and returns.

import { CONFIG, type Board, type BoardFrame, type GameState, type Move, type Pair, type PlayerId } from '../engine';

export class ModelError extends Error {}

/** One turn from the mover's point of view, with the same keys as a log line. */
export interface ModelRequest {
  player: PlayerId;
  turn: number;
  board_self: Board;
  board_opp: Board;
  pair: Pair;
  next: Pair;
  garbage_pending: { self: number; opp: number };
  move: Move;
}

const COUNT_KEYS = ['cleared', 'clearedGarbage', 'chains', 'garbageSent', 'garbageOffset', 'garbagePressure', 'garbageFallen'] as const;
export type CountKey = (typeof COUNT_KEYS)[number];

export interface ModelReply {
  next_board_self: Board;
  next_board_opp: Board;
  /** As in the next log line: `self` is the next mover, `opp` is the current mover. May be null once the game is over. */
  next_pending: { self: number; opp: number } | null;
  events: { winner: PlayerId | null } & Partial<Record<CountKey, number>>;
  frames?: BoardFrame[];
}

export function buildModelRequest(state: GameState, move: Move): ModelRequest {
  const player = state.current;
  const self = state.players[player];
  const opp = state.players[player === 0 ? 1 : 0];
  return {
    player,
    turn: state.turn,
    board_self: self.board,
    board_opp: opp.board,
    pair: self.pair,
    next: self.next,
    garbage_pending: { self: self.pending, opp: opp.pending },
    move,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function checkBoard(value: unknown, name: string): Board {
  const rows = CONFIG.visibleRows + CONFIG.hiddenRows;
  const valid =
    Array.isArray(value) &&
    value.length === rows &&
    value.every(
      (row: unknown) =>
        Array.isArray(row) &&
        row.length === CONFIG.columns &&
        row.every((cell: unknown) => Number.isInteger(cell) && (cell as number) >= CONFIG.emptyCell && (cell as number) <= CONFIG.garbageCell),
    );
  if (!valid) throw new ModelError(`${name} must be ${rows} rows of ${CONFIG.columns} cells, each from 0 to 5`);
  return value as Board;
}

function checkFrames(value: unknown): BoardFrame[] {
  if (!Array.isArray(value)) throw new ModelError('frames must be an array');
  return value.map((frame: unknown, index) => {
    if (!isRecord(frame)) throw new ModelError(`frames[${index}] must be an object`);
    if (frame.kind !== 'place' && frame.kind !== 'fall' && frame.kind !== 'clear' && frame.kind !== 'garbage') {
      throw new ModelError(`frames[${index}].kind must be place, fall, clear or garbage`);
    }
    if (frame.player !== 0 && frame.player !== 1) throw new ModelError(`frames[${index}].player must be 0 or 1`);
    if (!isCount(frame.chain)) throw new ModelError(`frames[${index}].chain must be a count`);
    checkBoard(frame.board, `frames[${index}].board`);
    return frame as unknown as BoardFrame;
  });
}

/** Rejects anything the game could not show, with a message for the model's author. */
export function parseModelReply(value: unknown): ModelReply {
  if (!isRecord(value)) throw new ModelError('the reply must be a JSON object');
  const events = value.events;
  if (!isRecord(events)) throw new ModelError('events is required');
  if (events.winner !== null && events.winner !== 0 && events.winner !== 1) throw new ModelError('events.winner must be 0, 1 or null');
  for (const key of COUNT_KEYS) {
    if (events[key] !== undefined && !isCount(events[key])) throw new ModelError(`events.${key} must be a count`);
  }

  const pending = value.next_pending;
  if (pending === null || pending === undefined) {
    if (events.winner === null) throw new ModelError('next_pending is required until the game is over');
  } else if (!isRecord(pending) || !isCount(pending.self) || !isCount(pending.opp)) {
    throw new ModelError('next_pending must be {self, opp} with counts');
  }

  return {
    next_board_self: checkBoard(value.next_board_self, 'next_board_self'),
    next_board_opp: checkBoard(value.next_board_opp, 'next_board_opp'),
    next_pending: (pending ?? null) as ModelReply['next_pending'],
    events: events as ModelReply['events'],
    frames: value.frames === undefined ? undefined : checkFrames(value.frames),
  };
}

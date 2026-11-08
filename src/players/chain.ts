import { CONFIG, type Board, type EngineApi, type Events, type GameState, type Move, type PlayerId, type StepResult } from '../engine';
import { Prng } from '../lib/prng';
import type { Decision, Player } from './types';

const CANDIDATE_COUNT = 3;
/** How many of the best first moves get a second look with the next pair. */
const BEAM_WIDTH = 8;
const FUTURE_DISCOUNT = 0.9;

/** Value of a chain that is ready on the board but has not been fired. */
const READY_ATTACK_WEIGHT = 0.9;
const FIRE_WEIGHT = 3;
const CONNECTION_WEIGHT = 0.7;
/** Cost of each announced garbage block that this move leaves in place. */
const REMAINING_PENDING_WEIGHT = 2.5;
/** From this much announced garbage (one full row), waiting for a better chain is too risky. */
const URGENT_PENDING = 6;

interface Potential {
  chains: number;
  attack: number;
}

interface Scored {
  move: Move;
  result: StepResult;
  firstValue: number;
  total: number;
}

function columnTop(board: Board, column: number): number {
  let row = 0;
  while (row < board.length && board[row][column] === CONFIG.emptyCell) row++;
  return row;
}

function maxHeight(board: Board): number {
  let top = board.length;
  for (let col = 0; col < board[0].length; col++) top = Math.min(top, columnTop(board, col));
  return board.length - top;
}

function countBlocks(board: Board): number {
  return board.flat().filter((cell) => cell !== CONFIG.emptyCell).length;
}

function connections(board: Board): number {
  let count = 0;
  for (let row = CONFIG.hiddenRows; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      const cell = board[row][col];
      if (cell < 1 || cell > CONFIG.colors) continue;
      if (board[row][col + 1] === cell) count++;
      if (row + 1 < board.length && board[row + 1][col] === cell) count++;
    }
  }
  return count;
}

/** Whether dropping `color` on this column would touch that color at all. */
function touchesColor(board: Board, column: number, color: number): boolean {
  const top = columnTop(board, column);
  if (board[top]?.[column] === color) return true;
  for (let row = Math.max(0, top - 2); row < top; row++) {
    if (board[row][column - 1] === color || board[row][column + 1] === color) return true;
  }
  return false;
}

function attackOf(events: Events): number {
  return events.garbageSent + events.garbageOffset;
}

/**
 * Builds a chain instead of clearing as soon as possible. For each move it asks
 * "what is the strongest chain I could set off from the resulting board?", holds
 * small clears back while there is room, and fires once the chain is big enough
 * or the board gets dangerous. Uses only the public engine API.
 */
export class ChainPlayer implements Player {
  readonly name = 'Chainer';
  private readonly rng: Prng;

  constructor(
    private readonly engine: EngineApi,
    seed: number,
    salt = 0,
  ) {
    this.rng = new Prng(seed, salt);
  }

  async chooseMove(state: GameState, legalMoves: Move[]): Promise<Decision> {
    const self = state.current;

    const first = this.rng.shuffled(legalMoves).map((move): Scored => {
      const result = this.engine.step(state, move);
      const firstValue = this.moveValue(state, result, self);
      return { move, result, firstValue, total: firstValue };
    });
    first.sort((a, b) => b.total - a.total);

    // Look one pair further for the most promising moves only. The look-ahead cannot
    // see announced garbage landing, so it must not talk the player into waiting then.
    const urgent = state.players[self].pending >= URGENT_PENDING;
    const beam = first.slice(0, BEAM_WIDTH);
    for (const entry of urgent ? [] : beam) {
      if (entry.result.next.winner === null) {
        entry.total = entry.firstValue * (1 - FUTURE_DISCOUNT) + FUTURE_DISCOUNT * this.bestFollowUp(entry.result.next, self);
        // A clear happens now and must not be diluted by the look-ahead.
        entry.total += this.immediateValue(state, entry.result, self) * FUTURE_DISCOUNT;
      }
    }
    beam.sort((a, b) => b.total - a.total);

    const best = beam[0];
    return {
      move: best.move,
      candidates: beam.slice(0, CANDIDATE_COUNT).map((entry) => entry.move),
      thought: this.describe(state, best, self),
    };
  }

  /** The turn after this one, played by the same player with their next pair. */
  private bestFollowUp(next: GameState, self: PlayerId): number {
    const asSelf: GameState = { ...next, current: self };
    let best = -Infinity;
    for (const move of this.engine.legalMoves(asSelf, self)) {
      best = Math.max(best, this.moveValue(asSelf, this.engine.step(asSelf, move), self));
    }
    return best;
  }

  private moveValue(state: GameState, result: StepResult, self: PlayerId): number {
    return this.immediateValue(state, result, self) + this.boardValue(result.next, self);
  }

  /** The chain worth waiting for; shrinks as the board fills or garbage is on the way. */
  private chainTarget(state: GameState, self: PlayerId): number {
    const player = state.players[self];
    const fill = countBlocks(player.board) / (CONFIG.columns * CONFIG.visibleRows);
    let target = fill < 0.5 ? 5 : fill < 0.65 ? 4 : fill < 0.78 ? 3 : 2;
    if (player.pending >= 4) target = Math.min(target, 3);
    if (player.pending >= 12) target = Math.min(target, 2);
    return target;
  }

  private immediateValue(state: GameState, result: StepResult, self: PlayerId): number {
    const { events, next } = result;
    if (next.winner !== null) return next.winner === self ? 1e8 : -1e8;
    if (events.chains === 0) return 0;

    const attack = attackOf(events);
    if (events.chains >= this.chainTarget(state, self)) return attack * FIRE_WEIGHT + events.chains;

    // Below target: a clear still removes garbage and buys room, so it is only
    // discouraged, more strongly when the board has plenty of space left.
    const danger = maxHeight(state.players[self].board) >= CONFIG.visibleRows - 3;
    return danger ? attack * FIRE_WEIGHT + 8 : attack * 0.2 - events.cleared * 0.6;
  }

  private boardValue(state: GameState, self: PlayerId): number {
    const board = state.players[self].board;
    const potential = this.bestTrigger(state, self);
    const remainingPending = state.players[self].pending * REMAINING_PENDING_WEIGHT;

    let heightPenalty = 0;
    for (let col = 0; col < CONFIG.columns; col++) {
      const height = board.length - columnTop(board, col);
      if (height > 8) heightPenalty += (height - 8) ** 2 * 2.5;
    }
    const spawnHeight = board.length - columnTop(board, CONFIG.spawnColumn);
    if (spawnHeight > 6) heightPenalty += (spawnHeight - 6) ** 2 * 5;

    return potential.attack * READY_ATTACK_WEIGHT + potential.chains * 2.5 + connections(board) * CONNECTION_WEIGHT - heightPenalty - remainingPending;
  }

  /** The strongest chain a same-color pair could set off from this board. */
  private bestTrigger(state: GameState, self: PlayerId): Potential {
    const best: Potential = { chains: 0, attack: 0 };
    if (state.winner !== null) return best;

    const player = state.players[self];
    for (const move of this.engine.legalMoves({ ...state, current: self }, self)) {
      if (move.rotation !== 0) continue;
      for (let color = 1; color <= CONFIG.colors; color++) {
        if (!touchesColor(player.board, move.column, color)) continue;
        const players = [...state.players] as GameState['players'];
        players[self] = { ...player, pair: [color, color] };
        const { events } = this.engine.step({ ...state, current: self, players }, move);
        if (events.chains > best.chains || (events.chains === best.chains && attackOf(events) > best.attack)) {
          best.chains = events.chains;
          best.attack = attackOf(events);
        }
      }
    }
    return best;
  }

  private describe(state: GameState, best: Scored, self: PlayerId): string {
    const { events, next } = best.result;
    const target = this.chainTarget(state, self);
    if (events.chains >= 2) return `Firing a ${events.chains}-chain for ${attackOf(events)} garbage!`;
    if (events.chains === 1) return 'No time to wait. Clearing now to stay alive.';
    if (state.players[self].pending >= URGENT_PENDING) return `${state.players[self].pending} garbage incoming and no answer yet. Bracing.`;
    const ready = this.bestTrigger(next, self);
    if (ready.chains >= 2) return `A ${ready.chains}-chain is loaded. Holding out for ${Math.max(target, ready.chains + 1)}.`;
    return `Stacking colors for a ${target}-chain. Not firing yet.`;
  }
}

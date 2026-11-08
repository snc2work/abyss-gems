import { CONFIG, type Board, type EngineApi, type Events, type GameState, type Move, type PlayerId } from '../engine';
import { Prng } from '../lib/prng';
import type { Decision, Player } from './types';

const CANDIDATE_COUNT = 3;

interface Scored {
  move: Move;
  events: Events;
  score: number;
}

/** Same-color neighbor pairs: moves that build groups win when nothing clears yet. */
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

function stackHeight(board: Board): number {
  const top = board.findIndex((row) => row.some((cell) => cell !== 0));
  return top === -1 ? 0 : board.length - top;
}

/**
 * Tries every legal move with `step` and takes the one that clears the most.
 * When no move clears, it falls back on connections and a low stack.
 */
export class GreedyPlayer implements Player {
  readonly name = 'Greedy';
  private readonly rng: Prng;

  constructor(
    private readonly engine: EngineApi,
    seed: number,
    salt = 0,
  ) {
    this.rng = new Prng(seed, salt);
  }

  async chooseMove(state: GameState, legalMoves: Move[]): Promise<Decision> {
    const self: PlayerId = state.current;
    const opponent: PlayerId = self === 0 ? 1 : 0;

    // Shuffling first makes the stable sort below break exact ties at random.
    const scored = this.rng.shuffled(legalMoves).map((move): Scored => {
      const { next, events } = this.engine.step(state, move);
      const board = next.players[self].board;
      const suicide = events.winner === opponent ? -1e9 : 0;
      const winning = events.winner === self ? 1e9 : 0;
      const clears = events.chains * 1e6 + (events.cleared + events.clearedGarbage) * 1e3;
      const shape = connections(board) * 4 - stackHeight(board);
      return { move, events, score: suicide + winning + clears + shape };
    });
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    return {
      move: best.move,
      candidates: scored.slice(0, CANDIDATE_COUNT).map((entry) => entry.move),
      thought: describe(best.events, legalMoves.length),
    };
  }
}

function describe(events: Events, moveCount: number): string {
  if (events.chains >= 2) {
    return `Read ${moveCount} moves. A ${events.chains}-chain clears ${events.cleared} blocks!`;
  }
  if (events.chains === 1) {
    return `Read ${moveCount} moves. ${events.cleared} blocks can clear now, so I'll take it.`;
  }
  return `Read ${moveCount} moves and none clears. Grouping colors and stacking low.`;
}

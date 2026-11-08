import { describe, expect, it } from 'vitest';
import {
  CONFIG,
  initState,
  legalMoves,
  step,
  type Board,
  type GameState,
  type Move,
  type Pair,
  type PlayerId,
} from '../src/engine';

const ROWS = CONFIG.visibleRows + CONFIG.hiddenRows;

/** Builds a board from bottom-aligned text rows: "." empty, 1-4 colors, "x" garbage. */
function boardFrom(...rows: string[]): Board {
  const board: Board = Array.from({ length: ROWS }, () => new Array(CONFIG.columns).fill(0));
  rows.forEach((text, index) => {
    const row = ROWS - rows.length + index;
    [...text].forEach((ch, col) => {
      board[row][col] = ch === '.' ? 0 : ch === 'x' ? CONFIG.garbageCell : Number(ch);
    });
  });
  return board;
}

function withPlayer(
  state: GameState,
  player: PlayerId,
  patch: { board?: Board; pair?: Pair; pending?: number },
): GameState {
  const players = [...state.players] as GameState['players'];
  players[player] = { ...players[player], ...patch };
  return { ...state, players };
}

/** Column filled from the bottom with garbage, leaving `free` empty cells. */
function columnHeight(board: Board, column: number, free: number): Board {
  const copy = board.map((row) => [...row]);
  for (let row = free; row < ROWS; row++) copy[row][column] = CONFIG.garbageCell;
  return copy;
}

const UP: Move = { column: 0, rotation: 0 };

describe('initState', () => {
  it('starts with empty boards and the same pair sequence for both players', () => {
    const state = initState(42);
    expect(state.players[0].board).toHaveLength(ROWS);
    expect(state.players[0].board.flat().every((cell) => cell === 0)).toBe(true);
    expect(state.players[0].pair).toEqual(state.players[1].pair);
    expect(state.players[0].next).toEqual(state.players[1].next);
    expect(state.current).toBe(0);
    expect(state.winner).toBeNull();
  });
});

describe('legalMoves', () => {
  it('excludes moves that would push the child through a wall', () => {
    const moves = legalMoves(initState(1), 0);
    expect(moves).toHaveLength(6 * 4 - 2);
    expect(moves).not.toContainEqual({ column: 0, rotation: 3 });
    expect(moves).not.toContainEqual({ column: 5, rotation: 1 });
  });

  it('requires two free cells for a vertical pair and one per column for a horizontal one', () => {
    const state = withPlayer(initState(1), 0, { board: columnHeight(boardFrom(), 4, 1) });
    const moves = legalMoves(state, 0);
    expect(moves).not.toContainEqual({ column: 4, rotation: 0 });
    expect(moves).not.toContainEqual({ column: 4, rotation: 2 });
    expect(moves).toContainEqual({ column: 4, rotation: 1 });
    expect(moves).toContainEqual({ column: 3, rotation: 1 });
  });

  it('excludes columns behind a completely full column', () => {
    const state = withPlayer(initState(1), 0, { board: columnHeight(boardFrom(), 1, 0) });
    const reachable = new Set(legalMoves(state, 0).map((move) => move.column));
    expect(reachable.has(0)).toBe(false);
    expect(reachable.has(1)).toBe(false);
    expect(reachable.has(2)).toBe(true);
    expect(reachable.has(5)).toBe(true);
  });

  it('returns nothing once the game is over', () => {
    expect(legalMoves({ ...initState(1), winner: 1 }, 0)).toEqual([]);
  });
});

describe('step: placing and gravity', () => {
  it('drops the pair to the floor one row per frame and does not mutate the input', () => {
    const state = withPlayer(initState(1), 0, { pair: [1, 2] });
    const snapshot = JSON.stringify(state);
    const { next, frames } = step(state, { column: 3, rotation: 0 });

    expect(JSON.stringify(state)).toBe(snapshot);
    const board = next.players[0].board;
    expect(board[ROWS - 1][3]).toBe(1);
    expect(board[ROWS - 2][3]).toBe(2);
    expect(frames[0].kind).toBe('place');
    expect(frames.filter((frame) => frame.kind === 'fall')).toHaveLength(ROWS - 2);
    expect(frames.at(-1)!.board).toEqual(board);
  });

  it('honors the four rotations', () => {
    const land = (rotation: Move['rotation']) =>
      step(withPlayer(initState(1), 0, { pair: [1, 2] }), { column: 2, rotation }).next.players[0].board;
    expect(land(0)[ROWS - 1][2]).toBe(1);
    expect(land(0)[ROWS - 2][2]).toBe(2);
    expect(land(2)[ROWS - 1][2]).toBe(2);
    expect(land(2)[ROWS - 2][2]).toBe(1);
    expect(land(1)[ROWS - 1][2]).toBe(1);
    expect(land(1)[ROWS - 1][3]).toBe(2);
    expect(land(3)[ROWS - 1][2]).toBe(1);
    expect(land(3)[ROWS - 1][1]).toBe(2);
  });

  it('splits a horizontal pair over uneven columns', () => {
    const state = withPlayer(initState(1), 0, { pair: [1, 2], board: boardFrom('3.....', '3.....') });
    const board = step(state, { column: 0, rotation: 1 }).next.players[0].board;
    expect(board[ROWS - 3][0]).toBe(1);
    expect(board[ROWS - 1][1]).toBe(2);
  });

  it('rejects illegal moves', () => {
    expect(() => step(initState(1), { column: 0, rotation: 3 })).toThrow(/illegal/);
  });
});

describe('step: clearing', () => {
  it('clears four connected blocks of one color', () => {
    const state = withPlayer(initState(1), 0, {
      pair: [1, 1],
      board: boardFrom('11....'),
    });
    const { next, events, frames } = step(state, { column: 2, rotation: 1 });
    expect(events.cleared).toBe(4);
    expect(events.chains).toBe(1);
    expect(next.players[0].board.flat().every((cell) => cell === 0)).toBe(true);
    const clearFrame = frames.find((frame) => frame.kind === 'clear')!;
    expect(clearFrame.cleared).toHaveLength(4);
    expect(clearFrame.chain).toBe(1);
  });

  it('keeps groups of three and does not connect diagonally', () => {
    const state = withPlayer(initState(1), 0, {
      // Four 1s touching only diagonally, plus a column of three 3s after the move.
      pair: [3, 3],
      board: boardFrom('1.1...', '2121.3'),
    });
    const { events } = step(state, { column: 5, rotation: 0 });
    expect(events.cleared).toBe(0);
    expect(events.chains).toBe(0);
  });

  it('clears adjacent garbage with the group, but not garbage farther away', () => {
    const state = withPlayer(initState(1), 0, {
      pair: [1, 1],
      board: boardFrom('11x.x.'),
    });
    const { next, events } = step(state, { column: 0, rotation: 1 });
    expect(events.cleared).toBe(4);
    expect(events.clearedGarbage).toBe(1);
    const bottom = next.players[0].board[ROWS - 1];
    expect(bottom).toEqual([0, 0, 0, 0, CONFIG.garbageCell, 0]);
  });

  it('never clears through the hidden row', () => {
    // Four connected 1s in column 0, but the top one rests in the hidden row.
    const filler = boardFrom(
      '1.....', '1.....', '3.....', '2.....', '3.....', '2.....',
      '3.....', '2.....', '3.....', '2.....', '3.....',
    );
    const state = withPlayer(initState(1), 0, { pair: [1, 1], board: filler });
    const { next, events } = step(state, { column: 0, rotation: 0 });
    expect(events.cleared).toBe(0);
    expect(next.players[0].board[0][0]).toBe(1);
  });
});

describe('step: chains', () => {
  // Clearing the 1s lets column 0's 2s fall and join the bottom row of 2s (five in total).
  const chainBoard = boardFrom(
    '2.....',
    '2.....',
    '1.....',
    '1222..',
  );

  it('counts a two-step chain and reports each step in the frames', () => {
    const state = withPlayer(initState(1), 0, { pair: [1, 1], board: chainBoard });
    const { events, frames, next } = step(state, { column: 1, rotation: 0 });
    expect(events.chains).toBe(2);
    expect(events.cleared).toBe(4 + 5);
    expect(frames.filter((frame) => frame.kind === 'clear').map((frame) => frame.chain)).toEqual([1, 2]);
    expect(next.players[0].board.flat().every((cell) => cell === 0)).toBe(true);
  });
});

describe('step: garbage', () => {
  // Same setup as the chain test: score = 4*1 + 5*2 = 14, so 14 / 3 = 4 garbage.
  const twoChain = boardFrom('2.....', '2.....', '1.....', '1222..');
  const expectedAttack = 4;

  it('computes garbage from the configured formula and announces it to the opponent', () => {
    const state = withPlayer(initState(1), 0, { pair: [1, 1], board: twoChain });
    const { events, next } = step(state, { column: 1, rotation: 0 });
    expect(events.garbageSent).toBe(expectedAttack);
    expect(next.players[1].pending).toBe(expectedAttack);
    expect(next.players[1].board.flat().some((cell) => cell === CONFIG.garbageCell)).toBe(false);
  });

  it('cancels the mover\'s own announcement before sending the rest', () => {
    const state = withPlayer(initState(1), 0, { pair: [1, 1], board: twoChain, pending: 3 });
    const { events, next } = step(state, { column: 1, rotation: 0 });
    expect(events.garbageOffset).toBe(3);
    expect(events.garbageSent).toBe(1);
    expect(next.players[0].pending).toBe(0);
    expect(next.players[1].pending).toBe(1);
  });

  it('keeps the rest of the announcement when the attack is too small', () => {
    const state = withPlayer(initState(1), 0, { pair: [1, 1], board: twoChain, pending: 10 });
    const { events, next } = step(state, { column: 1, rotation: 0 });
    expect(events.garbageOffset).toBe(expectedAttack);
    expect(events.garbageSent).toBe(0);
    expect(next.players[0].pending).toBe(6);
  });

  it('drops an announcement that survived one turn at the start of the owner\'s next turn', () => {
    // Player 1 owns 7 garbage from earlier; player 0 now moves without clearing.
    const state = withPlayer(initState(5), 1, { pending: 7 });
    const { next, frames, events } = step(state, UP);

    const garbage = next.players[1].board.flat().filter((cell) => cell === CONFIG.garbageCell);
    expect(garbage).toHaveLength(7);
    expect(events.garbageFallen).toBe(7);
    expect(next.players[1].pending).toBe(0);
    expect(frames.some((frame) => frame.kind === 'garbage' && frame.player === 1)).toBe(true);
    expect(frames.at(-1)!.board).toEqual(next.players[1].board);
  });

  it('spreads garbage evenly: one per column per six, remainder in distinct columns', () => {
    const state = withPlayer(initState(5), 1, { pending: 8 });
    const board = step(state, UP).next.players[1].board;
    const heights = Array.from({ length: CONFIG.columns }, (_, col) =>
      board.filter((row) => row[col] === CONFIG.garbageCell).length,
    );
    expect(heights.reduce((a, b) => a + b, 0)).toBe(8);
    expect(Math.min(...heights)).toBe(1);
    expect(Math.max(...heights)).toBe(2);
  });

  it('holds newly sent garbage back so the opponent gets one chance to cancel it', () => {
    // Attack lands on player 1 (pending 4) but their board stays clean this step.
    const attacked = step(withPlayer(initState(1), 0, { pair: [1, 1], board: twoChain }), {
      column: 1,
      rotation: 0,
    }).next;
    expect(attacked.players[1].pending).toBe(expectedAttack);

    // Player 1 does not clear, then player 0 moves: only now does it drop.
    const afterP1 = step(attacked, { column: 5, rotation: 0 }).next;
    expect(afterP1.players[1].pending).toBe(expectedAttack);
    const afterP0 = step(afterP1, { column: 5, rotation: 0 });
    expect(afterP0.events.garbageFallen).toBe(expectedAttack);
    expect(afterP0.next.players[1].pending).toBe(0);
  });
});

describe('step: long-game pressure', () => {
  it('adds nothing before the start turn', () => {
    const state = { ...initState(1), turn: CONFIG.pressureStartTurn - 1 };
    const { events, next } = step(state, UP);
    expect(events.garbagePressure).toBe(0);
    expect(next.players[1].pending).toBe(0);
  });

  it('announces growing garbage against the next player, separately from attacks', () => {
    const atStart = step({ ...initState(1), turn: CONFIG.pressureStartTurn }, UP);
    expect(atStart.events.garbagePressure).toBe(1);
    expect(atStart.events.garbageSent).toBe(0);
    expect(atStart.next.players[1].pending).toBe(1);

    const later = step({ ...initState(1), turn: CONFIG.pressureStartTurn + 2 * CONFIG.pressureRampTurns }, UP);
    expect(later.events.garbagePressure).toBe(3);
  });
});

describe('step: losing', () => {
  it('makes the mover lose when their own placement blocks the spawn cell', () => {
    // Column 2 has 11 blocks; a vertical pair fills the spawn row and the hidden row.
    const board = columnHeight(boardFrom(), 2, 2);
    const state = withPlayer(initState(1), 0, { pair: [1, 2], board });
    const { next, events } = step(state, { column: 2, rotation: 0 });
    expect(events.winner).toBe(1);
    expect(next.winner).toBe(1);
    expect(legalMoves(next, 0)).toEqual([]);
    expect(() => step(next, UP)).toThrow(/over/);
  });

  it('makes the opponent lose when garbage dropping on them blocks the spawn cell', () => {
    const board = columnHeight(boardFrom(), 2, 3);
    let state = withPlayer(initState(1), 1, { board, pending: 12 });
    state = withPlayer(state, 0, { pair: [1, 2] });
    const { next, events } = step(state, { column: 5, rotation: 0 });
    expect(events.winner).toBe(0);
    expect(next.winner).toBe(0);
  });

  it('survives a tall spawn column when the move clears it', () => {
    const board = columnHeight(boardFrom(), 2, 3);
    board[3][2] = 1;
    board[4][2] = 1;
    const state = withPlayer(initState(1), 0, { pair: [1, 1], board });
    const { events } = step(state, { column: 2, rotation: 0 });
    expect(events.chains).toBeGreaterThanOrEqual(1);
    expect(events.winner).toBeNull();
  });

  it('always leaves a legal move while the game is running', () => {
    const board = columnHeight(boardFrom(), 2, 2);
    const state = withPlayer(initState(1), 0, { board });
    expect(legalMoves(state, 0).length).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  function playout(seed: number): string {
    let state = initState(seed);
    const log: unknown[] = [];
    for (let i = 0; i < 400 && state.winner === null; i++) {
      const moves = legalMoves(state, state.current);
      const result = step(state, moves[(i * 7 + state.turn) % moves.length]);
      log.push(result.next, result.frames, result.events);
      state = result.next;
    }
    return JSON.stringify(log);
  }

  it('reproduces the exact same game from the same seed and moves', () => {
    expect(playout(123)).toBe(playout(123));
  });

  it('produces a different game from a different seed', () => {
    expect(playout(123)).not.toBe(playout(124));
  });
});

// Pure board helpers. Functions named with a trailing "InPlace" mutate only the
// board they are given; callers pass a private copy.

import { CONFIG, TOTAL_ROWS } from './config';
import type { Board, ClearedCell } from './types';

export function emptyBoard(): Board {
  return Array.from({ length: TOTAL_ROWS }, () => new Array<number>(CONFIG.columns).fill(CONFIG.emptyCell));
}

export function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

/** Empty cells in a column of a settled board. */
export function freeCells(board: Board, column: number): number {
  let free = 0;
  while (free < TOTAL_ROWS && board[free][column] === CONFIG.emptyCell) free++;
  return free;
}

/** Moves every unsupported block down by exactly one row. Returns whether anything moved. */
export function gravityStepInPlace(board: Board): boolean {
  let moved = false;
  for (let col = 0; col < CONFIG.columns; col++) {
    for (let row = TOTAL_ROWS - 2; row >= 0; row--) {
      if (board[row][col] !== CONFIG.emptyCell && board[row + 1][col] === CONFIG.emptyCell) {
        board[row + 1][col] = board[row][col];
        board[row][col] = CONFIG.emptyCell;
        moved = true;
      }
    }
  }
  return moved;
}

function isColor(cell: number): boolean {
  return cell >= 1 && cell <= CONFIG.colors;
}

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/** Colored groups that reach the threshold. The hidden row never connects or clears. */
export function findClearGroups(board: Board): ClearedCell[][] {
  const seen = board.map((row) => row.map(() => false));
  const groups: ClearedCell[][] = [];

  for (let row = CONFIG.hiddenRows; row < TOTAL_ROWS; row++) {
    for (let col = 0; col < CONFIG.columns; col++) {
      const color = board[row][col];
      if (seen[row][col] || !isColor(color)) continue;

      const group: ClearedCell[] = [];
      const stack: Array<[number, number]> = [[row, col]];
      seen[row][col] = true;
      while (stack.length > 0) {
        const [r, c] = stack.pop()!;
        group.push({ row: r, col: c, color });
        for (const [dr, dc] of NEIGHBORS) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < CONFIG.hiddenRows || nr >= TOTAL_ROWS || nc < 0 || nc >= CONFIG.columns) continue;
          if (seen[nr][nc] || board[nr][nc] !== color) continue;
          seen[nr][nc] = true;
          stack.push([nr, nc]);
        }
      }
      if (group.length >= CONFIG.clearThreshold) groups.push(group);
    }
  }
  return groups;
}

/** Visible garbage cells touching any of the given cells, without duplicates. */
export function adjacentGarbage(board: Board, cells: readonly ClearedCell[]): ClearedCell[] {
  const found = new Map<number, ClearedCell>();
  for (const { row, col } of cells) {
    for (const [dr, dc] of NEIGHBORS) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < CONFIG.hiddenRows || nr >= TOTAL_ROWS || nc < 0 || nc >= CONFIG.columns) continue;
      if (board[nr][nc] === CONFIG.garbageCell) {
        found.set(nr * CONFIG.columns + nc, { row: nr, col: nc, color: CONFIG.garbageCell });
      }
    }
  }
  return [...found.values()];
}

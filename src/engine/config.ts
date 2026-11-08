// All rule constants live here so that experiments only need to touch one file.

export const CONFIG = {
  columns: 6,
  visibleRows: 12,
  hiddenRows: 1,
  colors: 4,

  emptyCell: 0,
  garbageCell: 5,

  /** Blocks in one connected group needed for it to clear. */
  clearThreshold: 4,

  /** The player loses when this cell is occupied. Row 0 is the hidden row. */
  spawnColumn: 2,
  spawnRow: 1,

  /** Attack power of one chain step. Colored blocks only; garbage adds nothing. */
  chainStepScore: (clearedColored: number, chain: number): number =>
    clearedColored * 2 ** (chain - 1),

  /** Total attack power needed to produce one garbage block. */
  scorePerGarbage: 3,

  /**
   * Long-game pressure. Equal attacks cancel each other, so without this two
   * careful players can trade forever. Set the start to Infinity to disable it.
   */
  pressureStartTurn: 120,
  pressureRampTurns: 20,
} as const;

export const TOTAL_ROWS = CONFIG.visibleRows + CONFIG.hiddenRows;

/** Garbage produced by a whole move, given colored blocks cleared per chain step. */
export function garbageFromChain(clearedPerStep: readonly number[]): number {
  const score = clearedPerStep.reduce(
    (sum, cleared, index) => sum + CONFIG.chainStepScore(cleared, index + 1),
    0,
  );
  return Math.floor(score / CONFIG.scorePerGarbage);
}

/** Garbage announced automatically against the next player on the given turn. */
export function pressureGarbage(turn: number): number {
  if (turn < CONFIG.pressureStartTurn) return 0;
  return 1 + Math.floor((turn - CONFIG.pressureStartTurn) / CONFIG.pressureRampTurns);
}

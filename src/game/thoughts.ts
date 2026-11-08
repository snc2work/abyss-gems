// Previews of moves, computed only through the public `step`.

import type { EngineApi, GameState, Move } from '../engine';
import type { GhostCell, ThoughtItem } from './view';

function sameMove(a: Move, b: Move): boolean {
  return a.column === b.column && a.rotation === b.rotation;
}

/** Tries each candidate with `step` for the thought bubble's mini boards. */
export function previewMoves(
  engine: EngineApi,
  state: GameState,
  candidates: readonly Move[],
  chosen: Move,
): ThoughtItem[] {
  const player = state.current;
  const opponent = player === 0 ? 1 : 0;
  return candidates.map((move) => {
    const { next, events } = engine.step(state, move);
    return {
      move,
      board: next.players[player].board,
      chains: events.chains,
      cleared: events.cleared + events.clearedGarbage,
      sent: events.garbageSent,
      loses: events.winner === opponent,
      chosen: sameMove(move, chosen),
    };
  });
}

/** Where the pair comes to rest, read from the frames just before anything clears. */
export function landingCells(engine: EngineApi, state: GameState, move: Move): GhostCell[] {
  const player = state.current;
  const before = state.players[player].board;
  const { frames } = engine.step(state, move);

  let resting = before;
  for (const frame of frames) {
    if (frame.player !== player || frame.kind === 'clear' || frame.kind === 'garbage') break;
    resting = frame.board;
  }

  const cells: GhostCell[] = [];
  resting.forEach((row, rowIndex) =>
    row.forEach((cell, col) => {
      if (cell !== before[rowIndex][col]) cells.push({ row: rowIndex, col, color: cell });
    }),
  );
  return cells;
}

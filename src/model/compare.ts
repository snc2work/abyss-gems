// Compares a model's answer with what the rules say for the same move.

import { CONFIG, type Board, type GameState, type StepResult } from '../engine';
import type { CellPosition, ThoughtItem, ThoughtView } from '../game/view';
import type { CountKey, ModelReply } from './protocol';

export interface ModelCheck {
  matches: boolean;
  /** Short names of what differs, for display. */
  differences: string[];
  /** Differing cells on each player's board, by player id. */
  cells: [CellPosition[], CellPosition[]];
}

function differingCells(a: Board, b: Board): CellPosition[] {
  const cells: CellPosition[] = [];
  a.forEach((row, rowIndex) =>
    row.forEach((cell, col) => {
      if (cell !== b[rowIndex][col]) cells.push({ row: rowIndex, col });
    }),
  );
  return cells;
}

function withoutGarbage(board: Board, col: number): number[] {
  return board.map((row) => row[col]).filter((cell) => cell !== CONFIG.emptyCell && cell !== CONFIG.garbageCell);
}

function countGarbage(board: Board): number {
  return board.flat().filter((cell) => cell === CONFIG.garbageCell).length;
}

/** The same blocks and the same amount of garbage, wherever that garbage landed. */
function sameApartFromGarbageColumns(a: Board, b: Board): boolean {
  if (countGarbage(a) !== countGarbage(b)) return false;
  for (let col = 0; col < CONFIG.columns; col++) {
    if (withoutGarbage(a, col).join() !== withoutGarbage(b, col).join()) return false;
  }
  return true;
}

const EVENT_LABELS: Record<CountKey, string> = {
  chains: 'chains',
  cleared: 'cleared',
  clearedGarbage: 'cleared garbage',
  garbageSent: 'sent',
  garbageOffset: 'offset',
  garbagePressure: 'pressure',
  garbageFallen: 'fallen',
};

export function compareStep(before: GameState, reply: ModelReply, rules: StepResult): ModelCheck {
  const mover = before.current;
  const opponent = mover === 0 ? 1 : 0;
  const rulesSelf = rules.next.players[mover];
  const rulesOpp = rules.next.players[opponent];
  const differences: string[] = [];

  const selfCells = differingCells(reply.next_board_self, rulesSelf.board);
  let oppCells = differingCells(reply.next_board_opp, rulesOpp.board);
  // The rules pick columns at random for garbage that does not divide evenly, and
  // a model cannot know that choice, so it does not count against the model.
  const randomColumns = before.players[opponent].pending % CONFIG.columns !== 0;
  if (randomColumns && sameApartFromGarbageColumns(reply.next_board_opp, rulesOpp.board)) oppCells = [];

  const cellCount = selfCells.length + oppCells.length;
  if (cellCount > 0) differences.push(`${cellCount} ${cellCount === 1 ? 'cell' : 'cells'}`);
  if (
    reply.next_pending !== null &&
    (reply.next_pending.self !== rulesOpp.pending || reply.next_pending.opp !== rulesSelf.pending)
  ) {
    differences.push('announced garbage');
  }
  if (reply.events.winner !== rules.events.winner) differences.push('winner');
  for (const key of Object.keys(EVENT_LABELS) as CountKey[]) {
    const value = reply.events[key];
    if (value !== undefined && value !== rules.events[key]) differences.push(EVENT_LABELS[key]);
  }

  const cells: ModelCheck['cells'] = mover === 0 ? [selfCells, oppCells] : [oppCells, selfCells];
  return { matches: differences.length === 0, differences, cells };
}

/** The mover's bubble after a model step: both answers side by side. */
export function checkThought(
  before: GameState,
  model: StepResult,
  rules: StepResult,
  check: ModelCheck,
  matched: number,
  total: number,
): ThoughtView {
  const mover = before.current;
  const item = (title: string, result: StepResult): ThoughtItem => ({
    title,
    move: { column: 0, rotation: 0 },
    board: result.next.players[mover].board,
    chains: result.events.chains,
    cleared: result.events.cleared + result.events.clearedGarbage,
    sent: result.events.garbageSent,
    loses: false,
    chosen: false,
  });
  const score = `${matched} of ${total} moves matched.`;
  return {
    status: 'decided',
    text: check.matches ? `Same as the rules. ${score}` : `Differs: ${check.differences.join(', ')}. ${score}`,
    heading: 'MODEL / RULES',
    items: [item('Model', model), item('Rules', rules)],
  };
}

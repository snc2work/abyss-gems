// initState / legalMoves / step. Pure functions: browser-free, seeded randomness only, inputs never mutated.

import { deriveState, normalizeSeed, randomInt } from '../lib/prng';
import {
  adjacentGarbage,
  cloneBoard,
  emptyBoard,
  findClearGroups,
  freeCells,
  gravityStepInPlace,
} from './board';
import { CONFIG, garbageFromChain, pressureGarbage } from './config';
import type {
  Board,
  BoardFrame,
  Events,
  GameState,
  Move,
  Pair,
  PlayerId,
  PlayerState,
  Rotation,
  StepResult,
} from './types';

const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];
const CHILD_COLUMN_OFFSET: Record<Rotation, number> = { 0: 0, 1: 1, 2: 0, 3: -1 };

/** Both players draw from the same sequence, so neither is dealt a better hand. */
function pairAt(seed: number, index: number): Pair {
  const axis = randomInt(deriveState(seed, index + 1), CONFIG.colors);
  const child = randomInt(axis.state, CONFIG.colors);
  return [axis.value + 1, child.value + 1];
}

export function initState(seed: number): GameState {
  const normalized = normalizeSeed(seed);
  const makePlayer = (): PlayerState => ({
    board: emptyBoard(),
    pair: pairAt(normalized, 0),
    next: pairAt(normalized, 1),
    pairIndex: 0,
    pending: 0,
  });
  return {
    seed: normalized,
    rng: deriveState(normalized, 0),
    turn: 0,
    current: 0,
    players: [makePlayer(), makePlayer()],
    winner: null,
  };
}

function isLegal(board: Board, move: Move): boolean {
  const childColumn = move.column + CHILD_COLUMN_OFFSET[move.rotation];
  if (move.column < 0 || move.column >= CONFIG.columns) return false;
  if (childColumn < 0 || childColumn >= CONFIG.columns) return false;

  // The pair travels from the spawn column along the top of the board,
  // so a column filled up to the hidden row blocks the way.
  const from = Math.min(CONFIG.spawnColumn, move.column, childColumn);
  const to = Math.max(CONFIG.spawnColumn, move.column, childColumn);
  for (let col = from; col <= to; col++) {
    if (freeCells(board, col) < 1) return false;
  }

  // A vertical pair needs two free cells in its single column.
  return childColumn !== move.column || freeCells(board, move.column) >= 2;
}

export function legalMoves(state: GameState, player: PlayerId): Move[] {
  if (state.winner !== null) return [];
  const { board } = state.players[player];
  const moves: Move[] = [];
  for (let column = 0; column < CONFIG.columns; column++) {
    for (const rotation of ROTATIONS) {
      const move: Move = { column, rotation };
      if (isLegal(board, move)) moves.push(move);
    }
  }
  return moves;
}

/** Cell a block appears in: the spawn row, or the free cell above a tall stack. */
function entryRow(board: Board, column: number): number {
  return Math.min(CONFIG.spawnRow, freeCells(board, column) - 1);
}

function placePairInPlace(board: Board, pair: Pair, move: Move): void {
  const [axis, child] = pair;
  const childColumn = move.column + CHILD_COLUMN_OFFSET[move.rotation];
  if (childColumn !== move.column) {
    board[entryRow(board, move.column)][move.column] = axis;
    board[entryRow(board, childColumn)][childColumn] = child;
  } else if (move.rotation === 0) {
    board[CONFIG.spawnRow][move.column] = axis;
    board[CONFIG.spawnRow - 1][move.column] = child;
  } else {
    board[CONFIG.spawnRow][move.column] = child;
    board[CONFIG.spawnRow - 1][move.column] = axis;
  }
}

interface ResolveResult {
  frames: BoardFrame[];
  clearedPerStep: number[];
  clearedGarbage: number;
}

/** Applies gravity and chains until the board is stable, recording every frame. */
function resolveChainsInPlace(board: Board, player: PlayerId, frames: BoardFrame[]): ResolveResult {
  const clearedPerStep: number[] = [];
  let clearedGarbage = 0;

  const settle = () => {
    while (gravityStepInPlace(board)) {
      frames.push({ kind: 'fall', player, board: cloneBoard(board), chain: clearedPerStep.length });
    }
  };

  settle();
  for (;;) {
    const groups = findClearGroups(board);
    if (groups.length === 0) break;

    const colored = groups.flat();
    const garbage = adjacentGarbage(board, colored);
    for (const { row, col } of [...colored, ...garbage]) board[row][col] = CONFIG.emptyCell;

    clearedPerStep.push(colored.length);
    clearedGarbage += garbage.length;
    frames.push({
      kind: 'clear',
      player,
      board: cloneBoard(board),
      chain: clearedPerStep.length,
      cleared: [...colored, ...garbage],
    });
    settle();
  }
  return { frames, clearedPerStep, clearedGarbage };
}

interface GarbageDrop {
  board: Board;
  frames: BoardFrame[];
  rng: number;
  fallen: number;
}

/**
 * Whole rows are split evenly; the remainder goes to random distinct columns.
 * Blocks that do not fit above a full column are discarded.
 */
function dropGarbage(source: Board, count: number, player: PlayerId, rng: number): GarbageDrop {
  const board = cloneBoard(source);
  const frames: BoardFrame[] = [];
  if (count <= 0) return { board, frames, rng, fallen: 0 };

  const remaining = new Array<number>(CONFIG.columns).fill(Math.floor(count / CONFIG.columns));
  const columns = Array.from({ length: CONFIG.columns }, (_, col) => col);
  let state = rng;
  for (let i = 0; i < count % CONFIG.columns; i++) {
    const pick = randomInt(state, columns.length - i);
    state = pick.state;
    const index = i + pick.value;
    [columns[i], columns[index]] = [columns[index], columns[i]];
    remaining[columns[i]]++;
  }

  let fallen = 0;
  for (;;) {
    let spawned = false;
    for (let col = 0; col < CONFIG.columns; col++) {
      if (remaining[col] === 0) continue;
      if (board[0][col] === CONFIG.emptyCell) {
        board[0][col] = CONFIG.garbageCell;
        remaining[col]--;
        fallen++;
        spawned = true;
      } else if (freeCells(board, col) === 0) {
        remaining[col] = 0;
      }
    }
    const moved = gravityStepInPlace(board);
    if (!spawned && !moved) break;
    frames.push({ kind: 'garbage', player, board: cloneBoard(board), chain: 0 });
  }
  return { board, frames, rng: state, fallen };
}

function spawnBlocked(board: Board): boolean {
  return board[CONFIG.spawnRow][CONFIG.spawnColumn] !== CONFIG.emptyCell;
}

export function step(state: GameState, move: Move): StepResult {
  if (state.winner !== null) throw new Error('step: the game is already over');
  const mover = state.current;
  const opponent: PlayerId = mover === 0 ? 1 : 0;
  const self = state.players[mover];
  const opp = state.players[opponent];
  if (!isLegal(self.board, move)) throw new Error(`step: illegal move ${JSON.stringify(move)}`);

  // 1. Place the pair and resolve the mover's board.
  const board = cloneBoard(self.board);
  placePairInPlace(board, self.pair, move);
  const frames: BoardFrame[] = [{ kind: 'place', player: mover, board: cloneBoard(board), chain: 0 }];
  const { clearedPerStep, clearedGarbage } = resolveChainsInPlace(board, mover, frames);

  // 2. Attack: first cancel the mover's own announcement, the rest goes to the opponent.
  const attack = garbageFromChain(clearedPerStep);
  const offset = Math.min(self.pending, attack);
  const sent = attack - offset;

  const nextPairIndex = self.pairIndex + 1;
  const nextSelf: PlayerState = {
    board,
    pair: self.next,
    next: pairAt(state.seed, nextPairIndex + 1),
    pairIndex: nextPairIndex,
    pending: self.pending - offset,
  };

  const pressure = pressureGarbage(state.turn);
  const announced = sent + pressure;

  const events: Events = {
    player: mover,
    cleared: clearedPerStep.reduce((sum, cleared) => sum + cleared, 0),
    clearedGarbage,
    chains: clearedPerStep.length,
    garbageSent: sent,
    garbageOffset: offset,
    garbagePressure: pressure,
    garbageFallen: 0,
    winner: null,
  };

  let rng = state.rng;
  let nextOpp: PlayerState;
  if (spawnBlocked(board)) {
    events.winner = opponent;
    nextOpp = { ...opp, pending: opp.pending + announced };
  } else {
    // 3. The opponent's turn starts. Only garbage that already survived one of
    // their own turns drops now; what was just sent waits, so that their next
    // clear has a chance to cancel it.
    const drop = dropGarbage(opp.board, opp.pending, opponent, rng);
    rng = drop.rng;
    frames.push(...drop.frames);
    events.garbageFallen = drop.fallen;
    nextOpp = { ...opp, board: drop.board, pending: announced };
    if (spawnBlocked(drop.board)) events.winner = mover;
  }

  const players: [PlayerState, PlayerState] =
    mover === 0 ? [nextSelf, nextOpp] : [nextOpp, nextSelf];
  const next: GameState = {
    seed: state.seed,
    rng,
    turn: state.turn + 1,
    current: opponent,
    players,
    winner: events.winner,
  };
  return { next, frames, events };
}

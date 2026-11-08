// Runs a world model inside the page with ONNX Runtime, so no model server is needed.
//
// The model is the "frame by frame" model from the separate training project. It has
// three learned parts, exported to ONNX with their decoding (argmax, digits to counts)
// inside the graph:
//
// - frame:  one change of the mover's board (placing the pair, a fall, or a clear)
// - ledger: the clears of each chain step, the pending garbage and the turn to the counts
// - drop:   the settled board and the opponent's board to the opponent's next board
//
// This file only runs the loop that connects them, as the Python version does in the
// training project. No rule of the game is computed here: the boards, counts and
// winner all come from the networks.

import type { InferenceSession, Tensor } from 'onnxruntime-web';
import { CONFIG, type Board, type BoardFrame, type PlayerId } from '../engine';
import { ModelError, parseModelReply, type ModelReply, type ModelRequest } from './protocol';

/** The models shipped in public/models/. */
export const LOCAL_MODELS = [
  { id: 'frames-v1', label: 'frames-v1 (well trained)' },
  { id: 'frames-short', label: 'frames-short (short training)' },
] as const;
export type LocalModelId = (typeof LOCAL_MODELS)[number]['id'];

export function isLocalModelId(value: string): value is LocalModelId {
  return LOCAL_MODELS.some((model) => model.id === value);
}

const PARTS = ['frame', 'ledger', 'drop'] as const;
type Part = (typeof PARTS)[number];

const ROWS = CONFIG.visibleRows + CONFIG.hiddenRows;
const COLUMNS = CONFIG.columns;
const CELLS = ROWS * COLUMNS;

const KIND_CLEAR = 2;
const MAX_RESOLVE_STEPS = 60;
const MAX_CHAIN_STEPS = 16;
// The winner as the models see it, from the mover's side.
const WINNER_NONE = 0;
const WINNER_MOVER = 1;

/** The few parts of onnxruntime-web this file uses, so tests can pass the Node build. */
export interface OrtApi {
  InferenceSession: { create(model: Uint8Array): Promise<InferenceSession> };
  Tensor: new (type: 'int32', data: Int32Array, dims: readonly number[]) => Tensor;
}

type Sessions = Record<Part, InferenceSession>;

function flat(board: Board): Int32Array {
  return Int32Array.from(board.flat());
}

function boardOf(data: ArrayLike<number>, offset = 0): Board {
  return Array.from({ length: ROWS }, (_, row) => Array.from({ length: COLUMNS }, (_, col) => Number(data[offset + row * COLUMNS + col])));
}

function sameCells(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  for (let index = 0; index < CELLS; index++) if (a[index] !== b[index]) return false;
  return true;
}

/** Empty cells above the stack of each column. */
function freeCells(board: Int32Array): number[] {
  return Array.from({ length: COLUMNS }, (_, col) => {
    for (let row = 0; row < ROWS; row++) if (board[row * COLUMNS + col] !== CONFIG.emptyCell) return row;
    return ROWS;
  });
}

/**
 * Where the garbage count does not divide evenly over the columns, the rules pick the
 * extra columns at random, so the board head alone tends to spread garbage thinly. The
 * garbage the model added is taken back and stacked again, as many as its own
 * `garbageFallen` count, best-scored open cell first. As `garbage="ranked"` in Python.
 */
function rankGarbage(decoded: Int32Array, score: Float32Array, before: Int32Array, fallen: number): Int32Array {
  const board = decoded.slice();
  for (let index = 0; index < CELLS; index++) {
    if (board[index] === CONFIG.garbageCell && before[index] !== CONFIG.garbageCell) board[index] = CONFIG.emptyCell;
  }
  const free = freeCells(board);
  for (let drop = 0; drop < fallen; drop++) {
    let best = -1;
    for (let col = 0; col < COLUMNS; col++) {
      if (free[col] === 0) continue;
      // Ties keep the leftmost column, like Python's max().
      if (best < 0 || score[(free[col] - 1) * COLUMNS + col] > score[(free[best] - 1) * COLUMNS + best]) best = col;
    }
    if (best < 0) break;
    free[best]--;
    board[free[best] * COLUMNS + best] = CONFIG.garbageCell;
  }
  return board;
}

export class LocalWorldModel {
  private constructor(
    private readonly ort: OrtApi,
    private readonly sessions: Sessions,
  ) {}

  /** `read` returns the bytes of `<part>.onnx`. */
  static async load(ort: OrtApi, read: (part: Part) => Promise<Uint8Array>): Promise<LocalWorldModel> {
    const entries = await Promise.all(PARTS.map(async (part) => [part, await ort.InferenceSession.create(await read(part))] as const));
    return new LocalWorldModel(ort, Object.fromEntries(entries) as Sessions);
  }

  private tensor(values: Int32Array | number[], dims: readonly number[]): Tensor {
    return new this.ort.Tensor('int32', values instanceof Int32Array ? values : Int32Array.from(values), dims);
  }

  private async frame(board: Int32Array, place: boolean, pair: number[], move: number[]) {
    const out = await this.sessions.frame.run({
      board: this.tensor(board, [1, ROWS, COLUMNS]),
      is_place: this.tensor([place ? 1 : 0], [1]),
      pair: this.tensor(pair, [1, 2]),
      move: this.tensor(move, [1, 2]),
    });
    const counts = out.counts.data as Int32Array;
    return {
      board: Int32Array.from(out.next_board.data as Int32Array),
      kind: Number((out.kind.data as Int32Array)[0]),
      cleared: counts[0],
      clearedGarbage: counts[1],
    };
  }

  async reply(request: ModelRequest): Promise<ModelReply> {
    const mover = request.player;
    const opponent: PlayerId = mover === 0 ? 1 : 0;
    const frames: BoardFrame[] = [];

    // Place the pair, then repeat the frame part until its board stops changing.
    const placed = await this.frame(flat(request.board_self), true, [...request.pair], [request.move.column, request.move.rotation]);
    let board = placed.board;
    frames.push({ kind: 'place', player: mover, board: boardOf(board), chain: 0 });
    const steps = new Array<number>(MAX_CHAIN_STEPS).fill(0);
    let chains = 0;
    let clearedGarbage = 0;
    for (let step = 0; step < MAX_RESOLVE_STEPS; step++) {
      const after = await this.frame(board, false, [0, 0], [0, 0]);
      if (sameCells(after.board, board)) break;
      const isClear = after.kind === KIND_CLEAR;
      if (isClear) {
        if (chains < MAX_CHAIN_STEPS) steps[chains] = after.cleared;
        chains++;
        clearedGarbage += after.clearedGarbage;
      }
      board = after.board;
      frames.push({ kind: isClear ? 'clear' : 'fall', player: mover, board: boardOf(board), chain: chains });
    }

    const pending = [request.garbage_pending.self, request.garbage_pending.opp];
    const ledgerOut = await this.sessions.ledger.run({
      steps: this.tensor(steps, [1, MAX_CHAIN_STEPS]),
      pending: this.tensor(pending, [1, 2]),
      turn: this.tensor([request.turn], [1]),
    });
    const [garbageSent, garbageOffset, garbagePressure, pendingSelf, pendingOpp] = Array.from(ledgerOut.counts.data as Int32Array);

    const beforeOpp = flat(request.board_opp);
    const dropOut = await this.sessions.drop.run({
      settled: this.tensor(board, [1, ROWS, COLUMNS]),
      board_opp: this.tensor(beforeOpp, [1, ROWS, COLUMNS]),
      pending_opp: this.tensor([request.garbage_pending.opp], [1]),
    });
    const garbageFallen = Number((dropOut.fallen.data as Int32Array)[0]);
    let opp: Int32Array<ArrayBufferLike> = Int32Array.from(dropOut.next_board_opp.data as Int32Array);
    if (request.garbage_pending.opp % COLUMNS !== 0) {
      opp = rankGarbage(opp, dropOut.garbage_score.data as Float32Array, beforeOpp, garbageFallen);
    }
    if (!sameCells(opp, beforeOpp)) {
      // Only the end of the drop is known, so it is shown as one garbage frame.
      frames.push({ kind: 'garbage', player: opponent, board: boardOf(opp), chain: 0 });
    }

    const relative = Number((dropOut.winner.data as Int32Array)[0]);
    const winner = relative === WINNER_NONE ? null : relative === WINNER_MOVER ? mover : opponent;
    return parseModelReply({
      next_board_self: boardOf(board),
      next_board_opp: boardOf(opp),
      // The game ends with a winner, so there is no next line to announce for.
      next_pending: winner === null ? { self: pendingSelf, opp: pendingOpp } : null,
      events: {
        winner,
        cleared: steps.reduce((sum, value) => sum + value, 0),
        clearedGarbage,
        chains,
        garbageSent,
        garbageOffset,
        garbagePressure,
        garbageFallen,
      },
      frames,
    });
  }
}

const loaded = new Map<LocalModelId, Promise<LocalWorldModel>>();

/** Loads a shipped model once per page; later matches reuse it. */
export function loadLocalModel(id: LocalModelId): Promise<LocalWorldModel> {
  let model = loaded.get(id);
  if (!model) {
    model = (async () => {
      const ort = await import('onnxruntime-web/wasm');
      // One thread needs no cross-origin isolation, and these models are small.
      ort.env.wasm.numThreads = 1;
      return LocalWorldModel.load(ort, async (part) => {
        const url = `${import.meta.env.BASE_URL}models/${id}/${part}.onnx`;
        const response = await fetch(url);
        if (!response.ok) throw new ModelError(`could not load ${url} (HTTP ${response.status})`);
        return new Uint8Array(await response.arrayBuffer());
      });
    })().catch((error: unknown) => {
      loaded.delete(id);
      throw error instanceof ModelError ? error : new ModelError(`could not start the model ${id} (${(error as Error).message})`);
    });
    loaded.set(id, model);
  }
  return model;
}

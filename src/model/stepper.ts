// Plays a move by asking a world model, and checks the answer against the rules.
// The model is either a server (a URL) or one running in the page (see localModel.ts).

import type { BoardFrame, EngineApi, Events, GameState, Move, StepResult } from '../engine';
import { compareStep, type ModelCheck } from './compare';
import { buildModelRequest, ModelError, parseModelReply, type ModelReply, type ModelRequest } from './protocol';

const TIMEOUT_MS = 30_000;

export interface ModelStepInfo {
  before: GameState;
  model: StepResult;
  rules: StepResult;
  check: ModelCheck;
}

function mergeEvents(before: GameState, reply: ModelReply): Events {
  const { winner, ...counts } = reply.events;
  return {
    player: before.current,
    cleared: 0,
    clearedGarbage: 0,
    chains: 0,
    garbageSent: 0,
    garbageOffset: 0,
    garbagePressure: 0,
    garbageFallen: 0,
    ...counts,
    winner,
  };
}

/** Without frames from the model, the boards simply switch to the answer. */
function framesOf(before: GameState, reply: ModelReply): BoardFrame[] {
  if (reply.frames) return reply.frames;
  const mover = before.current;
  return [
    { kind: 'place', player: mover, board: reply.next_board_self, chain: 0 },
    { kind: 'place', player: mover === 0 ? 1 : 0, board: reply.next_board_opp, chain: 0 },
  ];
}

/** A model that answers in the page instead of over HTTP. */
export interface ModelSource {
  reply(request: ModelRequest): Promise<ModelReply>;
}

export class ModelStepper {
  matched = 0;
  total = 0;
  last: ModelStepInfo | null = null;

  constructor(
    private readonly engine: EngineApi,
    private readonly source: string | ModelSource | Promise<ModelSource>,
    private readonly signal: AbortSignal,
    private readonly fetchReply: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async ask(state: GameState, move: Move): Promise<ModelReply> {
    if (typeof this.source !== 'string') {
      const source = await this.source;
      return source.reply(buildModelRequest(state, move));
    }
    return this.askServer(this.source, state, move);
  }

  private async askServer(url: string, state: GameState, move: Move): Promise<ModelReply> {
    let response: Response;
    try {
      response = await this.fetchReply(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildModelRequest(state, move)),
        signal: AbortSignal.any([this.signal, AbortSignal.timeout(TIMEOUT_MS)]),
      });
    } catch (error) {
      if (this.signal.aborted) throw error;
      throw new ModelError(`could not reach ${url} (${(error as Error).message})`);
    }
    if (!response.ok) throw new ModelError(`${url} answered with HTTP ${response.status}`);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ModelError('the reply is not valid JSON');
    }
    return parseModelReply(body);
  }

  /** The rules still supply turn order and the block sequence; the model supplies the boards. */
  step = async (state: GameState, move: Move): Promise<StepResult> => {
    const reply = await this.ask(state, move);
    const rules = this.engine.step(state, move);
    const mover = state.current;
    const opponent = mover === 0 ? 1 : 0;

    // A reply that ends the game announces nothing; keep the counts from before the move,
    // so the rules' own answer never shows on the model's screen.
    const players = [...rules.next.players] as GameState['players'];
    players[mover] = {
      ...players[mover],
      board: reply.next_board_self,
      pending: reply.next_pending?.opp ?? state.players[mover].pending,
    };
    players[opponent] = {
      ...players[opponent],
      board: reply.next_board_opp,
      pending: reply.next_pending?.self ?? state.players[opponent].pending,
    };
    const next: GameState = { ...rules.next, players, winner: reply.events.winner };
    if (next.winner === null && this.engine.legalMoves(next, next.current).length === 0) {
      throw new ModelError('the model left no legal move but named no winner');
    }

    const model: StepResult = { next, frames: framesOf(state, reply), events: mergeEvents(state, reply) };
    const check = compareStep(state, reply, rules);
    this.total++;
    if (check.matches) this.matched++;
    this.last = { before: state, model, rules, check };
    return model;
  };
}

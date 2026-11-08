// A stand-in for a trained model: it answers with the real rules, using only what
// a real model receives. It lets the whole connection be tested without a model.

import type { EngineApi, GameState, PlayerState } from '../engine';
import type { ModelReply, ModelRequest } from './protocol';

export function rulesReply(engine: EngineApi, request: ModelRequest): ModelReply {
  const mover = request.player;
  const opponent = mover === 0 ? 1 : 0;
  const self: PlayerState = {
    board: request.board_self,
    pair: request.pair,
    next: request.next,
    pairIndex: 0,
    pending: request.garbage_pending.self,
  };
  // Only boards and announcements of the opponent affect the outcome of a step.
  const opp: PlayerState = { ...self, board: request.board_opp, pending: request.garbage_pending.opp };
  const state: GameState = {
    seed: 0,
    // The request has no random state, just like a model does not know it.
    rng: Math.imul(request.turn + 1, 0x9e3779b1) >>> 0,
    turn: request.turn,
    current: mover,
    players: mover === 0 ? [self, opp] : [opp, self],
    winner: null,
  };
  const { next, frames, events } = engine.step(state, request.move);
  return {
    next_board_self: next.players[mover].board,
    next_board_opp: next.players[opponent].board,
    next_pending: { self: next.players[opponent].pending, opp: next.players[mover].pending },
    events,
    frames,
  };
}

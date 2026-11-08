// Turn loop shared by the browser and the selfplay script.
// It talks to the rules only through EngineApi, so the rules can be swapped.

import type { EngineApi, GameState, Move, PlayerId, StepResult } from '../engine';
import type { Decision, Player } from '../players';

export interface MatchHooks {
  /** A player is about to choose. */
  onTurnStart?(state: GameState): void | Promise<void>;
  /** A player has chosen; the move has not been applied yet. */
  onDecision?(state: GameState, decision: Decision): void | Promise<void>;
  /** The move has been applied. */
  onStep?(before: GameState, decision: Decision, result: StepResult): void | Promise<void>;
}

export interface MatchOptions {
  engine: EngineApi;
  players: [Player, Player];
  seed: number;
  hooks?: MatchHooks;
  signal?: AbortSignal;
  /** Safety valve against endless games; reaching it ends the match without a winner. */
  maxTurns?: number;
  /** Plays a move some other way than `engine.step`, such as by asking a world model. */
  step?: (state: GameState, move: Move) => Promise<StepResult>;
}

export interface MatchResult {
  finalState: GameState;
  winner: PlayerId | null;
  turns: number;
  aborted: boolean;
}

/** Resolves with the promise, or with `null` if the signal aborts first. */
function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T | null> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(null);
  return new Promise<T | null>((resolve, reject) => {
    const onAbort = () => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export async function runMatch(options: MatchOptions): Promise<MatchResult> {
  const { engine, players, seed, hooks, signal, maxTurns = Infinity, step } = options;
  let state = engine.initState(seed);

  const finish = (aborted: boolean): MatchResult => ({
    finalState: state,
    winner: state.winner,
    turns: state.turn,
    aborted,
  });

  while (state.winner === null && state.turn < maxTurns) {
    if (signal?.aborted) return finish(true);
    await hooks?.onTurnStart?.(state);
    // A slow hook may outlast the match; a stopped match must not ask a player to move.
    if (signal?.aborted) return finish(true);

    const legal = engine.legalMoves(state, state.current);
    const decision = await untilAborted(players[state.current].chooseMove(state, legal), signal);
    if (decision === null) return finish(true);

    await hooks?.onDecision?.(state, decision);
    if (signal?.aborted) return finish(true);

    const result = step ? await untilAborted(step(state, decision.move), signal) : engine.step(state, decision.move);
    if (result === null) return finish(true);
    await hooks?.onStep?.(state, decision, result);
    state = result.next;
  }
  return finish(false);
}

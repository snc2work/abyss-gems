// Connects engine, players, view and logger for one match shown on screen.

import { CONFIG, type EngineApi, type GameState, type Move, type StepResult } from '../engine';
import { buildRecord, type MemoryLog } from '../logger';
import { HumanPlayer, type Player } from '../players';
import { runMatch, type MatchResult } from './match';
import { landingCells, previewMoves } from './thoughts';
import type { MatchView } from './view';

const THINK_MS = 900;
const SPAWN_MOVE = { column: CONFIG.spawnColumn, rotation: 0 } as const;

export interface SessionOptions {
  engine: EngineApi;
  players: [Player, Player];
  seed: number;
  view: MatchView;
  log: MemoryLog;
  onLogged?: (size: number) => void;
  signal: AbortSignal;
  /** Read live, so the slider also affects a match in progress. */
  speed: () => number;
  /** Plays moves through something other than `engine.step`. */
  step?: (state: GameState, move: Move) => Promise<StepResult>;
  /** A move has finished showing on screen. */
  onStepShown?: () => void;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export async function playSession(options: SessionOptions): Promise<MatchResult> {
  const { engine, players, seed, view, log, onLogged, signal, speed, step, onStepShown } = options;

  const showTurn = (state: GameState) => {
    const player = state.current;
    view.showState(state);
    view.setGhost(player, null);
    view.setThought(player, { status: 'thinking', text: '', items: [] });
    view.setLanePiece(player, { pair: state.players[player].pair, move: SPAWN_MOVE });
  };

  const result = await runMatch({
    engine,
    players,
    seed,
    signal,
    step,
    hooks: {
      onTurnStart: showTurn,

      onDecision: async (state, decision) => {
        const player = state.current;
        const candidates = decision.candidates ?? [decision.move];
        view.setThought(player, {
          status: 'decided',
          text: decision.thought ?? '',
          items: previewMoves(engine, state, candidates, decision.move),
        });
        view.setLanePiece(player, { pair: state.players[player].pair, move: decision.move });
        view.setGhost(player, landingCells(engine, state, decision.move));
        // A human has already seen their choice, so only AIs get a pause on screen.
        if (!(players[player] instanceof HumanPlayer)) await delay(THINK_MS / speed(), signal);
      },

      onStep: async (before, decision, stepResult) => {
        log.add(buildRecord(before, decision.move, stepResult));
        onLogged?.(log.size);
        const player = before.current;
        view.setLanePiece(player, null);
        view.setGhost(player, null);
        // One frame at a time, so that stopping cuts a long chain short.
        for (const frame of stepResult.frames) {
          if (signal.aborted) return;
          await view.playFrames([frame]);
        }
        if (signal.aborted) return;
        view.noteEvents(stepResult.events);
        view.showState(stepResult.next);
        onStepShown?.();
      },
    },
  });

  if (!result.aborted) {
    view.setLanePiece(0, null);
    view.setLanePiece(1, null);
    view.showState(result.finalState);
  }
  return result;
}

import { describe, expect, it } from 'vitest';
import { ruleEngine } from '../src/engine';
import { playSession } from '../src/game/session';
import type { MatchView } from '../src/game/view';
import { MemoryLog } from '../src/logger';
import { createAi, HumanPlayer, type Player } from '../src/players';

const silentView: MatchView = {
  showState() {},
  setThought() {},
  setLanePiece() {},
  setGhost() {},
  playFrames: () => Promise.resolve(),
  noteEvents() {},
};

function start(controller: AbortController, players: [Player, Player], view: MatchView = silentView) {
  const log = new MemoryLog();
  const done = playSession({
    engine: ruleEngine,
    players,
    seed: 5,
    view,
    log,
    signal: controller.signal,
    speed: () => 1e6,
  });
  return { log, done };
}

const randomPair = (): [Player, Player] => [createAi('random', ruleEngine, 5, 0), createAi('random', ruleEngine, 5, 1)];

describe('stopping a session', () => {
  it('plays to the end when nobody stops it', async () => {
    const { log, done } = start(new AbortController(), randomPair());
    const result = await done;
    expect(result.aborted).toBe(false);
    expect(result.winner).not.toBeNull();
    expect(log.size).toBe(result.turns);
  });

  it('ends while a human is choosing', async () => {
    const controller = new AbortController();
    const human = new HumanPlayer({ select: () => new Promise(() => {}) });
    const { log, done } = start(controller, [human, createAi('random', ruleEngine, 5, 1)]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    const result = await done;
    expect(result.aborted).toBe(true);
    expect(log.size).toBe(0);
  });

  it('cuts the animation short and reports the board after the last move', async () => {
    const controller = new AbortController();
    let played = 0;
    const view: MatchView = {
      ...silentView,
      playFrames: () => {
        played++;
        controller.abort();
        return Promise.resolve();
      },
    };
    const { log, done } = start(controller, randomPair(), view);
    const result = await done;
    expect(played).toBe(1);
    expect(log.size).toBe(1);
    expect(result.aborted).toBe(true);
    expect(result.finalState.turn).toBe(1);
  });
});

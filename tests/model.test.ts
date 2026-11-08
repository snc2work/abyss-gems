import { describe, expect, it } from 'vitest';
import { ruleEngine, type Board, type GameState } from '../src/engine';
import { runMatch } from '../src/game/match';
import { compareStep } from '../src/model/compare';
import { buildModelRequest, ModelError, parseModelReply, type ModelReply, type ModelRequest } from '../src/model/protocol';
import { rulesReply } from '../src/model/rulesModel';
import { ModelStepper } from '../src/model/stepper';
import { createAi } from '../src/players';

function fakeServer(answer: (request: ModelRequest) => unknown, status = 200): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = answer(JSON.parse(String(init?.body)));
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
}

const start = ruleEngine.initState(1);
const firstMove = { column: 0, rotation: 0 } as const;
const emptyBoard = start.players[0].board;

function makeStepper(answer: (request: ModelRequest) => unknown, status?: number) {
  return new ModelStepper(ruleEngine, 'http://model.test/step', new AbortController().signal, fakeServer(answer, status));
}

const rulesAnswer = (request: ModelRequest) => rulesReply(ruleEngine, request);

describe('the request', () => {
  it('is written from the mover\'s point of view, like a log line', () => {
    const state: GameState = { ...ruleEngine.step(start, firstMove).next };
    const request = buildModelRequest(state, firstMove);
    expect(request.player).toBe(1);
    expect(request.turn).toBe(1);
    expect(request.board_self).toEqual(state.players[1].board);
    expect(request.board_opp).toEqual(state.players[0].board);
    expect(request.move).toEqual(firstMove);
  });
});

describe('checking a reply', () => {
  const valid: ModelReply = {
    next_board_self: emptyBoard,
    next_board_opp: emptyBoard,
    next_pending: { self: 0, opp: 0 },
    events: { winner: null },
  };

  it('accepts the smallest valid reply', () => {
    expect(parseModelReply(JSON.parse(JSON.stringify(valid))).events.winner).toBeNull();
  });

  it.each([
    ['a wrong board size', { ...valid, next_board_self: emptyBoard.slice(1) }],
    ['a cell out of range', { ...valid, next_board_opp: emptyBoard.map((row) => row.map(() => 6)) }],
    ['no events', { ...valid, events: undefined }],
    ['a bad winner', { ...valid, events: { winner: 2 } }],
    ['a negative count', { ...valid, events: { winner: null, chains: -1 } }],
    ['no pending while the game goes on', { ...valid, next_pending: null }],
    ['a bad frame', { ...valid, frames: [{ kind: 'jump', player: 0, board: emptyBoard, chain: 0 }] }],
  ])('rejects %s', (_name, reply) => {
    expect(() => parseModelReply(reply)).toThrow(ModelError);
  });

  it('allows no pending once the game is over', () => {
    expect(parseModelReply({ ...valid, next_pending: null, events: { winner: 1 } }).next_pending).toBeNull();
  });
});

describe('comparing with the rules', () => {
  const rules = ruleEngine.step(start, firstMove);
  const reply = (): ModelReply => rulesReply(ruleEngine, buildModelRequest(start, firstMove));

  it('finds no difference in the rules\' own answer', () => {
    expect(compareStep(start, reply(), rules).matches).toBe(true);
  });

  it('points at a wrong cell on the right player\'s board', () => {
    const wrong = reply();
    const board: Board = wrong.next_board_self.map((row) => [...row]);
    board[12][5] = 1;
    const check = compareStep(start, { ...wrong, next_board_self: board }, rules);
    expect(check.matches).toBe(false);
    expect(check.cells[0]).toEqual([{ row: 12, col: 5 }]);
    expect(check.cells[1]).toEqual([]);
    expect(check.differences).toEqual(['1 cell']);
  });

  it('notices a wrong announcement, winner and event count', () => {
    const wrong = reply();
    const check = compareStep(start, { ...wrong, next_pending: { self: 3, opp: 0 }, events: { ...wrong.events, winner: 1, chains: 2 } }, rules);
    expect(check.differences).toEqual(['announced garbage', 'winner', 'chains']);
  });

  it('forgives garbage in other columns only when the rules chose them at random', () => {
    const withGarbage = (pending: number): GameState => {
      const players = [...start.players] as GameState['players'];
      players[1] = { ...players[1], pending };
      return { ...start, players };
    };
    const moveGarbage = (board: Board): Board => {
      const copy = board.map((row) => [...row]);
      const bottom = copy.length - 1;
      const from = copy[bottom].indexOf(5);
      const to = copy[bottom].indexOf(0);
      copy[bottom][from] = 0;
      copy[bottom][to] = 5;
      return copy;
    };

    const random = withGarbage(1);
    const randomRules = ruleEngine.step(random, firstMove);
    const randomReply = rulesReply(ruleEngine, buildModelRequest(random, firstMove));
    expect(compareStep(random, { ...randomReply, next_board_opp: moveGarbage(randomRules.next.players[1].board) }, randomRules).matches).toBe(true);

    // The columns may differ, but the amount of garbage still has to agree.
    const tooFew = randomRules.next.players[1].board.map((row) => row.map((cell) => (cell === 5 ? 0 : cell)));
    expect(compareStep(random, { ...randomReply, next_board_opp: tooFew }, randomRules).matches).toBe(false);

    const even = withGarbage(6);
    const evenRules = ruleEngine.step(even, firstMove);
    const evenReply = rulesReply(ruleEngine, buildModelRequest(even, firstMove));
    const wrongColumns = evenRules.next.players[1].board.map((row, index) =>
      index === 12 ? [0, 5, 5, 5, 5, 5] : index === 11 ? [5, 0, 0, 0, 0, 0] : row,
    );
    expect(compareStep(even, { ...evenReply, next_board_opp: wrongColumns }, evenRules).matches).toBe(false);
  });
});

describe('playing through a model server', () => {
  it('finishes a match, garbage included, and matches the rules on every move', async () => {
    let fallen = 0;
    const stepper = makeStepper(rulesAnswer);
    const result = await runMatch({
      engine: ruleEngine,
      players: [createAi('chain', ruleEngine, 70, 0), createAi('chain', ruleEngine, 70, 1)],
      seed: 70,
      maxTurns: 400,
      step: stepper.step,
      hooks: {
        onStep: (_before, _decision, stepResult) => {
          fallen += stepResult.events.garbageFallen;
        },
      },
    });
    expect(result.winner).not.toBeNull();
    expect(fallen).toBeGreaterThan(0);
    expect(stepper.total).toBe(result.turns);
    expect(stepper.matched).toBe(stepper.total);
  }, 60000);

  it('takes the boards from the model and the block sequence from the rules', async () => {
    const board = emptyBoard.map((row) => [...row]);
    board[12][5] = 2;
    const stepper = makeStepper(() => ({
      next_board_self: board,
      next_board_opp: emptyBoard,
      next_pending: { self: 4, opp: 2 },
      events: { winner: null, chains: 3 },
    }));
    const { next, frames, events } = await stepper.step(start, firstMove);
    expect(next.players[0].board).toEqual(board);
    expect(next.players[1].pending).toBe(4);
    expect(next.players[0].pending).toBe(2);
    expect(next.players[0].pair).toEqual(start.players[0].next);
    expect(next.current).toBe(1);
    expect(next.turn).toBe(1);
    expect(events.chains).toBe(3);
    expect(events.cleared).toBe(0);
    expect(frames.map((frame) => frame.player)).toEqual([0, 1]);
    expect(stepper.matched).toBe(0);
    expect(stepper.total).toBe(1);
  });

  it('uses the model\'s winner to end the game', async () => {
    const stepper = makeStepper((request) => ({ ...rulesAnswer(request), events: { winner: 1 } }));
    const { next } = await stepper.step(start, firstMove);
    expect(next.winner).toBe(1);
  });

  it('keeps the pending garbage from before the move when the model ends the game', async () => {
    const players = [...start.players] as GameState['players'];
    players[0] = { ...players[0], pending: 3 };
    players[1] = { ...players[1], pending: 7 };
    const before: GameState = { ...start, players };
    const stepper = makeStepper((request) => ({ ...rulesAnswer(request), next_pending: null, events: { winner: 1 } }));
    const { next } = await stepper.step(before, firstMove);
    expect(next.players.map((player) => player.pending)).toEqual([3, 7]);
  });

  it('reports an HTTP error, a broken reply and an unreachable server', async () => {
    await expect(makeStepper(rulesAnswer, 500).step(start, firstMove)).rejects.toThrow('HTTP 500');
    await expect(makeStepper(() => 'not json').step(start, firstMove)).rejects.toThrow('not valid JSON');
    await expect(makeStepper(() => ({ next_pending: { self: 0, opp: 0 }, events: { winner: null } })).step(start, firstMove)).rejects.toThrow('next_board_self');
    const offline = new ModelStepper(ruleEngine, 'http://model.test/step', new AbortController().signal, (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch);
    await expect(offline.step(start, firstMove)).rejects.toThrow('could not reach');
  });

  it('rejects a board that leaves no legal move without a winner', async () => {
    const full = emptyBoard.map((row) => row.map(() => 5));
    const stepper = makeStepper(() => ({
      next_board_self: emptyBoard,
      next_board_opp: full,
      next_pending: { self: 0, opp: 0 },
      events: { winner: null },
    }));
    await expect(stepper.step(start, firstMove)).rejects.toThrow('no legal move');
  });

  it('stops waiting when the match is stopped', async () => {
    const controller = new AbortController();
    const stepper = new ModelStepper(ruleEngine, 'http://model.test/step', controller.signal, (() => new Promise(() => {})) as typeof fetch);
    const done = runMatch({
      engine: ruleEngine,
      players: [createAi('random', ruleEngine, 1, 0), createAi('random', ruleEngine, 1, 1)],
      seed: 1,
      signal: controller.signal,
      step: stepper.step,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    expect((await done).aborted).toBe(true);
  });
});

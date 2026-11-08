import '@fontsource/zen-dots/400.css';
import '@fontsource/zen-kaku-gothic-new/500.css';
import '@fontsource/zen-kaku-gothic-new/700.css';
import './style.css';

import { ruleEngine, type PlayerId } from './engine';
import { playSession } from './game/session';
import { MemoryLog } from './logger';
import { downloadText } from './logger/download';
import { checkThought } from './model/compare';
import { ModelError } from './model/protocol';
import { isLocalModelId, loadLocalModel } from './model/localModel';
import { ModelStepper } from './model/stepper';
import { createAi, HumanPlayer, isAiKind, type AiKind, type Player } from './players';
import { GameRenderer } from './render/renderer';
import { BrowserMoveInput } from './ui/humanInput';

function element<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const stageElement = element<HTMLDivElement>('stage');
const modeSelect = element<HTMLSelectElement>('mode');
const p1Field = element<HTMLLabelElement>('p1-field');
const p1Select = element<HTMLSelectElement>('p1');
const p2Select = element<HTMLSelectElement>('p2');
const engineSelect = element<HTMLSelectElement>('engine');
const modelField = element<HTMLLabelElement>('model-field');
const modelSelect = element<HTMLSelectElement>('model');
const modelUrlField = element<HTMLLabelElement>('model-url-field');
const modelUrlInput = element<HTMLInputElement>('model-url');
const seedInput = element<HTMLInputElement>('seed');
const rollButton = element<HTMLButtonElement>('roll');
const startButton = element<HTMLButtonElement>('start');
const stopButton = element<HTMLButtonElement>('stop');
const speedInput = element<HTMLInputElement>('speed');
const speedLabel = element<HTMLOutputElement>('speed-label');
const downloadButton = element<HTMLButtonElement>('download');
const logCount = element<HTMLSpanElement>('log-count');

/** The slider is linear in log2, from 1/4x to 16x. */
function currentSpeed(): number {
  return 2 ** Number(speedInput.value);
}

function updateSpeed(): void {
  const speed = currentSpeed();
  speedLabel.textContent = `${speed < 1 ? speed.toFixed(2) : speed}x`;
  renderer.setSpeed(speed);
}

function rollSeed(): void {
  seedInput.value = String(Math.floor(Math.random() * 1_000_000));
}

function aiKindOf(select: HTMLSelectElement): AiKind {
  return isAiKind(select.value) ? select.value : 'chain';
}

function updateModeFields(): void {
  p1Field.hidden = modeSelect.value === 'human';
  modelField.hidden = engineSelect.value !== 'model';
  modelUrlField.hidden = modelField.hidden || modelSelect.value !== 'server';
}

/** The models shipped with the game run in the page; `server` asks the URL instead. */
function modelSource(): string | ReturnType<typeof loadLocalModel> {
  return isLocalModelId(modelSelect.value) ? loadLocalModel(modelSelect.value) : modelUrlInput.value;
}

/** `?model=frames-short` (or any model id) opens the page with that world model. */
function applyAddress(): void {
  const model = new URLSearchParams(location.search).get('model');
  if (model === null || ![...modelSelect.options].some((option) => option.value === model)) return;
  engineSelect.value = 'model';
  modelSelect.value = model;
}

const renderer = new GameRenderer(stageElement);
const humanInput = new BrowserMoveInput(ruleEngine, renderer, renderer, stageElement);

let controller: AbortController | null = null;
let log = new MemoryLog();
let logFileName = '';

/** Focus on a control would swallow the keys meant for the game. */
function releaseFocus(): void {
  (document.activeElement as HTMLElement | null)?.blur();
}

/** Ends the match where it stands. Its log stays available for saving. */
function stopMatch(): void {
  controller?.abort();
  humanInput.cancel();
  for (const player of [0, 1] as const) {
    renderer.setLanePiece(player, null);
    renderer.setGhost(player, null);
  }
  if (modeSelect.value === 'human') renderer.setThought(0, null);
  renderer.setNotice('Stopped');
  stopButton.disabled = true;
  releaseFocus();
}

/** A broken or unreachable model ends the match; the reason goes in the bubble. */
function showModelError(message: string): void {
  console.error(`World model: ${message}`);
  renderer.setLanePiece(0, null);
  renderer.setLanePiece(1, null);
  renderer.setGhost(0, null);
  renderer.setGhost(1, null);
  renderer.setThought(0, { status: 'decided', text: `Model error: ${message}`, items: [] });
  renderer.setNotice('Model error');
  stopButton.disabled = true;
}

function startMatch(): void {
  controller?.abort();
  humanInput.cancel();
  const abort = new AbortController();
  controller = abort;

  const seed = Number(seedInput.value) >>> 0;
  seedInput.value = String(seed);
  const makeAi = (select: HTMLSelectElement, seat: PlayerId): Player =>
    createAi(aiKindOf(select), ruleEngine, seed, seat);
  const players: [Player, Player] = [
    modeSelect.value === 'human' ? new HumanPlayer(humanInput) : makeAi(p1Select, 0),
    makeAi(p2Select, 1),
  ];

  // Model answers are kept apart by name, so they never pass for real game data.
  const stepper = engineSelect.value === 'model' ? new ModelStepper(ruleEngine, modelSource(), abort.signal) : null;
  log = new MemoryLog();
  const modelName = modelSelect.value === 'server' ? 'model' : modelSelect.value;
  logFileName = `abyss-gems-${stepper ? `${modelName}-` : ''}seed${seed}.jsonl`;
  logCount.textContent = '0';
  const humanSeat = modeSelect.value === 'human';
  renderer.reset([
    { name: players[0].name, avatar: humanSeat ? 'human' : aiKindOf(p1Select) },
    { name: players[1].name, avatar: aiKindOf(p2Select) },
  ]);
  updateSpeed();
  stopButton.disabled = false;
  releaseFocus();

  void playSession({
    engine: ruleEngine,
    players,
    seed,
    view: renderer,
    log,
    onLogged: (size) => {
      logCount.textContent = String(size);
    },
    signal: abort.signal,
    speed: currentSpeed,
    step: stepper
      ? (state, move) => {
          renderer.setDifferences([[], []]);
          return stepper.step(state, move);
        }
      : undefined,
    onStepShown: () => {
      if (!stepper?.last) return;
      const { before, model, rules, check } = stepper.last;
      renderer.setDifferences(check.cells);
      renderer.setThought(before.current, checkThought(before, model, rules, check, stepper.matched, stepper.total));
    },
  })
    .then((result) => {
      // A restart has already replaced this match; leave the screen to the new one.
      if (controller !== abort) return;
      // Stopping can cut an animation short, so settle on the last real board.
      if (result.aborted) renderer.showState(result.finalState);
      stopButton.disabled = true;
    })
    .catch((error: unknown) => {
      if (controller !== abort) return;
      if (!(error instanceof ModelError)) throw error;
      showModelError(error.message);
    });
}

modeSelect.addEventListener('change', updateModeFields);
engineSelect.addEventListener('change', updateModeFields);
modelSelect.addEventListener('change', updateModeFields);
rollButton.addEventListener('click', rollSeed);
startButton.addEventListener('click', startMatch);
stopButton.addEventListener('click', stopMatch);
speedInput.addEventListener('input', updateSpeed);
downloadButton.addEventListener('click', () => {
  downloadText(log.toJsonl(), logFileName);
});

rollSeed();
applyAddress();
updateModeFields();
updateSpeed();

// Canvas text does not trigger font loading by itself.
await Promise.allSettled([
  document.fonts.load('16px "Zen Dots"', 'ABYSS GEMS 0123'),
  document.fonts.load('500 16px "Zen Kaku Gothic New"', 'Garbage incoming 0123'),
  document.fonts.load('700 16px "Zen Kaku Gothic New"', 'Garbage incoming 0123'),
]);
startMatch();

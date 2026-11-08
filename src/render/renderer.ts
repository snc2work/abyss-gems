// Draws a whole match on a 2D canvas. If WebGL is available, the canvas is shown
// through Stage3D, which adds the backdrop, bloom and particles.
// Depends on the engine's data types only, never on how the rules work.

import { CONFIG, type Board, type BoardFrame, type Events, type GameState, type Pair, type PlayerId } from '../engine';
import type { CellPosition, GhostCell, LanePiece, MatchView, ThoughtView } from '../game/view';
import { drawAvatar, type AvatarKind, type AvatarMood } from './avatars';
import { cellKey, drawBoard, drawCell, movedMask } from './blocks';
import { drawThoughtBubble } from './bubble';
import { Stage3D } from './stage3d';
import {
  AVATAR,
  BLOCKS,
  CELL,
  CENTER,
  FONT_BODY,
  FONT_DISPLAY,
  GARBAGE_COLOR,
  INK,
  LANE,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  SEATS,
  SEAT_ACCENT,
  STATS_WIDTH,
  TAG_Y,
  WELL_HEIGHT,
  WELL_WIDTH,
  WELL_Y,
} from './theme';

const SEAT_IDS: readonly PlayerId[] = [0, 1];
const PLACE_MS = 110;
const FALL_MS = 34;
const CLEAR_MS = 420;
const GARBAGE_MS = 34;
const CHAIN_LABEL_MS = 950;

interface Motion {
  moved: boolean[][];
  start: number;
  duration: number;
}

interface Flash {
  cells: { row: number; col: number; color: number }[];
  hidden: Set<number>;
  start: number;
  duration: number;
}

export interface SeatProfile {
  name: string;
  avatar: AvatarKind;
}

interface SeatView {
  name: string;
  avatar: AvatarKind;
  board: Board;
  motion: Motion | null;
  flash: Flash | null;
  thought: ThoughtView | null;
  lane: LanePiece | null;
  laneX: number;
  ghost: GhostCell[] | null;
  chainLabel: { chain: number; start: number } | null;
  stats: { cleared: number; maxChain: number; sent: number };
}

function emptyBoardLike(): Board {
  const rows = CONFIG.visibleRows + CONFIG.hiddenRows;
  return Array.from({ length: rows }, () => new Array<number>(CONFIG.columns).fill(0));
}

function newSeat({ name, avatar }: SeatProfile): SeatView {
  return {
    name,
    avatar,
    board: emptyBoardLike(),
    motion: null,
    flash: null,
    thought: null,
    lane: null,
    laneX: CONFIG.spawnColumn,
    ghost: null,
    chainLabel: null,
    stats: { cleared: 0, maxChain: 0, sent: 0 },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GameRenderer implements MatchView {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly stage: Stage3D | null;
  private pixelScale = 1;
  /** CSS pixels per logical unit. */
  private fit = 1;
  private seats: [SeatView, SeatView] = [newSeat({ name: '', avatar: 'human' }), newSeat({ name: '', avatar: 'greedy' })];
  private state: GameState | null = null;
  private speed = 1;
  private generation = 0;
  private lastFrameAt = 0;
  private notice: string | null = null;
  /** Cells where a world model disagreed with the rules, by player id. */
  private differences: [ReadonlyArray<CellPosition>, ReadonlyArray<CellPosition>] = [[], []];

  constructor(private readonly container: HTMLElement) {
    this.stage = this.createStage();
    container.appendChild(this.stage ? this.stage.element : this.canvas);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    requestAnimationFrame(this.tick);
  }

  private createStage(): Stage3D | null {
    try {
      return new Stage3D(this.canvas, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    } catch (error) {
      console.warn('WebGL is unavailable; drawing without 3D effects.', error);
      return null;
    }
  }

  private resize(): void {
    const { width, height } = this.container.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    const fit = Math.min(width / LOGICAL_WIDTH, height / LOGICAL_HEIGHT);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);

    this.fit = fit;
    this.pixelScale = fit * ratio;
    this.canvas.width = Math.round(LOGICAL_WIDTH * this.pixelScale);
    this.canvas.height = Math.round(LOGICAL_HEIGHT * this.pixelScale);

    if (this.stage) {
      // The 3D view fills the container; the game is centered across it and sits at the top.
      this.stage.resize(Math.floor(width), Math.floor(height), ratio, fit);
    } else {
      this.canvas.style.width = `${Math.floor(LOGICAL_WIDTH * fit)}px`;
      this.canvas.style.height = `${Math.floor(LOGICAL_HEIGHT * fit)}px`;
    }
  }

  // --- Public controls ---

  /** Clears everything for a new match; a running playback stops itself. */
  reset(profiles: [SeatProfile, SeatProfile]): void {
    this.generation++;
    this.seats = [newSeat(profiles[0]), newSeat(profiles[1])];
    this.state = null;
    this.notice = null;
    this.differences = [[], []];
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  /** Replaces the turn indicator, for a match that was stopped. */
  setNotice(notice: string | null): void {
    this.notice = notice;
  }

  /** Outlines cells on each board; pass empty lists to clear them. */
  setDifferences(cells: [ReadonlyArray<CellPosition>, ReadonlyArray<CellPosition>]): void {
    this.differences = cells;
  }

  /** The well column under a pointer position, or null when outside that seat's well. */
  columnAt(player: PlayerId, clientX: number, clientY: number): number | null {
    // In both display modes the game area is centered horizontally, at the top.
    const rect = this.container.getBoundingClientRect();
    const x = (clientX - rect.left - (rect.width - LOGICAL_WIDTH * this.fit) / 2) / this.fit;
    const y = (clientY - rect.top) / this.fit;
    const { wellX } = SEATS[player];
    if (x < wellX || x >= wellX + WELL_WIDTH) return null;
    if (y < LANE.y || y >= WELL_Y + WELL_HEIGHT) return null;
    return Math.floor((x - wellX) / CELL);
  }

  // --- MatchView ---

  showState(state: GameState): void {
    this.state = state;
    SEAT_IDS.forEach((id) => {
      const seat = this.seats[id];
      seat.board = state.players[id].board;
      seat.motion = null;
      seat.flash = null;
    });
  }

  setThought(player: PlayerId, thought: ThoughtView | null): void {
    this.seats[player].thought = thought;
  }

  setLanePiece(player: PlayerId, piece: LanePiece | null): void {
    const seat = this.seats[player];
    if (!seat.lane && piece) seat.laneX = piece.move.column;
    seat.lane = piece;
  }

  setGhost(player: PlayerId, cells: GhostCell[] | null): void {
    this.seats[player].ghost = cells;
  }

  async playFrames(frames: BoardFrame[]): Promise<void> {
    const generation = this.generation;
    for (const frame of frames) {
      if (generation !== this.generation) return;
      const seat = this.seats[frame.player];
      const now = performance.now();

      if (frame.kind === 'clear') {
        const duration = CLEAR_MS / this.speed;
        const cells = frame.cleared ?? [];
        seat.flash = {
          cells,
          hidden: new Set(cells.map((cell) => cellKey(cell.row, cell.col))),
          start: now,
          duration,
        };
        seat.chainLabel = { chain: frame.chain, start: now };
        this.emitClearEffects(frame);
        await sleep(duration);
        if (generation !== this.generation) return;
        seat.flash = null;
        seat.motion = null;
        seat.board = frame.board;
        continue;
      }

      const base = frame.kind === 'place' ? PLACE_MS : frame.kind === 'garbage' ? GARBAGE_MS : FALL_MS;
      const duration = base / this.speed;
      seat.motion =
        frame.kind === 'place' ? null : { moved: movedMask(seat.board, frame.board), start: now, duration };
      seat.board = frame.board;
      await sleep(duration);
    }
  }

  noteEvents(events: Events): void {
    const seat = this.seats[events.player];
    seat.stats.cleared += events.cleared + events.clearedGarbage;
    seat.stats.maxChain = Math.max(seat.stats.maxChain, events.chains);
    seat.stats.sent += events.garbageSent;
  }

  // --- Effects ---

  private emitClearEffects(frame: BoardFrame): void {
    if (!this.stage) return;
    const { wellX } = SEATS[frame.player];
    const power = 1 + Math.min(frame.chain - 1, 5) * 0.25;
    for (const cell of frame.cleared ?? []) {
      const x = wellX + (cell.col + 0.5) * CELL;
      const y = WELL_Y + (cell.row - CONFIG.hiddenRows + 0.5) * CELL;
      const color = cell.color === CONFIG.garbageCell ? GARBAGE_COLOR : BLOCKS[cell.color].body;
      this.stage.burst(x, y, color, cell.color === CONFIG.garbageCell ? 6 : 16, power);
    }
    this.stage.flash(0.16 * frame.chain);
  }

  // --- Drawing ---

  private tick = (now: number): void => {
    const delta = Math.min(50, now - this.lastFrameAt);
    this.lastFrameAt = now;
    this.draw(now, delta);
    this.stage?.render();
    requestAnimationFrame(this.tick);
  };

  private draw(now: number, delta: number): void {
    const ctx = this.ctx;
    ctx.setTransform(this.pixelScale, 0, 0, this.pixelScale, 0, 0);
    ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    SEAT_IDS.forEach((id) => this.drawSeat(id, now, delta));
    this.drawCenter(now);
  }

  private isActive(id: PlayerId): boolean {
    return this.notice === null && this.state !== null && this.state.winner === null && this.state.current === id;
  }

  private drawSeat(id: PlayerId, now: number, delta: number): void {
    const ctx = this.ctx;
    const layout = SEATS[id];
    const seat = this.seats[id];
    const accent = SEAT_ACCENT[id];
    const active = this.isActive(id);

    drawThoughtBubble(ctx, seat.thought, layout.bubbleX, accent, active, layout.avatarX, now);
    // Each character faces the middle of the screen.
    drawAvatar(ctx, seat.avatar, layout.avatarX, AVATAR.y, AVATAR.radius, this.moodOf(id), accent, active, id === 1, now);

    // Name tag between the bubble and the well.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 13px ${FONT_BODY}`;
    ctx.fillStyle = active ? accent : INK.dim;
    ctx.fillText(`P${id + 1}  ${seat.name}`, layout.avatarX, TAG_Y);

    this.drawWell(id, now);
    this.drawLane(id, delta);
    this.drawStats(id);
  }

  private moodOf(id: PlayerId): AvatarMood {
    const winner = this.state?.winner;
    if (winner !== null && winner !== undefined) return winner === id ? 'win' : 'lose';
    const seat = this.seats[id];
    if (seat.chainLabel) return 'excited';
    if (!this.isActive(id)) return 'idle';
    return seat.thought?.status === 'thinking' ? 'thinking' : 'decided';
  }

  private drawLane(id: PlayerId, delta: number): void {
    const ctx = this.ctx;
    const { wellX } = SEATS[id];
    const seat = this.seats[id];
    if (!seat.lane) return;

    const { pair, move } = seat.lane;
    seat.laneX += (move.column - seat.laneX) * Math.min(1, delta * 0.024);
    if (Math.abs(move.column - seat.laneX) < 0.01) seat.laneX = move.column;

    const columnX = (col: number) => wellX + (col + 0.5) * CELL;
    const axisX = columnX(seat.laneX);
    const upperY = LANE.y + CELL / 2;
    const lowerY = LANE.y + CELL * 1.5;

    let axisY = lowerY;
    let childX = axisX;
    let childY = upperY;
    if (move.rotation === 1) [childX, childY] = [axisX + CELL, lowerY];
    if (move.rotation === 2) [axisY, childY] = [upperY, lowerY];
    if (move.rotation === 3) [childX, childY] = [axisX - CELL, lowerY];

    // Guide beam down the target columns.
    const accent = SEAT_ACCENT[id];
    const childColumn = move.column + (move.rotation === 1 ? 1 : move.rotation === 3 ? -1 : 0);
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = accent;
    for (const col of new Set([move.column, childColumn])) {
      ctx.fillRect(wellX + col * CELL, LANE.y, CELL, LANE.height + WELL_HEIGHT);
    }
    ctx.globalAlpha = 1;

    drawCell(ctx, pair[0], axisX, axisY, CELL, this.pixelScale);
    drawCell(ctx, pair[1], childX, childY, CELL, this.pixelScale);
  }

  private drawWell(id: PlayerId, now: number): void {
    const ctx = this.ctx;
    const { wellX } = SEATS[id];
    const seat = this.seats[id];
    const accent = SEAT_ACCENT[id];
    const active = this.isActive(id);
    const lost = this.state?.winner !== null && this.state?.winner !== undefined && this.state.winner !== id;

    ctx.fillStyle = INK.well;
    ctx.fillRect(wellX, WELL_Y, WELL_WIDTH, WELL_HEIGHT);

    // Grid of small crosses instead of full lines.
    ctx.fillStyle = 'rgba(130, 200, 225, 0.16)';
    for (let col = 1; col < CONFIG.columns; col++) {
      for (let row = 1; row < CONFIG.visibleRows; row++) {
        ctx.fillRect(wellX + col * CELL - 2, WELL_Y + row * CELL - 0.5, 4, 1);
        ctx.fillRect(wellX + col * CELL - 0.5, WELL_Y + row * CELL - 2, 1, 4);
      }
    }

    this.drawSpawnMarker(id, now);

    ctx.save();
    ctx.beginPath();
    ctx.rect(wellX, WELL_Y, WELL_WIDTH, WELL_HEIGHT);
    ctx.clip();

    const motion = seat.motion;
    const progress = motion ? Math.min(1, (now - motion.start) / Math.max(1, motion.duration)) : 1;
    drawBoard(ctx, seat.board, wellX, WELL_Y, CELL, this.pixelScale, {
      firstRow: CONFIG.hiddenRows,
      moved: motion?.moved,
      lift: 1 - progress,
      hidden: seat.flash?.hidden,
    });
    if (seat.flash) this.drawFlash(seat.flash, wellX, now);

    if (seat.ghost) {
      ctx.globalAlpha = 0.42 + Math.sin(now / 180) * 0.1;
      for (const cell of seat.ghost) {
        if (cell.row < CONFIG.hiddenRows) continue;
        drawCell(
          ctx,
          cell.color,
          wellX + (cell.col + 0.5) * CELL,
          WELL_Y + (cell.row - CONFIG.hiddenRows + 0.5) * CELL,
          CELL,
          this.pixelScale,
          0.82,
        );
      }
      ctx.globalAlpha = 1;
    }

    ctx.lineWidth = 2;
    ctx.strokeStyle = INK.danger;
    for (const cell of this.differences[id]) {
      if (cell.row < CONFIG.hiddenRows) continue;
      ctx.strokeRect(wellX + cell.col * CELL + 2, WELL_Y + (cell.row - CONFIG.hiddenRows) * CELL + 2, CELL - 4, CELL - 4);
    }

    if (lost) {
      ctx.fillStyle = 'rgba(2, 5, 10, 0.68)';
      ctx.fillRect(wellX, WELL_Y, WELL_WIDTH, WELL_HEIGHT);
    }
    ctx.restore();

    // Frame: a brighter pulse while it is this seat's turn.
    const pulse = active ? 0.65 + Math.sin(now / 420) * 0.25 : 0.25;
    ctx.globalAlpha = pulse;
    ctx.lineWidth = active ? 2 : 1;
    ctx.strokeStyle = active ? accent : INK.dim;
    ctx.strokeRect(wellX - 1, WELL_Y - 1, WELL_WIDTH + 2, WELL_HEIGHT + 2);
    ctx.globalAlpha = 1;

    this.drawChainLabel(id, now);
    this.drawResultBadge(id);
  }

  private drawSpawnMarker(id: PlayerId, now: number): void {
    const ctx = this.ctx;
    const { wellX } = SEATS[id];
    const board = this.seats[id].board;
    const x = wellX + (CONFIG.spawnColumn + 0.5) * CELL;
    const y = WELL_Y + (CONFIG.spawnRow - CONFIG.hiddenRows + 0.5) * CELL;

    let top = 0;
    while (top < board.length && board[top][CONFIG.spawnColumn] === 0) top++;
    const distance = top - CONFIG.spawnRow;
    const danger = distance <= 3;

    ctx.strokeStyle = danger ? INK.danger : 'rgba(150, 190, 205, 0.32)';
    ctx.globalAlpha = danger ? 0.65 + Math.sin(now / 130) * 0.35 : 1;
    ctx.lineWidth = 1.5;
    const r = 8;
    ctx.beginPath();
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r);
    ctx.lineTo(x - r, y + r);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawFlash(flash: Flash, wellX: number, now: number): void {
    const ctx = this.ctx;
    const t = Math.min(1, (now - flash.start) / Math.max(1, flash.duration));
    for (const cell of flash.cells) {
      const x = wellX + (cell.col + 0.5) * CELL;
      const y = WELL_Y + (cell.row - CONFIG.hiddenRows + 0.5) * CELL;
      ctx.globalAlpha = 1 - t;
      drawCell(ctx, cell.color, x, y, CELL, this.pixelScale, 1 + t * 0.5);
      const half = (CELL / 2) * (1 - t * 0.3);
      ctx.globalAlpha = Math.sin(t * Math.PI) * 0.85;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - half, y - half, half * 2, half * 2);
    }
    ctx.globalAlpha = 1;
  }

  private drawChainLabel(id: PlayerId, now: number): void {
    const seat = this.seats[id];
    if (!seat.chainLabel) return;
    const elapsed = (now - seat.chainLabel.start) * this.speed;
    if (elapsed > CHAIN_LABEL_MS) {
      seat.chainLabel = null;
      return;
    }
    const ctx = this.ctx;
    const { wellX } = SEATS[id];
    const t = elapsed / CHAIN_LABEL_MS;
    const size = 46 + seat.chainLabel.chain * 6;
    const scale = 1 + (1 - Math.min(1, t * 5)) * 0.5;

    ctx.save();
    ctx.translate(wellX + WELL_WIDTH / 2, WELL_Y + WELL_HEIGHT * 0.42 - t * 26);
    ctx.scale(scale, scale);
    ctx.globalAlpha = t < 0.7 ? 1 : (1 - t) / 0.3;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(2, 8, 14, 0.85)';
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${size}px ${FONT_BODY}`;
    ctx.strokeText(String(seat.chainLabel.chain), 0, -14);
    ctx.fillText(String(seat.chainLabel.chain), 0, -14);
    ctx.font = `700 22px ${FONT_BODY}`;
    ctx.strokeText('CHAIN', 0, 28);
    ctx.fillText('CHAIN', 0, 28);
    ctx.restore();
  }

  private drawResultBadge(id: PlayerId): void {
    const winner = this.state?.winner;
    if (winner === null || winner === undefined) return;
    const ctx = this.ctx;
    const { wellX } = SEATS[id];
    const won = winner === id;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `44px ${FONT_DISPLAY}`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(2, 8, 14, 0.9)';
    ctx.fillStyle = won ? SEAT_ACCENT[id] : INK.dim;
    const x = wellX + WELL_WIDTH / 2;
    const y = WELL_Y + WELL_HEIGHT / 2;
    ctx.strokeText(won ? 'WIN' : 'LOSE', x, y);
    ctx.fillText(won ? 'WIN' : 'LOSE', x, y);
  }

  private drawStats(id: PlayerId): void {
    const ctx = this.ctx;
    const layout = SEATS[id];
    const { stats } = this.seats[id];
    const entries: [string, number][] = [
      ['Cleared', stats.cleared],
      ['Max chain', stats.maxChain],
      ['Sent', stats.sent],
    ];
    // The stats sit directly on the cavern, so they need their own backing.
    const panelX = layout.statsAlign === 'right' ? layout.statsX + 8 - STATS_WIDTH : layout.statsX - 8;
    this.panel(panelX, WELL_Y, STATS_WIDTH, 226, SEAT_ACCENT[id]);

    ctx.textAlign = layout.statsAlign;
    entries.forEach(([label, value], index) => {
      const y = WELL_Y + 8 + index * 72;
      ctx.textBaseline = 'top';
      ctx.font = `500 12px ${FONT_BODY}`;
      ctx.fillStyle = INK.dim;
      ctx.fillText(label, layout.statsX, y);
      ctx.font = `700 28px ${FONT_BODY}`;
      ctx.fillStyle = INK.text;
      ctx.fillText(String(value), layout.statsX, y + 16);
    });
  }

  private drawCenter(now: number): void {
    const ctx = this.ctx;
    const { midline, left, right } = CENTER;
    const state = this.state;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `16px ${FONT_DISPLAY}`;
    ctx.fillStyle = '#d9f6ff';
    ctx.fillText('ABYSS', midline, 160);
    ctx.fillText('GEMS', midline, 180);
    if (state) {
      ctx.font = `700 11px ${FONT_BODY}`;
      ctx.fillStyle = INK.dim;
      ctx.fillText(`Turn ${state.turn}`, midline, 198);
    }
    this.drawTurnIndicator(now);

    const gap = 8;
    const columnWidth = (right - left - gap) / 2;
    SEAT_IDS.forEach((id) => {
      this.drawPlayerCard(id, left + (id === 0 ? 0 : columnWidth + gap), WELL_Y, columnWidth);
    });
  }

  private drawTurnIndicator(now: number): void {
    const ctx = this.ctx;
    const state = this.state;
    if (!state) return;
    const { midline } = CENTER;
    const y = 214;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 14px ${FONT_BODY}`;
    if (state.winner !== null) {
      ctx.fillStyle = SEAT_ACCENT[state.winner];
      ctx.fillText(`P${state.winner + 1} wins!`, midline, y);
      return;
    }
    if (this.notice !== null) {
      ctx.fillStyle = INK.dim;
      ctx.fillText(this.notice, midline, y);
      return;
    }

    const id = state.current;
    const label = `P${id + 1} ${this.seats[id].name}`;
    ctx.fillStyle = SEAT_ACCENT[id];
    ctx.fillText(label, midline, y);

    // A small arrow toward the board that is about to move.
    const direction = id === 0 ? -1 : 1;
    const tipX = midline + direction * (ctx.measureText(label).width / 2 + 14 + Math.sin(now / 240) * 2);
    ctx.beginPath();
    ctx.moveTo(tipX, y);
    ctx.lineTo(tipX - direction * 7, y - 5);
    ctx.lineTo(tipX - direction * 7, y + 5);
    ctx.closePath();
    ctx.fill();
  }

  private panel(x: number, y: number, width: number, height: number, accent: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = INK.panel;
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = INK.faint;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    // Bright corner ticks, like an instrument's bezel.
    ctx.strokeStyle = accent;
    const t = 8;
    const corners: [number, number, number, number][] = [
      [x, y, 1, 1],
      [x + width, y, -1, 1],
      [x, y + height, 1, -1],
      [x + width, y + height, -1, -1],
    ];
    ctx.beginPath();
    for (const [cx, cy, sx, sy] of corners) {
      ctx.moveTo(cx + sx * t, cy + sy * 0.5);
      ctx.lineTo(cx + sx * 0.5, cy + sy * 0.5);
      ctx.lineTo(cx + sx * 0.5, cy + sy * t);
    }
    ctx.stroke();
  }

  private drawPair(pair: Pair, cx: number, topY: number, cell: number): void {
    drawCell(this.ctx, pair[1], cx, topY + cell / 2, cell, this.pixelScale);
    drawCell(this.ctx, pair[0], cx, topY + cell * 1.5, cell, this.pixelScale);
  }

  private drawPlayerCard(id: PlayerId, x: number, y: number, width: number): void {
    const ctx = this.ctx;
    const accent = SEAT_ACCENT[id];
    const player = this.state?.players[id];
    const cx = x + width / 2;
    this.panel(x, y, width, 196, accent);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `700 11px ${FONT_BODY}`;
    ctx.fillStyle = accent;
    ctx.fillText(`P${id + 1} NEXT`, cx, y + 9);
    if (player) this.drawPair(player.next, cx, y + 27, 28);

    const dividerY = y + 94;
    ctx.strokeStyle = INK.faint;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 8, dividerY);
    ctx.lineTo(x + width - 8, dividerY);
    ctx.stroke();

    const pending = player?.pending ?? 0;
    ctx.font = `700 11px ${FONT_BODY}`;
    ctx.fillStyle = INK.dim;
    ctx.fillText('Garbage', cx, dividerY + 8);
    ctx.font = `700 26px ${FONT_BODY}`;
    ctx.fillStyle = pending > 0 ? INK.danger : INK.dim;
    ctx.fillText(String(pending), cx, dividerY + 24);
    this.drawPendingPips(pending, x + 8, dividerY + 62, width - 16);
  }

  /** A large pip stands for a full row (one block per column). */
  private drawPendingPips(pending: number, x: number, y: number, width: number): void {
    const rows = Math.floor(pending / CONFIG.columns);
    const singles = pending % CONFIG.columns;
    const large = 16;
    const small = 9;
    let cursor = x + large / 2;
    const maxX = x + width;
    for (let i = 0; i < rows && cursor + large / 2 <= maxX; i++) {
      drawCell(this.ctx, CONFIG.garbageCell, cursor, y + large / 2, large, this.pixelScale);
      cursor += large + 2;
    }
    cursor += small / 2 - large / 2;
    for (let i = 0; i < singles && cursor + small / 2 <= maxX; i++) {
      drawCell(this.ctx, CONFIG.garbageCell, cursor, y + large / 2, small, this.pixelScale);
      cursor += small + 2;
    }
  }
}

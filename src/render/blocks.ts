// Glass cells filled with light, drawn from cached sprites. Same-color neighbors
// are joined by channels of the same light, so groups read as one body.

import type { Board } from '../engine';
import { BLOCKS, GARBAGE_COLOR } from './theme';

const GARBAGE = 5;
const SPRITE_PADDING = 0.45;

const sprites = new Map<string, HTMLCanvasElement>();

function roundedSquare(g: CanvasRenderingContext2D, center: number, half: number, radius: number): void {
  g.beginPath();
  g.roundRect(center - half, center - half, half * 2, half * 2, radius);
}

/**
 * Faint inner structure, different per color, so that hue alone never has to
 * carry the meaning: ripples, filaments, bubbles and drifting currents.
 */
function paintInnerLight(g: CanvasRenderingContext2D, color: number, center: number, size: number): void {
  const palette = BLOCKS[color];
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = palette.core;
  g.lineCap = 'round';

  switch (color) {
    case 1: {
      g.lineWidth = size * 0.022;
      [0.12, 0.22, 0.33, 0.45].forEach((radius, index) => {
        g.globalAlpha = 0.42 - index * 0.08;
        g.beginPath();
        g.arc(center - size * 0.06, center + size * 0.06, size * radius, 0, Math.PI * 2);
        g.stroke();
      });
      break;
    }
    case 2: {
      g.lineWidth = size * 0.018;
      g.globalAlpha = 0.34;
      const strands = 13;
      for (let i = 0; i < strands; i++) {
        const angle = (i / strands) * Math.PI * 2;
        const bend = angle + 0.55;
        g.beginPath();
        g.moveTo(center + Math.cos(angle) * size * 0.05, center + Math.sin(angle) * size * 0.05);
        g.quadraticCurveTo(
          center + Math.cos(bend) * size * 0.28,
          center + Math.sin(bend) * size * 0.28,
          center + Math.cos(angle) * size * 0.52,
          center + Math.sin(angle) * size * 0.52,
        );
        g.stroke();
      }
      break;
    }
    case 3: {
      const bubbles: ReadonlyArray<readonly [number, number, number]> = [
        [-0.2, -0.16, 0.12], [0.14, -0.22, 0.08], [0.24, 0.06, 0.13], [-0.04, 0.05, 0.09],
        [-0.25, 0.2, 0.09], [0.06, 0.27, 0.1], [-0.3, -0.02, 0.05],
      ];
      for (const [dx, dy, radius] of bubbles) {
        const x = center + dx * size;
        const y = center + dy * size;
        const r = radius * size;
        const bubble = g.createRadialGradient(x, y, r * 0.35, x, y, r);
        bubble.addColorStop(0, 'rgba(255, 255, 255, 0)');
        bubble.addColorStop(0.75, 'rgba(255, 244, 205, 0.16)');
        bubble.addColorStop(1, 'rgba(255, 244, 205, 0.5)');
        g.fillStyle = bubble;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
      break;
    }
    default: {
      g.lineWidth = size * 0.03;
      [-0.26, -0.06, 0.14, 0.34].forEach((offset, index) => {
        g.globalAlpha = 0.36 - index * 0.05;
        const y = center + offset * size;
        g.beginPath();
        g.moveTo(center - size * 0.55, y + size * 0.14);
        g.bezierCurveTo(
          center - size * 0.2, y - size * 0.22,
          center + size * 0.12, y + size * 0.22,
          center + size * 0.55, y - size * 0.14,
        );
        g.stroke();
      });
      break;
    }
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

function paintColorCell(g: CanvasRenderingContext2D, color: number, center: number, size: number): void {
  const palette = BLOCKS[color];
  const half = size * 0.44;
  const radius = size * 0.2;

  // Halo around the cell.
  g.save();
  g.shadowColor = palette.body;
  g.shadowBlur = size * 0.2;
  roundedSquare(g, center, half, radius);
  g.fillStyle = palette.deep;
  g.fill();
  g.restore();

  // Light gel inside the glass: bright heart, dark rim.
  const gel = g.createRadialGradient(
    center - size * 0.05, center - size * 0.04, size * 0.02,
    center, center, half * 1.32,
  );
  gel.addColorStop(0, palette.body);
  gel.addColorStop(0.42, palette.body);
  gel.addColorStop(0.9, palette.deep);
  gel.addColorStop(1, palette.deep);
  roundedSquare(g, center, half, radius);
  g.fillStyle = gel;
  g.fill();

  g.save();
  roundedSquare(g, center, half, radius);
  g.clip();
  paintInnerLight(g, color, center, size);

  // Light caught at the bottom of the glass.
  const bounce = g.createRadialGradient(
    center + size * 0.1, center + size * 0.5, 0,
    center + size * 0.1, center + size * 0.5, size * 0.42,
  );
  bounce.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
  bounce.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = bounce;
  g.fillRect(center - size, center - size, size * 2, size * 2);
  g.restore();

  // Thin rim, brighter toward the top where the light comes from.
  const rim = g.createLinearGradient(0, center - half, 0, center + half);
  rim.addColorStop(0, 'rgba(255, 255, 255, 0.78)');
  rim.addColorStop(0.5, 'rgba(255, 255, 255, 0.14)');
  rim.addColorStop(1, 'rgba(255, 255, 255, 0.3)');
  g.lineWidth = Math.max(1, size * 0.028);
  g.strokeStyle = rim;
  roundedSquare(g, center, half - g.lineWidth / 2, radius);
  g.stroke();

  // Soft window reflection, upper left.
  g.save();
  g.translate(center - size * 0.17, center - size * 0.25);
  g.rotate(-0.42);
  g.scale(1, 0.42);
  const shine = g.createRadialGradient(0, 0, 0, 0, 0, size * 0.17);
  shine.addColorStop(0, 'rgba(255, 255, 255, 0.86)');
  shine.addColorStop(0.55, 'rgba(255, 255, 255, 0.28)');
  shine.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = shine;
  g.beginPath();
  g.arc(0, 0, size * 0.17, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function paintGarbageCell(g: CanvasRenderingContext2D, center: number, size: number): void {
  const half = size * 0.42;
  const radius = size * 0.08;
  const left = center - half;

  roundedSquare(g, center, half, radius);
  g.fillStyle = '#1c2933';
  g.fill();

  g.save();
  roundedSquare(g, center, half, radius);
  g.clip();
  g.strokeStyle = 'rgba(123, 141, 153, 0.42)';
  g.lineWidth = Math.max(1, size * 0.045);
  g.beginPath();
  for (let d = -half * 2; d < half * 2; d += size * 0.2) {
    g.moveTo(left + d, center + half);
    g.lineTo(left + d + half * 2, center - half);
  }
  g.stroke();
  g.restore();

  g.lineWidth = Math.max(1, size * 0.035);
  g.strokeStyle = GARBAGE_COLOR;
  roundedSquare(g, center, half, radius);
  g.stroke();
}

function spriteFor(color: number, pixelSize: number): HTMLCanvasElement {
  const key = `${color}:${pixelSize}`;
  const cached = sprites.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  const total = Math.ceil(pixelSize * (1 + SPRITE_PADDING * 2));
  canvas.width = total;
  canvas.height = total;
  const g = canvas.getContext('2d')!;
  if (color === GARBAGE) paintGarbageCell(g, total / 2, pixelSize);
  else paintColorCell(g, color, total / 2, pixelSize);
  sprites.set(key, canvas);
  return canvas;
}

/** Draws one cell centered at (cx, cy) in logical coordinates. */
export function drawCell(
  ctx: CanvasRenderingContext2D,
  color: number,
  cx: number,
  cy: number,
  cell: number,
  pixelScale: number,
  sizeFactor = 1,
): void {
  const sprite = spriteFor(color, Math.max(4, Math.round(cell * pixelScale)));
  const drawn = cell * (1 + SPRITE_PADDING * 2) * sizeFactor;
  ctx.drawImage(sprite, cx - drawn / 2, cy - drawn / 2, drawn, drawn);
}

/**
 * For each cell of `next`, whether it moved down one row from `prev`.
 * A block moves exactly when there was a gap somewhere below it.
 */
export function movedMask(prev: Board, next: Board): boolean[][] {
  const mask = next.map((row) => row.map(() => false));
  const columns = prev[0].length;
  for (let col = 0; col < columns; col++) {
    let gapBelow = false;
    for (let row = prev.length - 1; row >= 0; row--) {
      if (prev[row][col] === 0) gapBelow = true;
      else if (gapBelow && row + 1 < next.length) mask[row + 1][col] = true;
    }
  }
  return mask;
}

export interface BoardDrawOptions {
  firstRow: number;
  /** Cells that are mid-fall, and how far above their final position they are (0-1 cells). */
  moved?: boolean[][];
  lift?: number;
  hidden?: ReadonlySet<number>;
}

export function cellKey(row: number, col: number): number {
  return row * 100 + col;
}

/** (originX, originY) is the top-left of `firstRow`. */
export function drawBoard(
  ctx: CanvasRenderingContext2D,
  board: Board,
  originX: number,
  originY: number,
  cell: number,
  pixelScale: number,
  options: BoardDrawOptions,
): void {
  const { firstRow, moved, lift = 0, hidden } = options;
  const centerX = (col: number) => originX + (col + 0.5) * cell;
  const centerY = (row: number, col: number) =>
    originY + (row - firstRow + 0.5) * cell - (moved?.[row]?.[col] ? lift * cell : 0);
  const skip = (row: number, col: number) => hidden?.has(cellKey(row, col)) ?? false;

  // Links first, so that the cell bodies sit on top of them.
  for (let row = firstRow; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      const color = board[row][col];
      if (color < 1 || color > 4 || skip(row, col)) continue;
      const palette = BLOCKS[color];
      const x = centerX(col);
      const y = centerY(row, col);

      const link = (toX: number, toY: number) => {
        ctx.lineCap = 'butt';
        ctx.strokeStyle = palette.deep;
        ctx.lineWidth = cell * 0.62;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(toX, toY);
        ctx.stroke();
        ctx.strokeStyle = palette.body;
        ctx.lineWidth = cell * 0.34;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(toX, toY);
        ctx.stroke();
        ctx.strokeStyle = palette.core;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = cell * 0.1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(toX, toY);
        ctx.stroke();
        ctx.globalAlpha = 1;
      };

      const sameMotion = (r: number, c: number) => (moved?.[row]?.[col] ?? false) === (moved?.[r]?.[c] ?? false);
      if (board[row][col + 1] === color && !skip(row, col + 1) && sameMotion(row, col + 1)) {
        link(centerX(col + 1), centerY(row, col + 1));
      }
      if (board[row + 1]?.[col] === color && !skip(row + 1, col) && sameMotion(row + 1, col)) {
        link(centerX(col), centerY(row + 1, col));
      }
    }
  }

  for (let row = firstRow; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      const color = board[row][col];
      if (color === 0 || skip(row, col)) continue;
      drawCell(ctx, color, centerX(col), centerY(row, col), cell, pixelScale);
    }
  }
}

/** Flat, cheap version for the thought bubble's mini boards. */
export function drawMiniBoard(
  ctx: CanvasRenderingContext2D,
  board: Board,
  x: number,
  y: number,
  cell: number,
  firstRow: number,
): void {
  for (let row = firstRow; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      const color = board[row][col];
      if (color === 0) continue;
      ctx.fillStyle = color === GARBAGE ? GARBAGE_COLOR : BLOCKS[color].body;
      ctx.globalAlpha = color === GARBAGE ? 0.55 : 1;
      ctx.fillRect(x + col * cell + 0.5, y + (row - firstRow) * cell + 0.5, cell - 1, cell - 1);
    }
  }
  ctx.globalAlpha = 1;
}

// Thought bubble above a player: reasoning text plus a mini board per candidate.

import type { Rotation } from '../engine';
import type { ThoughtItem, ThoughtView } from '../game/view';
import { drawMiniBoard } from './blocks';
import { BUBBLE, FONT_BODY, FONT_DISPLAY, INK } from './theme';

const MINI_CELL = 8;
const ITEM_WIDTH = 100;
const ARROWS: Record<Rotation, string> = { 0: '↑', 1: '→', 2: '↓', 3: '←' };

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (ctx.measureText(candidate).width > maxWidth && line !== '') {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

function drawShell(ctx: CanvasRenderingContext2D, x: number, accent: string, active: boolean, tailX: number): void {
  const { y, width, height } = BUBBLE;
  const bottom = y + height;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 12);
  ctx.fillStyle = INK.panel;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = active ? accent : INK.faint;
  ctx.stroke();

  // Thought puffs rising from the player's portrait.
  const puffs: ReadonlyArray<readonly [number, number]> = [[bottom + 7, 4.5], [bottom + 16, 2.8]];
  puffs.forEach(([puffY, radius]) => {
    ctx.beginPath();
    ctx.arc(tailX, puffY, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#071019';
    ctx.fill();
    ctx.strokeStyle = active ? accent : INK.faint;
    ctx.stroke();
  });
}

function drawItem(ctx: CanvasRenderingContext2D, item: ThoughtItem, x: number, y: number, accent: string): void {
  const boardWidth = MINI_CELL * 6;
  const boardHeight = MINI_CELL * 12;
  const topRow = item.board.length - 12;

  ctx.fillStyle = 'rgba(2, 7, 13, 0.9)';
  ctx.fillRect(x, y, boardWidth, boardHeight);
  drawMiniBoard(ctx, item.board, x, y, MINI_CELL, topRow);
  ctx.lineWidth = item.chosen ? 1.5 : 1;
  ctx.strokeStyle = item.chosen ? accent : INK.faint;
  ctx.strokeRect(x - 0.5, y - 0.5, boardWidth + 1, boardHeight + 1);

  const textX = x + boardWidth + 6;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `700 11px ${FONT_BODY}`;
  ctx.fillStyle = item.chosen ? accent : INK.text;
  ctx.fillText(item.title ?? `Col ${item.move.column + 1} ${ARROWS[item.move.rotation]}`, textX, y);

  ctx.font = `500 11px ${FONT_BODY}`;
  ctx.fillStyle = item.chains > 0 ? INK.text : INK.dim;
  const lines = item.chains > 0 ? [`${item.chains} chain`, `${item.cleared} clear`] : ['No clear'];
  if (item.sent > 0) lines.push(`Send ${item.sent}`);
  lines.forEach((line, index) => ctx.fillText(line, textX, y + 17 + index * 15));

  if (item.loses) {
    ctx.fillStyle = INK.danger;
    ctx.fillText('Fatal', textX, y + 17 + lines.length * 15);
  }
  if (item.chosen) {
    ctx.font = `700 11px ${FONT_BODY}`;
    ctx.fillStyle = accent;
    ctx.fillText('Pick', textX, y + boardHeight - 13);
  }
}

export function drawThoughtBubble(
  ctx: CanvasRenderingContext2D,
  thought: ThoughtView | null,
  x: number,
  accent: string,
  active: boolean,
  tailX: number,
  now: number,
): void {
  drawShell(ctx, x, accent, active, tailX);
  const innerY = BUBBLE.y + 16;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = `10px ${FONT_DISPLAY}`;
  ctx.fillStyle = active ? accent : INK.dim;
  ctx.fillText('THOUGHT', x + 16, innerY);

  const textY = innerY + 20;
  ctx.font = `500 13px ${FONT_BODY}`;
  if (!thought) {
    ctx.fillStyle = INK.dim;
    ctx.fillText('Waiting', x + 16, textY);
    return;
  }
  if (thought.status === 'thinking') {
    const dots = '.'.repeat(1 + (Math.floor(now / 300) % 3));
    ctx.fillStyle = INK.text;
    ctx.fillText(`Thinking${dots}`, x + 16, textY);
    return;
  }

  const count = Math.min(thought.items.length, 3);
  const startX = x + BUBBLE.width - 10 - ITEM_WIDTH * count;
  ctx.fillStyle = INK.text;
  wrapText(ctx, thought.text, startX - x - 26)
    .slice(0, 5)
    .forEach((line, index) => ctx.fillText(line, x + 16, textY + index * 18));

  thought.items.slice(0, count).forEach((item, index) => {
    drawItem(ctx, item, startX + index * ITEM_WIDTH, BUBBLE.y + 34, accent);
  });
  ctx.font = `10px ${FONT_DISPLAY}`;
  ctx.fillStyle = INK.dim;
  if (count > 0) ctx.fillText(thought.heading ?? 'PREVIEW', startX, innerY);
}

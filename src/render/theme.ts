// Visual constants: a deep-sea instrument panel with luminous specimens.

export const LOGICAL_WIDTH = 894;
export const LOGICAL_HEIGHT = 714;
export const CELL = 40;

export const FONT_DISPLAY = '"Zen Dots", sans-serif';
export const FONT_BODY = '"Zen Kaku Gothic New", sans-serif';

export const INK = {
  text: '#c4dae2',
  dim: '#6e8c99',
  faint: 'rgba(130, 190, 210, 0.2)',
  panel: 'rgba(5, 13, 22, 0.86)',
  well: 'rgba(2, 7, 13, 0.97)',
  danger: '#ff5468',
};

export interface BlockPalette {
  /** Bright center of the cell. */
  core: string;
  /** Saturated body and link color. */
  body: string;
  /** Shaded rim. */
  deep: string;
}

/** Index matches the board cell value. */
export const BLOCKS: Record<number, BlockPalette> = {
  1: { core: '#c8fff4', body: '#2fe6d2', deep: '#0a6f75' },
  2: { core: '#ffd9d2', body: '#ff5f6d', deep: '#8c1e3d' },
  3: { core: '#fff1c4', body: '#ffbe3b', deep: '#9a5a0a' },
  4: { core: '#ecdcff', body: '#b48bff', deep: '#4f2ea8' },
};

export const GARBAGE_COLOR = '#7b8d99';

export const SEAT_ACCENT = ['#7fdcff', '#ffb39a'] as const;

export interface SeatLayout {
  bubbleX: number;
  wellX: number;
  statsX: number;
  /** Center of the portrait, under the outer end of the thought bubble. */
  avatarX: number;
  /** Text alignment of the outer stats column. */
  statsAlign: CanvasTextAlign;
}

export const BUBBLE = { y: 8, width: 429, height: 136 };
export const AVATAR = { y: 186, radius: 26 };
export const TAG_Y = 220;
export const LANE = { y: 148, height: 80 };
export const WELL_Y = 228;
export const WELL_WIDTH = CELL * 6;
export const WELL_HEIGHT = CELL * 12;
export const STATS_WIDTH = 96;

export const SEATS: readonly [SeatLayout, SeatLayout] = [
  { bubbleX: 12, wellX: 116, statsX: 100, avatarX: 60, statsAlign: 'right' },
  { bubbleX: 453, wellX: 538, statsX: 794, avatarX: 834, statsAlign: 'left' },
];

export const CENTER = { left: 366, right: 528, midline: 447 };

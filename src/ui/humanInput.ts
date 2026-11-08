// Mouse and keyboard selection of a move for the human seat.

import { CONFIG, type EngineApi, type GameState, type Move, type PlayerId, type Rotation } from '../engine';
import { landingCells, previewMoves } from '../game/thoughts';
import type { MatchView } from '../game/view';
import type { MoveInput } from '../players';

const HINT = '←→ move, ↑ rotate, Enter place. Mouse: hover, click to place, right-click to rotate.';

export interface ColumnLocator {
  columnAt(player: PlayerId, clientX: number, clientY: number): number | null;
}

interface Selecting {
  state: GameState;
  legal: Move[];
  selected: Move;
  resolve: (move: Move) => void;
}

export class BrowserMoveInput implements MoveInput {
  private active: Selecting | null = null;
  private lastColumn: number | null = null;
  private lastWheelAt = 0;

  constructor(
    private readonly engine: EngineApi,
    private readonly view: MatchView,
    private readonly locator: ColumnLocator,
    surface: HTMLElement,
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    surface.addEventListener('mousemove', this.onMouseMove);
    surface.addEventListener('click', this.onClick);
    surface.addEventListener('contextmenu', this.onContextMenu);
    surface.addEventListener('wheel', this.onWheel, { passive: false });
  }

  select(state: GameState, legalMoves: Move[]): Promise<Move> {
    return new Promise((resolve) => {
      const start = this.lastColumn ?? CONFIG.spawnColumn;
      const selected =
        this.findMove(legalMoves, start, 0) ??
        legalMoves.find((move) => move.rotation === 0) ??
        legalMoves[0];
      this.active = { state, legal: legalMoves, selected, resolve };
      this.refresh();
    });
  }

  /** Stops waiting, for when a new match replaces the current one. */
  cancel(): void {
    this.active = null;
    this.lastColumn = null;
  }

  private findMove(legal: Move[], column: number, rotation: Rotation): Move | undefined {
    return (
      legal.find((move) => move.column === column && move.rotation === rotation) ??
      legal.find((move) => move.column === column)
    );
  }

  private refresh(): void {
    const session = this.active;
    if (!session) return;
    const { state, selected } = session;
    const player = state.current;
    this.lastColumn = selected.column;
    this.view.setLanePiece(player, { pair: state.players[player].pair, move: selected });
    this.view.setGhost(player, landingCells(this.engine, state, selected));
    this.view.setThought(player, {
      status: 'decided',
      text: HINT,
      items: previewMoves(this.engine, state, [selected], selected).map((item) => ({ ...item, chosen: false })),
    });
  }

  private shift(direction: -1 | 1): void {
    const session = this.active;
    if (!session) return;
    const columns = session.state.players[0].board[0].length;
    for (let col = session.selected.column + direction; col >= 0 && col < columns; col += direction) {
      const move = this.findMove(session.legal, col, session.selected.rotation);
      if (move) {
        session.selected = move;
        this.refresh();
        return;
      }
    }
  }

  private rotate(direction: 1 | 3): void {
    const session = this.active;
    if (!session) return;
    const { column, rotation } = session.selected;
    for (let i = 1; i <= 3; i++) {
      const candidate = ((rotation + direction * i) % 4) as Rotation;
      const move = session.legal.find((entry) => entry.column === column && entry.rotation === candidate);
      if (move) {
        session.selected = move;
        this.refresh();
        return;
      }
    }
  }

  private confirm(): void {
    const session = this.active;
    if (!session) return;
    this.active = null;
    session.resolve(session.selected);
  }

  private pointTo(event: MouseEvent): boolean {
    const session = this.active;
    if (!session) return false;
    const column = this.locator.columnAt(session.state.current, event.clientX, event.clientY);
    if (column === null) return false;
    const move = this.findMove(session.legal, column, session.selected.rotation);
    if (!move) return false;
    if (move !== session.selected) {
      session.selected = move;
      this.refresh();
    }
    return true;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.active) return;
    const target = event.target as HTMLElement | null;
    if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;

    const actions: Record<string, () => void> = {
      ArrowLeft: () => this.shift(-1),
      a: () => this.shift(-1),
      ArrowRight: () => this.shift(1),
      d: () => this.shift(1),
      ArrowUp: () => this.rotate(1),
      w: () => this.rotate(1),
      x: () => this.rotate(1),
      z: () => this.rotate(3),
      Enter: () => this.confirm(),
      ' ': () => this.confirm(),
      ArrowDown: () => this.confirm(),
      s: () => this.confirm(),
    };
    const action = actions[event.key];
    if (action) {
      event.preventDefault();
      // Holding a key may repeat movement, but must not place several pairs in a row.
      const repeatable = ['ArrowLeft', 'ArrowRight', 'a', 'd'].includes(event.key);
      if (!event.repeat || repeatable) action();
    }
  };

  private onMouseMove = (event: MouseEvent): void => {
    this.pointTo(event);
  };

  private onClick = (event: MouseEvent): void => {
    if (this.pointTo(event)) this.confirm();
  };

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    this.rotate(1);
  };

  private onWheel = (event: WheelEvent): void => {
    if (!this.active) return;
    event.preventDefault();
    const now = performance.now();
    if (now - this.lastWheelAt < 120) return;
    this.lastWheelAt = now;
    this.rotate(event.deltaY > 0 ? 1 : 3);
  };
}

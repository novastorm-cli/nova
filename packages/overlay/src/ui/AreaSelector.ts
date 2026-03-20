import type { IAreaSelector } from '../contracts/IOverlayUI.js';
import { applyStyles, COLORS, Z_INDEX } from './styles.js';

const MIN_SELECTION_SIZE = 10;

export class AreaSelector implements IAreaSelector {
  private active = false;
  private selectHandler: ((area: { x: number; y: number; width: number; height: number }) => void) | null = null;
  private cancelHandler: (() => void) | null = null;

  private overlay: HTMLDivElement | null = null;
  private selectionRect: HTMLDivElement | null = null;
  private startX = 0;
  private startY = 0;
  private dragging = false;

  private readonly boundMouseDown = this.handleMouseDown.bind(this);
  private readonly boundMouseMove = this.handleMouseMove.bind(this);
  private readonly boundMouseUp = this.handleMouseUp.bind(this);
  private readonly boundKeyDown = this.handleKeyDown.bind(this);
  private readonly boundGlobalKeyDown = this.handleGlobalKeyDown.bind(this);

  constructor() {
    document.addEventListener('keydown', this.boundGlobalKeyDown, true);
  }

  activate(): void {
    if (this.active) return;
    this.active = true;

    this.overlay = document.createElement('div');
    this.overlay.setAttribute('data-nova-area-selector', '');
    applyStyles(this.overlay, {
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      zIndex: Z_INDEX.areaSelector,
      cursor: 'crosshair',
      pointerEvents: 'all',
      background: 'transparent',
    });

    this.overlay.addEventListener('mousedown', this.boundMouseDown);
    document.addEventListener('mousemove', this.boundMouseMove, true);
    document.addEventListener('mouseup', this.boundMouseUp, true);
    document.addEventListener('keydown', this.boundKeyDown, true);

    document.body.appendChild(this.overlay);
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.dragging = false;

    if (this.overlay) {
      this.overlay.removeEventListener('mousedown', this.boundMouseDown);
      this.overlay.remove();
      this.overlay = null;
    }

    this.selectionRect = null;

    document.removeEventListener('mousemove', this.boundMouseMove, true);
    document.removeEventListener('mouseup', this.boundMouseUp, true);
    document.removeEventListener('keydown', this.boundKeyDown, true);
  }

  /** Removes all event listeners including the global hotkey. Call when fully disposing. */
  destroy(): void {
    this.deactivate();
    document.removeEventListener('keydown', this.boundGlobalKeyDown, true);
  }

  isActive(): boolean {
    return this.active;
  }

  onSelect(handler: (area: { x: number; y: number; width: number; height: number }) => void): void {
    this.selectHandler = handler;
  }

  onCancel(handler: () => void): void {
    this.cancelHandler = handler;
  }

  private handleMouseDown(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();

    this.dragging = true;
    this.startX = e.clientX;
    this.startY = e.clientY;

    this.selectionRect = document.createElement('div');
    applyStyles(this.selectionRect, {
      position: 'fixed',
      border: `2px dashed ${COLORS.processing}`,
      background: 'rgba(59, 130, 246, 0.1)',
      pointerEvents: 'none',
      zIndex: Z_INDEX.areaSelector + 1,
      left: e.clientX,
      top: e.clientY,
      width: 0,
      height: 0,
    });

    document.body.appendChild(this.selectionRect);
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.dragging || !this.selectionRect) return;

    const x = Math.min(e.clientX, this.startX);
    const y = Math.min(e.clientY, this.startY);
    const width = Math.abs(e.clientX - this.startX);
    const height = Math.abs(e.clientY - this.startY);

    applyStyles(this.selectionRect, {
      position: 'fixed',
      border: `2px dashed ${COLORS.processing}`,
      background: 'rgba(59, 130, 246, 0.1)',
      pointerEvents: 'none',
      zIndex: Z_INDEX.areaSelector + 1,
      left: x,
      top: y,
      width,
      height,
    });
  }

  private handleMouseUp(e: MouseEvent): void {
    if (!this.dragging) return;
    this.dragging = false;

    const x = Math.min(e.clientX, this.startX);
    const y = Math.min(e.clientY, this.startY);
    const width = Math.abs(e.clientX - this.startX);
    const height = Math.abs(e.clientY - this.startY);

    // Clean up selection rectangle
    this.selectionRect?.remove();
    this.selectionRect = null;

    if (width < MIN_SELECTION_SIZE || height < MIN_SELECTION_SIZE) {
      // Too small — ignore as accidental click
      return;
    }

    this.deactivate();
    this.selectHandler?.({ x, y, width, height });
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.selectionRect?.remove();
      this.selectionRect = null;
      this.deactivate();
      this.cancelHandler?.();
    }
  }

  /** Global hotkey: Option+A (Mac) / Alt+A (Win) toggles activation. */
  private handleGlobalKeyDown(e: KeyboardEvent): void {
    if (e.altKey && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      e.stopPropagation();
      if (this.active) {
        this.deactivate();
        this.cancelHandler?.();
      } else {
        this.activate();
      }
    }
  }
}

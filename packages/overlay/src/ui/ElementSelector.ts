import type { IElementSelector } from '../contracts/IOverlayUI.js';

export class ElementSelector implements IElementSelector {
  private active = false;
  private selectHandler: ((element: HTMLElement) => void) | null = null;
  private cancelHandler: (() => void) | null = null;
  private currentTarget: HTMLElement | null = null;
  private outlinedElements: Map<HTMLElement, string> = new Map();

  private readonly boundMouseOver = this.handleMouseOver.bind(this);
  private readonly boundClick = this.handleClick.bind(this);
  private readonly boundKeyDown = this.handleKeyDown.bind(this);

  activate(): void {
    if (this.active) return;
    this.active = true;

    document.addEventListener('mouseover', this.boundMouseOver, true);
    document.addEventListener('click', this.boundClick, true);
    document.addEventListener('keydown', this.boundKeyDown, true);
    document.body.style.cursor = 'crosshair';
  }

  deactivate(): void {
    if (!this.active) return;
    this.active = false;

    document.removeEventListener('mouseover', this.boundMouseOver, true);
    document.removeEventListener('click', this.boundClick, true);
    document.removeEventListener('keydown', this.boundKeyDown, true);

    // Restore original outlines on all elements we modified
    for (const [el, originalOutline] of this.outlinedElements) {
      el.style.outline = originalOutline;
    }
    this.outlinedElements.clear();
    this.currentTarget = null;
    document.body.style.cursor = '';
  }

  isActive(): boolean {
    return this.active;
  }

  onSelect(handler: (element: HTMLElement) => void): void {
    this.selectHandler = handler;
  }

  onCancel(handler: () => void): void {
    this.cancelHandler = handler;
  }

  private handleMouseOver(e: MouseEvent): void {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.hasAttribute('data-nova-pill')) return;

    // Remove outline from previous target if different
    if (this.currentTarget && this.currentTarget !== target) {
      const original = this.outlinedElements.get(this.currentTarget) ?? '';
      this.currentTarget.style.outline = original;
      this.outlinedElements.delete(this.currentTarget);
    }

    this.currentTarget = target;

    // Save original outline and apply highlight
    if (!this.outlinedElements.has(target)) {
      this.outlinedElements.set(target, target.style.outline);
    }
    target.style.outline = '2px solid blue';
  }

  private handleClick(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const selected = this.currentTarget ?? (e.target as HTMLElement | null);
    if (selected) {
      this.deactivate();
      this.selectHandler?.(selected);
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.deactivate();
      this.cancelHandler?.();
    }
  }
}

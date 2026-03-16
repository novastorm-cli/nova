import type { ICommandInput } from '../contracts/IOverlayUI.js';
import { COLORS, Z_INDEX, TRANSITION } from './styles.js';

const HISTORY_KEY = 'nova-command-history';
const MAX_HISTORY = 50;

export class CommandInput implements ICommandInput {
  private panel: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private submitHandler: ((text: string) => void) | null = null;
  private closeHandler: (() => void) | null = null;
  private visible = false;
  private historyIndex = -1;
  private currentDraft = '';

  show(anchorElement: HTMLElement): void {
    if (this.visible) return;

    this.panel = document.createElement('div');
    this.panel.setAttribute('data-nova-command-input', '');

    const anchorRect = anchorElement.getBoundingClientRect();
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const showAbove = spaceBelow < 120;

    Object.assign(this.panel.style, {
      position: 'fixed',
      left: `${Math.max(8, anchorRect.left - 160)}px`,
      [showAbove ? 'bottom' : 'top']: showAbove
        ? `${window.innerHeight - anchorRect.top + 8}px`
        : `${anchorRect.bottom + 8}px`,
      width: '320px',
      background: COLORS.overlayBg,
      borderRadius: '8px',
      padding: '8px',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
      zIndex: String(Z_INDEX.commandInput),
      transition: TRANSITION,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    });

    this.inputEl = document.createElement('input');
    this.inputEl.type = 'text';
    this.inputEl.placeholder = 'Type a command...';
    Object.assign(this.inputEl.style, {
      width: '100%',
      boxSizing: 'border-box',
      background: COLORS.inputBg,
      border: `1px solid ${COLORS.inputBorder}`,
      borderRadius: '6px',
      padding: '8px 12px',
      color: COLORS.textPrimary,
      fontSize: '14px',
      outline: 'none',
      fontFamily: 'inherit',
    });

    this.inputEl.addEventListener('keydown', this.handleKeyDown.bind(this));
    this.panel.appendChild(this.inputEl);
    document.body.appendChild(this.panel);

    this.visible = true;
    this.historyIndex = -1;
    this.currentDraft = '';
    this.inputEl.focus();
  }

  hide(): void {
    if (!this.visible) return;
    this.panel?.remove();
    this.panel = null;
    this.inputEl = null;
    this.visible = false;
    this.historyIndex = -1;
  }

  isVisible(): boolean {
    return this.visible;
  }

  setTranscript(text: string): void {
    if (this.inputEl) {
      this.inputEl.value = text;
    }
  }

  onSubmit(handler: (text: string) => void): void {
    this.submitHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      const text = this.inputEl?.value.trim();
      if (text) {
        this.addToHistory(text);
        this.submitHandler?.(text);
      }
      e.preventDefault();
    } else if (e.key === 'Escape') {
      this.closeHandler?.();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      this.navigateHistory(-1);
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      this.navigateHistory(1);
      e.preventDefault();
    }
  }

  private getHistory(): string[] {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch {
      return [];
    }
  }

  private addToHistory(command: string): void {
    const history = this.getHistory();
    const filtered = history.filter((h) => h !== command);
    filtered.unshift(command);
    if (filtered.length > MAX_HISTORY) {
      filtered.length = MAX_HISTORY;
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered));
  }

  private navigateHistory(direction: number): void {
    const history = this.getHistory();
    if (history.length === 0 || !this.inputEl) return;

    if (this.historyIndex === -1 && direction === -1) {
      this.currentDraft = this.inputEl.value;
    }

    const newIndex = this.historyIndex + (direction === -1 ? 1 : -1);

    if (newIndex < 0) {
      this.historyIndex = -1;
      this.inputEl.value = this.currentDraft;
      return;
    }

    if (newIndex >= history.length) return;

    this.historyIndex = newIndex;
    this.inputEl.value = history[this.historyIndex];
  }
}

import type { IStatusToast } from '../contracts/IOverlayUI.js';
import { COLORS, Z_INDEX, TRANSITION } from './styles.js';

interface ToastEntry {
  id: string;
  element: HTMLElement;
  timer: ReturnType<typeof setTimeout> | null;
}

type ToastType = 'info' | 'success' | 'error';

const MAX_TOASTS = 5;
const DEFAULT_DURATION_MS = 5000;

let idCounter = 0;

export class StatusToast implements IStatusToast {
  private container: HTMLElement | null = null;
  private toasts: ToastEntry[] = [];
  private clickHandler: ((id: string) => void) | null = null;

  show(message: string, type: ToastType, durationMs?: number): string {
    this.ensureContainer();

    const id = `nova-toast-${++idCounter}`;

    while (this.toasts.length >= MAX_TOASTS) {
      this.dismiss(this.toasts[0].id);
    }

    const element = this.createToastElement(id, message, type);
    this.container!.appendChild(element);

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (type !== 'error') {
      const duration = durationMs ?? DEFAULT_DURATION_MS;
      // duration of 0 means persistent — do not auto-dismiss
      if (duration > 0) {
        timer = setTimeout(() => this.dismiss(id), duration);
      }
    }

    this.toasts.push({ id, element, timer });
    return id;
  }

  dismiss(id: string): void {
    const index = this.toasts.findIndex((t) => t.id === id);
    if (index === -1) return;

    const entry = this.toasts[index];
    if (entry.timer !== null) {
      clearTimeout(entry.timer);
    }
    entry.element.remove();
    this.toasts.splice(index, 1);

    if (this.toasts.length === 0) {
      this.container?.remove();
      this.container = null;
    }
  }

  dismissAll(): void {
    const ids = this.toasts.map((t) => t.id);
    for (const id of ids) {
      this.dismiss(id);
    }
  }

  onClick(handler: (id: string) => void): void {
    this.clickHandler = handler;
  }

  showConfirmation(
    message: string,
    onExecute: () => void,
    onCancel: () => void,
  ): string {
    this.ensureContainer();

    const id = `nova-toast-${++idCounter}`;

    while (this.toasts.length >= MAX_TOASTS) {
      this.dismiss(this.toasts[0].id);
    }

    const el = document.createElement('div');
    el.setAttribute('data-toast-id', id);
    Object.assign(el.style, {
      background: COLORS.overlayBg,
      borderLeft: `4px solid ${COLORS.info}`,
      color: COLORS.textPrimary,
      padding: '10px 16px',
      borderRadius: '6px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
      fontSize: '13px',
      maxWidth: '380px',
      pointerEvents: 'auto',
      transition: TRANSITION,
      opacity: '0',
    });

    const msgEl = document.createElement('div');
    msgEl.textContent = message;
    msgEl.style.marginBottom = '8px';
    el.appendChild(msgEl);

    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, {
      display: 'flex',
      gap: '8px',
    });

    const execBtn = document.createElement('button');
    execBtn.textContent = 'Execute';
    Object.assign(execBtn.style, {
      background: '#22c55e',
      color: '#fff',
      border: 'none',
      borderRadius: '4px',
      padding: '4px 12px',
      fontSize: '12px',
      cursor: 'pointer',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    });
    execBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onExecute();
      this.dismiss(id);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    Object.assign(cancelBtn.style, {
      background: '#6b7280',
      color: '#fff',
      border: 'none',
      borderRadius: '4px',
      padding: '4px 12px',
      fontSize: '12px',
      cursor: 'pointer',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    });
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onCancel();
      this.dismiss(id);
    });

    btnRow.appendChild(execBtn);
    btnRow.appendChild(cancelBtn);
    el.appendChild(btnRow);

    this.container!.appendChild(el);

    requestAnimationFrame(() => {
      el.style.opacity = '1';
    });

    this.toasts.push({ id, element: el, timer: null });
    return id;
  }

  private ensureContainer(): void {
    if (this.container) return;

    this.container = document.createElement('div');
    this.container.setAttribute('data-nova-toast-container', '');
    Object.assign(this.container.style, {
      position: 'fixed',
      top: '16px',
      left: '16px',
      zIndex: String(Z_INDEX.toast),
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      pointerEvents: 'none',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    });
    document.body.appendChild(this.container);
  }

  private createToastElement(id: string, message: string, type: ToastType): HTMLElement {
    const colorMap: Record<ToastType, string> = {
      info: COLORS.info,
      success: COLORS.success,
      error: COLORS.error,
    };

    const el = document.createElement('div');
    el.setAttribute('data-toast-id', id);
    Object.assign(el.style, {
      background: COLORS.overlayBg,
      borderLeft: `4px solid ${colorMap[type]}`,
      color: COLORS.textPrimary,
      padding: '10px 16px',
      borderRadius: '6px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
      fontSize: '13px',
      maxWidth: '320px',
      cursor: 'pointer',
      pointerEvents: 'auto',
      transition: TRANSITION,
      opacity: '0',
    });
    el.textContent = message;

    el.addEventListener('click', () => {
      this.clickHandler?.(id);
    });

    // Animate in
    requestAnimationFrame(() => {
      el.style.opacity = '1';
    });

    return el;
  }
}

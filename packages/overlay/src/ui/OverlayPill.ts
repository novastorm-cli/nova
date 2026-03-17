import type { IOverlayPill } from '../contracts/IOverlayUI.js';
import { COLORS, PILL_SIZE, Z_INDEX, TRANSITION } from './styles.js';

const STORAGE_KEY_X = 'nova-pill-x';
const STORAGE_KEY_Y = 'nova-pill-y';

type PillState = 'idle' | 'listening' | 'processing' | 'error';

export class OverlayPill implements IOverlayPill {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private pillEl: HTMLElement | null = null;
  private activateHandler: (() => void) | null = null;
  private currentState: PillState = 'idle';

  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private hasMoved = false;

  private readonly boundMouseMove = this.handleMouseMove.bind(this);
  private readonly boundMouseUp = this.handleMouseUp.bind(this);

  mount(container: HTMLElement): void {
    if (this.host) return;

    this.host = document.createElement('div');
    this.host.setAttribute('data-nova-pill', '');
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = this.getStyleSheet();
    this.shadow.appendChild(style);

    this.pillEl = document.createElement('button');
    this.pillEl.className = 'nova-pill idle';
    this.pillEl.setAttribute('aria-label', 'Nova Architect');
    this.pillEl.innerHTML = this.getIcon();

    this.shadow.appendChild(this.pillEl);

    // Always position at bottom-right of viewport
    this.host.style.position = 'fixed';
    this.host.style.right = '20px';
    this.host.style.bottom = '80px'; // Above transcript bar
    this.host.style.left = 'auto';
    this.host.style.top = 'auto';
    this.host.style.zIndex = String(Z_INDEX.pill);

    this.pillEl.addEventListener('mousedown', this.handleMouseDown.bind(this));
    this.pillEl.addEventListener('click', this.handleClick.bind(this));

    container.appendChild(this.host);
  }

  unmount(): void {
    document.removeEventListener('mousemove', this.boundMouseMove);
    document.removeEventListener('mouseup', this.boundMouseUp);
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.pillEl = null;
  }

  setState(state: PillState): void {
    this.currentState = state;
    if (!this.pillEl) return;
    this.pillEl.className = `nova-pill ${state}`;
    this.host?.setAttribute('data-state', state);
  }

  onActivate(handler: () => void): void {
    this.activateHandler = handler;
  }

  private handleClick(e: MouseEvent): void {
    if (this.hasMoved) {
      e.preventDefault();
      return;
    }
    this.activateHandler?.();
  }

  private handleMouseDown(e: MouseEvent): void {
    if (!this.host) return;
    this.isDragging = true;
    this.hasMoved = false;

    const rect = this.host.getBoundingClientRect();
    this.dragOffsetX = e.clientX - rect.left;
    this.dragOffsetY = e.clientY - rect.top;

    document.addEventListener('mousemove', this.boundMouseMove);
    document.addEventListener('mouseup', this.boundMouseUp);
    e.preventDefault();
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.isDragging || !this.host) return;
    this.hasMoved = true;

    const x = Math.max(0, Math.min(e.clientX - this.dragOffsetX, window.innerWidth - PILL_SIZE));
    const y = Math.max(0, Math.min(e.clientY - this.dragOffsetY, window.innerHeight - PILL_SIZE));

    this.host.style.left = `${x}px`;
    this.host.style.top = `${y}px`;
    this.host.style.right = 'auto';
    this.host.style.bottom = 'auto';
  }

  private handleMouseUp(): void {
    if (!this.isDragging || !this.host) return;
    this.isDragging = false;

    document.removeEventListener('mousemove', this.boundMouseMove);
    document.removeEventListener('mouseup', this.boundMouseUp);

    if (this.hasMoved) {
      const rect = this.host.getBoundingClientRect();
      localStorage.setItem(STORAGE_KEY_X, String(rect.left));
      localStorage.setItem(STORAGE_KEY_Y, String(rect.top));
    }
  }

  private getIcon(): string {
    return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>`;
  }

  private getStyleSheet(): string {
    return `
      .nova-pill {
        width: ${PILL_SIZE}px;
        height: ${PILL_SIZE}px;
        border-radius: 50%;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        color: ${COLORS.white};
        transition: ${TRANSITION};
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        outline: none;
        user-select: none;
      }
      .nova-pill:hover {
        transform: scale(1.1);
      }
      .nova-pill.idle {
        background: ${COLORS.idle};
      }
      .nova-pill.listening {
        background: ${COLORS.listening};
        animation: pulse 1.5s ease-in-out infinite;
      }
      .nova-pill.processing {
        background: ${COLORS.processing};
        animation: spin 1.2s linear infinite;
      }
      .nova-pill.error {
        background: ${COLORS.error};
      }
      @keyframes pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
        50% { box-shadow: 0 0 0 12px rgba(16, 185, 129, 0); }
      }
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
  }
}

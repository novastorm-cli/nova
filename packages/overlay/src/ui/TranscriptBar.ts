import type { ITranscriptBar } from '../contracts/IOverlayUI.js';
import { Z_INDEX, TRANSITION } from './styles.js';

const IDLE_TIMEOUT_MS = 3000;
const CLEAR_FINAL_MS = 2000;
const GREEN_FLASH_MS = 400;

export class TranscriptBar implements ITranscriptBar {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private textEl: HTMLElement | null = null;
  private barEl: HTMLElement | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private clearTimer: ReturnType<typeof setTimeout> | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private listening = false;

  mount(container: HTMLElement): void {
    if (this.host) return;

    this.host = document.createElement('div');
    this.host.setAttribute('data-nova-transcript', '');
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = this.getStyleSheet();
    this.shadow.appendChild(style);

    this.barEl = document.createElement('div');
    this.barEl.className = 'transcript-bar idle';

    const mic = document.createElement('span');
    mic.className = 'mic-icon';
    mic.textContent = '\uD83C\uDFA4';

    this.textEl = document.createElement('span');
    this.textEl.className = 'transcript-text';

    this.barEl.appendChild(mic);
    this.barEl.appendChild(this.textEl);
    this.shadow.appendChild(this.barEl);

    this.host.style.position = 'fixed';
    this.host.style.bottom = '20px';
    this.host.style.left = '50%';
    this.host.style.transform = 'translateX(-50%)';
    this.host.style.zIndex = String(Z_INDEX.transcriptBar);
    this.host.style.pointerEvents = 'none';

    container.appendChild(this.host);

    this.resetIdleTimer();
  }

  unmount(): void {
    this.clearAllTimers();
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.textEl = null;
    this.barEl = null;
  }

  setTranscript(text: string, isFinal: boolean): void {
    if (!this.textEl || !this.barEl) return;

    this.showActive();

    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    if (this.flashTimer) {
      clearTimeout(this.flashTimer);
      this.flashTimer = null;
    }

    if (isFinal) {
      this.textEl.className = 'transcript-text final';
      this.textEl.textContent = text;
      this.barEl.classList.add('flash-green');

      this.flashTimer = setTimeout(() => {
        this.barEl?.classList.remove('flash-green');
        this.flashTimer = null;
      }, GREEN_FLASH_MS);

      this.clearTimer = setTimeout(() => {
        if (this.textEl) {
          this.textEl.textContent = '';
          this.textEl.className = 'transcript-text';
        }
        this.clearTimer = null;
      }, CLEAR_FINAL_MS);
    } else {
      this.textEl.className = 'transcript-text interim';
      this.textEl.textContent = text;
    }

    this.resetIdleTimer();
  }

  setListening(active: boolean): void {
    this.listening = active;
    if (active) {
      this.showActive();
      this.resetIdleTimer();
    } else {
      this.showIdle();
    }
  }

  private showActive(): void {
    this.barEl?.classList.remove('idle');
  }

  private showIdle(): void {
    this.barEl?.classList.add('idle');
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => {
      this.showIdle();
      this.idleTimer = null;
    }, IDLE_TIMEOUT_MS);
  }

  private clearAllTimers(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.clearTimer) clearTimeout(this.clearTimer);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.idleTimer = null;
    this.clearTimer = null;
    this.flashTimer = null;
  }

  private getStyleSheet(): string {
    return `
      .transcript-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        background: #1a1a1aee;
        border-radius: 12px;
        padding: 8px 16px;
        min-width: 200px;
        max-width: 600px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        transition: ${TRANSITION}, opacity 0.5s ease;
        opacity: 1;
      }
      .transcript-bar.idle {
        opacity: 0.3;
      }
      .transcript-bar.flash-green {
        background: #1a2a1aee;
        box-shadow: 0 0 12px rgba(16, 185, 129, 0.3);
      }
      .mic-icon {
        font-size: 16px;
        flex-shrink: 0;
      }
      .transcript-text {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        line-height: 1.4;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-height: 20px;
      }
      .transcript-text.interim {
        color: #999;
        font-style: italic;
      }
      .transcript-text.final {
        color: #ffffff;
        font-style: normal;
      }
    `;
  }
}

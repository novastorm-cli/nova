import type { ITranscriptBar } from '../contracts/IOverlayUI.js';
import { Z_INDEX, TRANSITION } from './styles.js';

const IDLE_TIMEOUT_MS = 3000;
const CLEAR_FINAL_MS = 2000;
const GREEN_FLASH_MS = 400;

const LANGUAGES = [
  { code: '', label: 'Auto' },
  { code: 'en-US', label: 'EN' },
  { code: 'ru-RU', label: 'RU' },
  { code: 'de-DE', label: 'DE' },
  { code: 'fr-FR', label: 'FR' },
  { code: 'es-ES', label: 'ES' },
  { code: 'uk-UA', label: 'UA' },
  { code: 'ja-JP', label: 'JP' },
  { code: 'zh-CN', label: 'ZH' },
  { code: 'ko-KR', label: 'KO' },
  { code: 'pt-BR', label: 'PT' },
  { code: 'it-IT', label: 'IT' },
  { code: 'pl-PL', label: 'PL' },
  { code: 'nl-NL', label: 'NL' },
  { code: 'tr-TR', label: 'TR' },
  { code: 'ar-SA', label: 'AR' },
  { code: 'hi-IN', label: 'HI' },
];

export class TranscriptBar implements ITranscriptBar {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private inputEl: HTMLInputElement | null = null;
  private answerInputEl: HTMLInputElement | null = null;
  private barEl: HTMLElement | null = null;
  private micBtn: HTMLElement | null = null;
  private sendBtn: HTMLElement | null = null;
  private langBtn: HTMLElement | null = null;
  private langMenu: HTMLElement | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private clearTimer: ReturnType<typeof setTimeout> | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private listening = false;
  private recording = false;
  private currentLang = '';
  private langChangeHandlers: Array<(lang: string) => void> = [];
  private micToggleHandlers: Array<(active: boolean) => void> = [];
  private commandSubmitHandlers: Array<(text: string) => void> = [];
  private confirmBar: HTMLElement | null = null;
  private confirmExecuteHandlers: Array<(userInput: string) => void> = [];
  private confirmCancelHandlers: Array<() => void> = [];

  private static readonly LANG_STORAGE_KEY = 'nova-voice-lang';

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
    this.barEl.setAttribute('role', 'status');
    this.barEl.setAttribute('aria-live', 'polite');

    // Mic toggle button
    this.micBtn = document.createElement('button');
    this.micBtn.className = 'mic-btn muted';
    this.micBtn.textContent = '\uD83C\uDFA4';
    this.micBtn.title = 'Voice OFF — click to enable';
    this.recording = false;
    this.micBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleRecording();
    });

    this.inputEl = document.createElement('input');
    this.inputEl.className = 'transcript-input';
    this.inputEl.type = 'text';
    this.inputEl.placeholder = 'Type a command or use mic...';
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = this.inputEl?.value.trim();
        if (text && text.length > 0) {
          for (const handler of this.commandSubmitHandlers) {
            handler(text);
          }
          if (this.inputEl) this.inputEl.value = '';
        }
      }
    });

    // Send button
    this.sendBtn = document.createElement('button');
    this.sendBtn.className = 'send-btn';
    this.sendBtn.textContent = '\u27A4'; // ➤ arrow
    this.sendBtn.title = 'Send command';
    this.sendBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = this.inputEl?.value.trim();
      if (text && text.length > 0) {
        for (const handler of this.commandSubmitHandlers) {
          handler(text);
        }
        if (this.inputEl) this.inputEl.value = '';
      }
    });

    // Restore saved language
    try {
      const savedLang = localStorage.getItem(TranscriptBar.LANG_STORAGE_KEY);
      if (savedLang !== null) {
        this.currentLang = savedLang;
      }
    } catch {}

    const savedLabel = LANGUAGES.find(l => l.code === this.currentLang)?.label ?? 'Auto';

    // Language button
    this.langBtn = document.createElement('button');
    this.langBtn.className = 'lang-btn';
    this.langBtn.textContent = savedLabel;
    this.langBtn.title = 'Change language';
    this.langBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleLangMenu();
    });

    // Language dropdown menu
    this.langMenu = document.createElement('div');
    this.langMenu.className = 'lang-menu hidden';
    for (const lang of LANGUAGES) {
      const item = document.createElement('button');
      item.className = 'lang-item';
      if (lang.code === this.currentLang) item.classList.add('active');
      item.textContent = lang.label;
      item.title = lang.code || 'Auto-detect';
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectLanguage(lang.code, lang.label);
      });
      this.langMenu.appendChild(item);
    }

    // Confirmation bar (above input, hidden by default)
    this.confirmBar = document.createElement('div');
    this.confirmBar.className = 'confirm-bar hidden';

    this.barEl.appendChild(this.micBtn);
    this.barEl.appendChild(this.inputEl);
    this.barEl.appendChild(this.sendBtn);
    this.barEl.appendChild(this.langBtn);
    this.shadow.appendChild(this.confirmBar);
    this.shadow.appendChild(this.barEl);
    this.shadow.appendChild(this.langMenu);

    this.host.style.position = 'fixed';
    this.host.style.bottom = '20px';
    this.host.style.left = '50%';
    this.host.style.transform = 'translateX(-50%)';
    this.host.style.zIndex = String(Z_INDEX.transcriptBar);

    container.appendChild(this.host);

    // Close menu on click outside
    document.addEventListener('click', () => this.closeLangMenu());

    this.resetIdleTimer();
  }

  unmount(): void {
    this.clearAllTimers();
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.inputEl = null;
    this.sendBtn = null;
    this.barEl = null;
    this.langBtn = null;
    this.langMenu = null;
  }

  setTranscript(text: string, isFinal: boolean): void {
    if (!this.inputEl || !this.barEl) return;

    this.showActive();

    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    if (this.flashTimer) {
      clearTimeout(this.flashTimer);
      this.flashTimer = null;
    }

    // During recording, show transcript in input (readonly-like)
    if (this.recording) {
      this.inputEl.value = text;
      this.inputEl.classList.add('recording-text');
    }

    if (isFinal) {
      this.inputEl.value = text;
      this.inputEl.classList.remove('recording-text');
      this.barEl.classList.add('flash-green');

      this.flashTimer = setTimeout(() => {
        this.barEl?.classList.remove('flash-green');
        this.flashTimer = null;
      }, GREEN_FLASH_MS);

      this.clearTimer = setTimeout(() => {
        if (this.inputEl && !this.recording) {
          this.inputEl.value = '';
          this.inputEl.classList.remove('recording-text');
        }
        this.clearTimer = null;
      }, CLEAR_FINAL_MS);
    } else {
      this.inputEl.classList.add('recording-text');
      this.inputEl.value = text;
    }

    this.resetIdleTimer();
  }

  setListening(active: boolean): void {
    this.listening = active;
    this.recording = active;
    if (this.micBtn) {
      if (active) {
        this.micBtn.classList.add('recording');
        this.micBtn.classList.remove('muted');
      } else {
        this.micBtn.classList.remove('recording');
        this.micBtn.classList.add('muted');
      }
    }
    if (this.inputEl) {
      this.inputEl.readOnly = active;
      this.inputEl.placeholder = active ? 'Listening...' : 'Type a command or use mic...';
    }
    if (active) {
      this.showActive();
      this.resetIdleTimer();
    } else {
      this.showIdle();
    }
  }

  /** Register callback for mic toggle. */
  onMicToggle(handler: (active: boolean) => void): void {
    this.micToggleHandlers.push(handler);
  }

  /** Get the currently selected language code. */
  getSelectedLanguage(): string {
    return this.currentLang;
  }

  /** Register callback for typed command submitted (Enter or send button). */
  onCommandSubmit(handler: (text: string) => void): void {
    this.commandSubmitHandlers.push(handler);
  }

  /** Show confirmation bar above input with message + input field + Go/Cancel.
   *  When `showInput` is true with a custom placeholder, uses that placeholder. */
  showConfirmation(message: string, options?: { showInput?: boolean; placeholder?: string }): void {
    if (!this.confirmBar) return;
    this.confirmBar.innerHTML = '';

    const text = document.createElement('span');
    text.className = 'confirm-text';
    text.textContent = message.length > 120 ? message.slice(0, 120) + '...' : message;
    text.title = message;
    this.confirmBar.appendChild(text);

    // Input field for user to describe what to add or refine
    const answerInput = document.createElement('input');
    this.answerInputEl = answerInput;
    answerInput.className = 'confirm-answer-input';
    answerInput.type = 'text';
    answerInput.placeholder = options?.placeholder ?? 'Describe what to add...';
    answerInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const userInput = answerInput.value.trim();
        this.hideConfirmation();
        for (const h of this.confirmExecuteHandlers) h(userInput);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.hideConfirmation();
        for (const h of this.confirmCancelHandlers) h();
      }
    });
    this.confirmBar.appendChild(answerInput);

    const btnRow = document.createElement('div');
    btnRow.className = 'confirm-btn-row';

    const execBtn = document.createElement('button');
    execBtn.className = 'confirm-exec-btn';
    execBtn.textContent = 'Go';
    execBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const userInput = answerInput.value.trim();
      this.hideConfirmation();
      for (const h of this.confirmExecuteHandlers) h(userInput);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'confirm-cancel-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideConfirmation();
      for (const h of this.confirmCancelHandlers) h();
    });

    btnRow.appendChild(execBtn);
    btnRow.appendChild(cancelBtn);
    this.confirmBar.appendChild(btnRow);
    this.confirmBar.classList.remove('hidden');

    // Auto-focus the input field
    requestAnimationFrame(() => answerInput.focus());
  }

  /** Hide confirmation bar */
  hideConfirmation(): void {
    this.confirmBar?.classList.add('hidden');
    this.answerInputEl = null;
  }

  /** Register handler for Go/Execute click — receives user input text (empty string if none) */
  onConfirmExecute(handler: (userInput: string) => void): void {
    this.confirmExecuteHandlers.push(handler);
  }

  /** Register handler for Cancel click */
  onConfirmCancel(handler: () => void): void {
    this.confirmCancelHandlers.push(handler);
  }

  /** Show a question with an input field and return the user's answer (or null if cancelled). */
  askQuestion(question: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.showConfirmation(question, { placeholder: 'Type your answer...' });

      const origExecHandlers = [...this.confirmExecuteHandlers];
      const origCancelHandlers = [...this.confirmCancelHandlers];

      const cleanup = (): void => {
        this.confirmExecuteHandlers = origExecHandlers;
        this.confirmCancelHandlers = origCancelHandlers;
      };

      this.confirmExecuteHandlers = [(userInput: string) => {
        this.hideConfirmation();
        cleanup();
        resolve(userInput || null);
      }];

      this.confirmCancelHandlers = [() => {
        this.hideConfirmation();
        cleanup();
        resolve(null);
      }];
    });
  }

  /** Register callback for language change. */
  onLanguageChange(handler: (lang: string) => void): void {
    this.langChangeHandlers.push(handler);
  }

  private toggleRecording(): void {
    this.recording = !this.recording;
    if (this.micBtn) {
      if (this.recording) {
        this.micBtn.classList.add('recording');
        this.micBtn.classList.remove('muted');
        this.micBtn.title = 'Voice ON — click to stop';
      } else {
        this.micBtn.classList.remove('recording');
        this.micBtn.classList.add('muted');
        this.micBtn.title = 'Voice OFF — click to enable';
      }
    }
    if (this.inputEl) {
      this.inputEl.readOnly = this.recording;
      this.inputEl.placeholder = this.recording ? 'Listening...' : 'Type a command or use mic...';
      if (!this.recording) {
        this.inputEl.focus();
      }
    }
    for (const handler of this.micToggleHandlers) {
      handler(this.recording);
    }
  }

  private selectLanguage(code: string, label: string): void {
    this.currentLang = code;
    try { localStorage.setItem(TranscriptBar.LANG_STORAGE_KEY, code); } catch {}
    if (this.langBtn) {
      this.langBtn.textContent = label;
    }
    // Update active state
    if (this.langMenu) {
      for (const item of this.langMenu.children) {
        item.classList.remove('active');
        if (item.getAttribute('title') === (code || 'Auto-detect')) {
          item.classList.add('active');
        }
      }
    }
    this.closeLangMenu();
    // Notify listeners
    for (const handler of this.langChangeHandlers) {
      handler(code);
    }
  }

  private toggleLangMenu(): void {
    this.langMenu?.classList.toggle('hidden');
  }

  private closeLangMenu(): void {
    this.langMenu?.classList.add('hidden');
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
        pointer-events: auto;
      }
      .transcript-bar.idle {
        opacity: 0.3;
      }
      .transcript-bar.idle:focus-within {
        opacity: 1;
      }
      .transcript-bar.flash-green {
        background: #1a2a1aee;
        box-shadow: 0 0 12px rgba(16, 185, 129, 0.3);
      }
      .mic-btn {
        font-size: 18px;
        flex-shrink: 0;
        background: none;
        border: 2px solid transparent;
        border-radius: 50%;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;
        pointer-events: auto;
        padding: 0;
      }
      .mic-btn.recording {
        border-color: #22c55e;
        animation: mic-pulse 1.5s ease-in-out infinite;
      }
      .mic-btn.muted {
        border-color: #666;
        opacity: 0.5;
      }
      .mic-btn:hover {
        transform: scale(1.1);
      }
      @keyframes mic-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
        50% { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
      }
      .transcript-input {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        line-height: 1.4;
        flex: 1;
        min-width: 0;
        background: transparent;
        border: none;
        outline: none;
        color: #ffffff;
        padding: 4px 0;
        pointer-events: auto;
      }
      .transcript-input::placeholder {
        color: #666;
      }
      .transcript-input:focus {
        color: #ffffff;
      }
      .transcript-input.recording-text {
        color: #999;
        font-style: italic;
      }
      .transcript-input:read-only {
        cursor: default;
      }
      .send-btn {
        background: none;
        border: none;
        color: #666;
        font-size: 16px;
        cursor: pointer;
        padding: 4px;
        flex-shrink: 0;
        transition: color 0.2s;
        pointer-events: auto;
      }
      .send-btn:hover {
        color: #3b82f6;
      }
      .confirm-bar {
        display: flex;
        flex-direction: column;
        gap: 8px;
        background: #1a1a1aee;
        border-radius: 12px;
        padding: 12px 16px;
        margin-bottom: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
        pointer-events: auto;
        animation: slideUp 0.2s ease;
        min-width: 320px;
      }
      .confirm-btn-row {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .confirm-bar.hidden {
        display: none;
      }
      @keyframes slideUp {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .confirm-text {
        color: #e5e7eb;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        line-height: 1.4;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .confirm-exec-btn {
        background: #22c55e;
        color: #fff;
        border: none;
        border-radius: 6px;
        padding: 6px 14px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        flex-shrink: 0;
        pointer-events: auto;
        transition: background 0.2s;
      }
      .confirm-exec-btn:hover {
        background: #16a34a;
      }
      .confirm-cancel-btn {
        background: transparent;
        color: #9ca3af;
        border: 1px solid #4b5563;
        border-radius: 6px;
        padding: 6px 14px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        flex-shrink: 0;
        pointer-events: auto;
        transition: all 0.2s;
      }
      .confirm-cancel-btn:hover {
        background: #374151;
        color: #fff;
      }
      .confirm-answer-input {
        flex: 1;
        background: #2a2a2a;
        color: #e5e7eb;
        border: 1px solid #4b5563;
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        outline: none;
        min-width: 150px;
        pointer-events: auto;
      }
      .confirm-answer-input:focus {
        border-color: #3b82f6;
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
      }
      .lang-btn {
        background: #333;
        color: #ccc;
        border: 1px solid #555;
        border-radius: 6px;
        padding: 2px 8px;
        font-size: 11px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: pointer;
        flex-shrink: 0;
        transition: background 0.2s;
        pointer-events: auto;
      }
      .lang-btn:hover {
        background: #444;
        color: #fff;
      }
      .lang-menu {
        position: absolute;
        bottom: 48px;
        right: 0;
        background: #222;
        border: 1px solid #444;
        border-radius: 8px;
        padding: 4px;
        display: flex;
        flex-wrap: wrap;
        gap: 2px;
        max-width: 260px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        pointer-events: auto;
      }
      .lang-menu.hidden {
        display: none;
      }
      .lang-item {
        background: transparent;
        color: #aaa;
        border: 1px solid transparent;
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 11px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: pointer;
        transition: all 0.15s;
      }
      .lang-item:hover {
        background: #333;
        color: #fff;
      }
      .lang-item.active {
        background: #2563eb;
        color: #fff;
        border-color: #3b82f6;
      }
    `;
  }
}

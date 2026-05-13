import type { ITranscriptBar } from '../contracts/IOverlayUI.js';
import { strings } from './strings.js';
import { Z_INDEX, TRANSITION } from './styles.js';

const IDLE_TIMEOUT_MS = 3000;
const CLEAR_FINAL_MS = 2000;
const GREEN_FLASH_MS = 400;

const LANGUAGES = [
  { code: '', label: strings.langAuto },
  { code: 'en-US', label: strings.langEN },
  { code: 'ru-RU', label: strings.langRU },
  { code: 'de-DE', label: strings.langDE },
  { code: 'fr-FR', label: strings.langFR },
  { code: 'es-ES', label: strings.langES },
  { code: 'uk-UA', label: strings.langUA },
  { code: 'ja-JP', label: strings.langJP },
  { code: 'zh-CN', label: strings.langZH },
  { code: 'ko-KR', label: strings.langKO },
  { code: 'pt-BR', label: strings.langPT },
  { code: 'it-IT', label: strings.langIT },
  { code: 'pl-PL', label: strings.langPL },
  { code: 'nl-NL', label: strings.langNL },
  { code: 'tr-TR', label: strings.langTR },
  { code: 'ar-SA', label: strings.langAR },
  { code: 'hi-IN', label: strings.langHI },
];

export class TranscriptBar implements ITranscriptBar {
  private host: HTMLElement | null = null;
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

    // Style element (light DOM, scoped under [data-nova-transcript])
    const style = document.createElement('style');
    style.textContent = this.getStyleSheet();
    this.host.appendChild(style);

    this.barEl = document.createElement('div');
    this.barEl.className = 'transcript-bar idle';
    this.barEl.setAttribute('role', 'status');
    this.barEl.setAttribute('aria-live', 'polite');

    // Mic toggle button
    this.micBtn = document.createElement('button');
    this.micBtn.className = 'mic-btn muted';
    this.micBtn.setAttribute('data-nova', 'mic');
    this.micBtn.setAttribute('aria-label', strings.voiceToggleOff);
    this.micBtn.title = strings.voiceToggleOff;
    this.recording = false;

    // Mic icon (emoji)
    const micIcon = document.createElement('span');
    micIcon.className = 'mic-icon';
    micIcon.textContent = strings.micEmoji;

    // Amplitude ring visualizer
    const ampRing = document.createElement('span');
    ampRing.className = 'amplitude-ring';
    ampRing.setAttribute('data-nova', 'amplitude');
    ampRing.setAttribute('data-level', '0');

    this.micBtn.appendChild(micIcon);
    this.micBtn.appendChild(ampRing);

    this.micBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleRecording();
    });

    this.inputEl = document.createElement('input');
    this.inputEl.className = 'transcript-input';
    this.inputEl.setAttribute('data-nova', 'command-input');
    this.inputEl.type = 'text';
    this.inputEl.placeholder = strings.transcriptPlaceholder;
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
    this.sendBtn.setAttribute('aria-label', strings.sendButtonAriaLabel);
    this.sendBtn.textContent = strings.sendButtonArrow;
    this.sendBtn.title = strings.sendButtonTitle;
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
    } catch {
      /* localStorage may be unavailable */
    }

    const savedLabel =
      LANGUAGES.find((l) => l.code === this.currentLang)?.label ?? strings.langAuto;

    // Language button
    this.langBtn = document.createElement('button');
    this.langBtn.className = 'lang-btn';
    this.langBtn.textContent = savedLabel;
    this.langBtn.title = strings.languageButtonTitle;
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
      item.title = lang.code || strings.autoDetectLabel;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectLanguage(lang.code, lang.label);
      });
      this.langMenu.appendChild(item);
    }

    // Confirmation bar (above input, hidden by default)
    this.confirmBar = document.createElement('div');
    this.confirmBar.className = 'confirm-bar hidden';
    this.confirmBar.setAttribute('data-nova', 'confirm-panel');

    this.barEl.appendChild(this.micBtn);
    this.barEl.appendChild(this.inputEl);
    this.barEl.appendChild(this.sendBtn);
    this.barEl.appendChild(this.langBtn);
    this.host.appendChild(this.confirmBar);
    this.host.appendChild(this.barEl);
    this.host.appendChild(this.langMenu);

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
        this.micBtn.setAttribute('aria-label', strings.voiceToggleOn);
        this.micBtn.title = strings.voiceToggleOn;
      } else {
        this.micBtn.classList.remove('recording');
        this.micBtn.classList.add('muted');
        this.micBtn.setAttribute('aria-label', strings.voiceToggleOff);
        this.micBtn.title = strings.voiceToggleOff;
      }
    }
    if (this.inputEl) {
      this.inputEl.readOnly = active;
      this.inputEl.placeholder = active
        ? strings.listeningPlaceholder
        : strings.transcriptPlaceholder;
    }
    if (active) {
      this.showActive();
      this.resetIdleTimer();
    } else {
      this.showIdle();
    }
    // Reset amplitude when stopping
    if (!active) {
      this.setAmplitude(0);
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

  /** Show confirmation bar above input with message + optional input field + Go/Cancel.
   *  showInput defaults to false — only shown for dead clicks and questions. */
  showConfirmation(message: string, options?: { showInput?: boolean; placeholder?: string }): void {
    if (!this.confirmBar) return;
    this.confirmBar.innerHTML = '';

    const text = document.createElement('span');
    text.className = 'confirm-text';
    text.textContent = message;
    this.confirmBar.appendChild(text);

    const hasInput = options?.showInput === true;
    let answerInput: HTMLInputElement | null = null;

    if (hasInput) {
      answerInput = document.createElement('input');
      this.answerInputEl = answerInput;
      answerInput.className = 'confirm-answer-input';
      answerInput.type = 'text';
      answerInput.placeholder = options?.placeholder ?? strings.confirmAnswerPlaceholder;
      answerInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          const userInput = answerInput?.value.trim() ?? '';
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
    }

    const btnRow = document.createElement('div');
    btnRow.className = 'confirm-btn-row';

    const execBtn = document.createElement('button');
    execBtn.className = 'confirm-exec-btn';
    execBtn.textContent = hasInput ? strings.confirmGo : strings.confirmSend;
    execBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const userInput = answerInput?.value.trim() ?? '';
      this.hideConfirmation();
      for (const h of this.confirmExecuteHandlers) h(userInput);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'confirm-cancel-btn';
    cancelBtn.textContent = strings.confirmCancel;
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideConfirmation();
      for (const h of this.confirmCancelHandlers) h();
    });

    btnRow.appendChild(execBtn);
    btnRow.appendChild(cancelBtn);
    this.confirmBar.appendChild(btnRow);
    this.confirmBar.classList.remove('hidden');

    // Set data-animating for animation tracking (VAL-OVERLAY-015)
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!prefersReduced) {
      this.confirmBar.setAttribute('data-animating', 'true');
      setTimeout(() => {
        this.confirmBar?.removeAttribute('data-animating');
      }, 200);
    }

    if (hasInput && answerInput) {
      requestAnimationFrame(() => answerInput.focus());
    }
  }

  /** Hide confirmation bar */
  hideConfirmation(): void {
    this.confirmBar?.removeAttribute('data-animating');
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
      this.showConfirmation(question, {
        showInput: true,
        placeholder: strings.confirmQuestionPlaceholder,
      });

      const origExecHandlers = [...this.confirmExecuteHandlers];
      const origCancelHandlers = [...this.confirmCancelHandlers];

      const cleanup = (): void => {
        this.confirmExecuteHandlers = origExecHandlers;
        this.confirmCancelHandlers = origCancelHandlers;
      };

      this.confirmExecuteHandlers = [
        (userInput: string) => {
          this.hideConfirmation();
          cleanup();
          resolve(userInput || null);
        },
      ];

      this.confirmCancelHandlers = [
        () => {
          this.hideConfirmation();
          cleanup();
          resolve(null);
        },
      ];
    });
  }

  /** Register callback for language change. */
  onLanguageChange(handler: (lang: string) => void): void {
    this.langChangeHandlers.push(handler);
  }

  /** Focus the command input. Public for use by global keyboard shortcuts. */
  focusInput(): void {
    this.inputEl?.focus();
  }

  private toggleRecording(): void {
    this.recording = !this.recording;
    if (this.micBtn) {
      if (this.recording) {
        this.micBtn.classList.add('recording');
        this.micBtn.classList.remove('muted');
        this.micBtn.setAttribute('aria-label', strings.voiceToggleOn);
        this.micBtn.title = strings.voiceToggleOn;
      } else {
        this.micBtn.classList.remove('recording');
        this.micBtn.classList.add('muted');
        this.micBtn.setAttribute('aria-label', strings.voiceToggleOff);
        this.micBtn.title = strings.voiceToggleOff;
        // Reset amplitude ring when stopping
        this.setAmplitude(0);
      }
    }
    if (this.inputEl) {
      this.inputEl.readOnly = this.recording;
      this.inputEl.placeholder = this.recording
        ? strings.listeningPlaceholder
        : strings.transcriptPlaceholder;
      if (!this.recording) {
        this.inputEl.focus();
      }
    }
    for (const handler of this.micToggleHandlers) {
      handler(this.recording);
    }
  }

  /**
   * Update the amplitude visualizer on the mic button.
   * @param level - RMS amplitude in range 0.0–1.0
   */
  setAmplitude(level: number): void {
    if (!this.micBtn) return;
    const ring = this.micBtn.querySelector('.amplitude-ring');
    if (!ring) return;

    // Clamp to 0–1, store as rounded percentage
    const clamped = Math.max(0, Math.min(1, level));
    const pct = Math.round(clamped * 100);
    ring.setAttribute('data-level', String(pct));

    // Animate the ring based on level
    const size = 32 + clamped * 12; // 32px base, up to 44px
    const opacity = 0.2 + clamped * 0.8; // 0.2 base, up to 1.0
    (ring as HTMLElement).style.width = `${size}px`;
    (ring as HTMLElement).style.height = `${size}px`;
    (ring as HTMLElement).style.opacity = String(opacity);
  }

  private selectLanguage(code: string, label: string): void {
    this.currentLang = code;
    try {
      localStorage.setItem(TranscriptBar.LANG_STORAGE_KEY, code);
    } catch {
      /* localStorage may be unavailable */
    }
    if (this.langBtn) {
      this.langBtn.textContent = label;
    }
    // Update active state
    if (this.langMenu) {
      for (const item of this.langMenu.children) {
        item.classList.remove('active');
        if (item.getAttribute('title') === (code || strings.autoDetectLabel)) {
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
    return [
      // ── Transcript bar (main row) ────────────────────────────
      `[data-nova-transcript] .transcript-bar {
        display: flex;
        align-items: center;
        gap: 10px;
        background: var(--nova-panel-bg);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid var(--nova-panel-border);
        border-radius: 14px;
        padding: 10px 20px;
        min-width: 300px;
        width: 700px;
        max-width: 90vw;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
        transition: ${TRANSITION}, opacity 0.5s ease, border-color 0.3s ease;
        opacity: 1;
        pointer-events: auto;
      }`,
      `[data-nova-transcript] .transcript-bar.idle {
        opacity: 0.6;
        border-color: var(--nova-panel-border);
      }`,
      `[data-nova-transcript] .transcript-bar.idle:hover,
      [data-nova-transcript] .transcript-bar.idle:focus-within {
        opacity: 1;
        border-color: var(--nova-panel-border);
      }`,
      `[data-nova-transcript] .transcript-bar.flash-green {
        background: var(--nova-success);
        box-shadow: 0 0 12px rgba(16, 185, 129, 0.3);
        color: #fff;
      }`,

      // ── Mic button ───────────────────────────────────────────
      `[data-nova-transcript] .mic-btn {
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
        position: relative;
        overflow: visible;
      }`,
      `[data-nova-transcript] .mic-btn.recording {
        border-color: var(--nova-success);
        animation: nova-mic-pulse 1.5s ease-in-out infinite;
      }`,
      `[data-nova-transcript] .mic-btn.muted {
        border-color: var(--nova-text-secondary);
        opacity: 0.5;
      }`,
      `[data-nova-transcript] .mic-btn:hover {
        transform: scale(1.1);
      }`,
      // ── Mic icon ─────────────────────────────────────────────
      `[data-nova-transcript] .mic-icon {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        line-height: 1;
      }`,
      // ── Amplitude ring ───────────────────────────────────────
      `[data-nova-transcript] .amplitude-ring {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 2px solid var(--nova-success);
        opacity: 0;
        transition: width 0.1s ease, height 0.1s ease, opacity 0.1s ease;
        pointer-events: none;
      }`,
      `[data-nova-transcript] .amplitude-ring[data-level="0"] {
        opacity: 0;
      }`,

      // mic-pulse keyframes – wrapped for reduced motion
      `@media (prefers-reduced-motion: no-preference) {
        @keyframes nova-mic-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
          50% { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
        }
      }`,

      // ── Transcript input ─────────────────────────────────────
      `[data-nova-transcript] .transcript-input {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 15px;
        line-height: 1.4;
        flex: 1;
        min-width: 0;
        background: transparent;
        border: none;
        outline: none;
        color: var(--nova-text-primary);
        padding: 6px 0;
        pointer-events: auto;
      }`,
      `[data-nova-transcript] .transcript-input::placeholder {
        color: var(--nova-text-secondary);
      }`,
      `[data-nova-transcript] .transcript-input:focus {
        color: var(--nova-text-primary);
      }`,
      `[data-nova-transcript] .transcript-input.recording-text {
        color: var(--nova-text-secondary);
        font-style: italic;
      }`,
      `[data-nova-transcript] .transcript-input:read-only {
        cursor: default;
      }`,

      // ── Send button ──────────────────────────────────────────
      `[data-nova-transcript] .send-btn {
        background: none;
        border: none;
        color: var(--nova-text-secondary);
        font-size: 16px;
        cursor: pointer;
        padding: 4px;
        flex-shrink: 0;
        transition: color 0.2s;
        pointer-events: auto;
      }`,
      `[data-nova-transcript] .send-btn:hover {
        color: var(--nova-accent);
      }`,

      // ── Confirmation bar ─────────────────────────────────────
      `[data-nova-transcript] .confirm-bar {
        display: flex;
        flex-direction: column;
        gap: 10px;
        background: var(--nova-panel-bg);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid var(--nova-panel-border);
        border-radius: 14px;
        padding: 14px 20px;
        margin-bottom: 8px;
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
        pointer-events: auto;
        width: 700px;
        max-width: 90vw;
      }`,
      // slideUp animation — only when user has no motion preference
      `@media (prefers-reduced-motion: no-preference) {
        @keyframes nova-slide-up {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        [data-nova-transcript] .confirm-bar {
          animation: nova-slide-up 0.2s ease;
        }
      }`,

      `[data-nova-transcript] .confirm-btn-row {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }`,
      `[data-nova-transcript] .confirm-bar.hidden {
        display: none;
      }`,
      `[data-nova-transcript] .confirm-text {
        color: var(--nova-text-primary);
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        line-height: 1.4;
        word-break: break-word;
      }`,
      `[data-nova-transcript] .confirm-exec-btn {
        background: var(--nova-success);
        color: #fff;
        border: none;
        border-radius: 6px;
        padding: 6px 14px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        flex-shrink: 0;
        pointer-events: auto;
        transition: opacity 0.2s;
      }`,
      `[data-nova-transcript] .confirm-exec-btn:hover {
        opacity: 0.85;
      }`,
      `[data-nova-transcript] .confirm-cancel-btn {
        background: transparent;
        color: var(--nova-text-secondary);
        border: 1px solid var(--nova-input-border);
        border-radius: 6px;
        padding: 6px 14px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        flex-shrink: 0;
        pointer-events: auto;
        transition: all 0.2s;
      }`,
      `[data-nova-transcript] .confirm-cancel-btn:hover {
        background: var(--nova-input-border);
        color: var(--nova-text-primary);
      }`,
      `[data-nova-transcript] .confirm-answer-input {
        flex: 1;
        background: var(--nova-input-bg);
        color: var(--nova-text-primary);
        border: 1px solid var(--nova-input-border);
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        outline: none;
        min-width: 150px;
        pointer-events: auto;
      }`,
      `[data-nova-transcript] .confirm-answer-input:focus {
        border-color: var(--nova-accent);
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
      }`,

      // ── Language button ──────────────────────────────────────
      `[data-nova-transcript] .lang-btn {
        background: var(--nova-input-bg);
        color: var(--nova-text-secondary);
        border: 1px solid var(--nova-input-border);
        border-radius: 6px;
        padding: 2px 8px;
        font-size: 11px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: pointer;
        flex-shrink: 0;
        transition: background 0.2s;
        pointer-events: auto;
      }`,
      `[data-nova-transcript] .lang-btn:hover {
        background: var(--nova-input-border);
        color: var(--nova-text-primary);
      }`,

      // ── Language menu ────────────────────────────────────────
      `[data-nova-transcript] .lang-menu {
        position: absolute;
        bottom: 48px;
        right: 0;
        background: var(--nova-dropdown-bg);
        border: 1px solid var(--nova-panel-border);
        border-radius: 8px;
        padding: 4px;
        display: flex;
        flex-wrap: wrap;
        gap: 2px;
        max-width: 260px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        pointer-events: auto;
      }`,
      `[data-nova-transcript] .lang-menu.hidden {
        display: none;
      }`,
      `[data-nova-transcript] .lang-item {
        background: transparent;
        color: var(--nova-text-secondary);
        border: 1px solid transparent;
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 11px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: pointer;
        transition: all 0.15s;
      }`,
      `[data-nova-transcript] .lang-item:hover {
        background: var(--nova-dropdown-hover);
        color: var(--nova-text-primary);
      }`,
      `[data-nova-transcript] .lang-item.active {
        background: var(--nova-accent);
        color: #fff;
        border-color: var(--nova-accent);
      }`,
    ].join('\n');
  }
}

import { strings } from './strings.js';
import { Z_INDEX } from './styles.js';
import { installFocusTrap, type FocusTrap } from './util/focusTrap.js';

let inspectorPopupIdCounter = 0;

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
}

export class ElementInspector {
  private active = false;
  private popupVisible = false;
  private popupEl: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private host: HTMLElement | null = null;
  private highlightEl: HTMLElement | null = null;
  private highlightLabel: HTMLElement | null = null;
  private backdropEl: HTMLElement | null = null;
  private selectedElement: HTMLElement | null = null;
  private submitHandlers: Array<(element: HTMLElement, instruction: string) => void> = [];
  private focusTrap: FocusTrap | null = null;
  private deactivateCallbacks: Array<() => void> = [];

  private popupRecognition: SpeechRecognition | null = null;

  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private keyupHandler: ((e: KeyboardEvent) => void) | null = null;
  private mousemoveHandler: ((e: MouseEvent) => void) | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;

  onDeactivate(callback: () => void): void {
    this.deactivateCallbacks.push(callback);
  }

  mount(container: HTMLElement): void {
    if (this.host) return;

    this.host = document.createElement('div');
    this.host.setAttribute('data-nova', 'inspector');
    this.host.setAttribute('data-nova-inspector', '');
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = this.getStyleSheet();
    this.shadow.appendChild(style);

    // Backdrop layer — intercepts clicks meant for the inspector,
    // preventing host elements from activating during selection mode.
    this.backdropEl = document.createElement('div');
    this.backdropEl.className = 'inspector-backdrop';
    this.backdropEl.style.display = 'none';
    this.backdropEl.addEventListener('click', (e: MouseEvent) => {
      if (!this.active || this.popupVisible) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const target = this.getElementAt(e.clientX, e.clientY);
      if (target) {
        this.selectedElement = target;
        this.showPopup(e.clientX, e.clientY, target);
      }
    });
    this.shadow.appendChild(this.backdropEl);

    // Highlight overlay element
    this.highlightEl = document.createElement('div');
    this.highlightEl.className = 'inspector-highlight';
    this.highlightEl.setAttribute('data-nova', 'inspector-highlight');
    this.shadow.appendChild(this.highlightEl);

    // Label inside highlight
    this.highlightLabel = document.createElement('div');
    this.highlightLabel.className = 'inspector-highlight-label';
    this.highlightEl.appendChild(this.highlightLabel);

    // Popup element (hidden by default)
    this.popupEl = document.createElement('div');
    this.popupEl.className = 'inspector-popup';
    this.popupEl.style.display = 'none';
    this.shadow.appendChild(this.popupEl);

    container.appendChild(this.host);

    this.bindGlobalEvents();
  }

  onSubmit(handler: (element: HTMLElement, instruction: string) => void): void {
    this.submitHandlers.push(handler);
  }

  unmount(): void {
    this.deactivate();
    this.unbindGlobalEvents();
    this.deactivateCallbacks = [];
    if (this.host && this.host.parentNode) {
      this.host.parentNode.removeChild(this.host);
    }
    this.host = null;
    this.shadow = null;
    this.backdropEl = null;
    this.highlightEl = null;
    this.highlightLabel = null;
    this.popupEl = null;
  }

  private bindGlobalEvents(): void {
    this.keydownHandler = (e: KeyboardEvent) => {
      // Escape deactivates — exits selection mode, FSM returns to idle
      if (e.key === 'Escape' && this.active) {
        e.preventDefault();
        e.stopPropagation();
        this.deactivate();
      }
    };

    // keyup not needed for toggle mode
    this.keyupHandler = () => {};

    this.mousemoveHandler = (e: MouseEvent) => {
      if (!this.active || this.popupVisible) return;
      this.highlightElementAt(e.clientX, e.clientY);
    };

    this.clickHandler = (e: MouseEvent) => {
      if (!this.active || this.popupVisible) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const target = this.getElementAt(e.clientX, e.clientY);
      if (target) {
        this.selectedElement = target;
        this.showPopup(e.clientX, e.clientY, target);
      }
    };

    document.addEventListener('keydown', this.keydownHandler, true);
    document.addEventListener('keyup', this.keyupHandler, true);
    document.addEventListener('mousemove', this.mousemoveHandler, true);
    document.addEventListener('click', this.clickHandler, true);
  }

  private unbindGlobalEvents(): void {
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
    }
    if (this.keyupHandler) {
      document.removeEventListener('keyup', this.keyupHandler, true);
      this.keyupHandler = null;
    }
    if (this.mousemoveHandler) {
      document.removeEventListener('mousemove', this.mousemoveHandler, true);
      this.mousemoveHandler = null;
    }
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler, true);
      this.clickHandler = null;
    }
  }

  /** Show popup directly for a specific element (used by rage click). */
  showPopupForElement(element: HTMLElement, x: number, y: number): void {
    this.selectedElement = element;
    this.showPopup(x, y, element);
  }

  /** Toggle inspector mode on/off. Can be called from external UI. */
  toggle(): void {
    if (this.popupVisible) return;
    if (this.active) {
      this.deactivate();
    } else {
      this.activate();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  private activate(): void {
    this.active = true;
    document.body.style.cursor = 'crosshair';
    if (this.backdropEl) {
      this.backdropEl.style.display = 'block';
    }
    if (this.host) {
      this.host.setAttribute('data-active', 'true');
    }
  }

  deactivate(): void {
    // Release focus trap (restores focus to opener)
    if (this.focusTrap) {
      this.focusTrap.release();
      this.focusTrap = null;
    }

    this.active = false;
    this.popupVisible = false;
    this.selectedElement = null;
    document.body.style.cursor = '';
    try {
      sessionStorage.removeItem('nova-inspector-popup');
    } catch {}

    if (this.popupRecognition) {
      this.popupRecognition.stop();
      this.popupRecognition = null;
    }

    if (this.backdropEl) {
      this.backdropEl.style.display = 'none';
    }
    if (this.highlightEl) {
      this.highlightEl.style.display = 'none';
      this.highlightEl.removeAttribute('data-visible');
    }
    if (this.popupEl) {
      this.popupEl.style.display = 'none';
    }
    if (this.host) {
      this.host.removeAttribute('data-active');
    }

    // Notify deactivation callbacks (e.g., to update FSM)
    for (const cb of this.deactivateCallbacks) {
      try {
        cb();
      } catch {
        /* swallow */
      }
    }
  }

  private getElementAt(x: number, y: number): HTMLElement | null {
    // Temporarily hide our overlay elements so elementFromPoint doesn't hit them
    const prevHighlight = this.highlightEl?.style.display;
    const prevPopup = this.popupEl?.style.display;
    if (this.highlightEl) this.highlightEl.style.display = 'none';
    if (this.popupEl) this.popupEl.style.display = 'none';
    if (this.host) this.host.style.display = 'none';

    const el = document.elementFromPoint(x, y) as HTMLElement | null;

    if (this.host) this.host.style.display = '';
    if (this.highlightEl) this.highlightEl.style.display = prevHighlight ?? '';
    if (this.popupEl) this.popupEl.style.display = prevPopup ?? '';

    // Skip nova overlay elements
    if (el?.closest('#nova-root') || el?.closest('[data-nova-pill]')) {
      return null;
    }

    return el;
  }

  private highlightElementAt(x: number, y: number): void {
    const el = this.getElementAt(x, y);
    if (!el || !this.highlightEl || !this.highlightLabel) {
      if (this.highlightEl) {
        this.highlightEl.style.display = 'none';
        this.highlightEl.removeAttribute('data-visible');
      }
      return;
    }

    const rect = el.getBoundingClientRect();
    this.highlightEl.style.display = 'block';
    this.highlightEl.setAttribute('data-visible', 'true');
    this.highlightEl.style.top = `${rect.top}px`;
    this.highlightEl.style.left = `${rect.left}px`;
    this.highlightEl.style.width = `${rect.width}px`;
    this.highlightEl.style.height = `${rect.height}px`;

    this.highlightLabel.textContent = this.getElementLabel(el);
  }

  private getElementLabel(el: HTMLElement): string {
    const tag = el.tagName.toLowerCase();
    const classes =
      el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
    const id = el.id ? `#${el.id}` : '';
    return `${tag}${id}${classes}`;
  }

  private getUniqueSelector(el: HTMLElement): string {
    if (el.id) return `#${el.id}`;
    const tag = el.tagName.toLowerCase();
    const cls =
      el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
    // Add nth-child for uniqueness
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(el) + 1;
        return `${tag}${cls}:nth-of-type(${idx})`;
      }
    }
    return `${tag}${cls}`;
  }

  private savePopupState(element: HTMLElement, inputText: string, x: number, y: number): void {
    try {
      sessionStorage.setItem(
        'nova-inspector-popup',
        JSON.stringify({
          selector: this.getUniqueSelector(element),
          text: inputText,
          x,
          y,
        }),
      );
    } catch {}
  }

  restorePopupState(): void {
    try {
      const raw = sessionStorage.getItem('nova-inspector-popup');
      if (!raw) return;
      sessionStorage.removeItem('nova-inspector-popup');
      const state = JSON.parse(raw);
      if (!state.selector) return;

      // Try to find the element
      const el = document.querySelector(state.selector) as HTMLElement | null;
      if (el) {
        this.selectedElement = el;
        this.showPopup(state.x ?? 200, state.y ?? 200, el);
        // Restore input text after popup is rendered
        setTimeout(() => {
          const input = this.popupEl?.querySelector('.popup-input') as HTMLInputElement | null;
          if (input && state.text) input.value = state.text;
        }, 50);
      }
    } catch {}
  }

  private showPopup(x: number, y: number, element: HTMLElement): void {
    if (!this.popupEl) return;

    // Release any previous focus trap
    if (this.focusTrap) {
      this.focusTrap.release();
      this.focusTrap = null;
    }

    this.popupVisible = true;
    const label = this.getElementLabel(element);

    // Position popup with offset, keeping it in viewport
    const popupWidth = 340;
    const popupHeight = 180;
    let left = x + 12;
    let top = y + 12;

    if (left + popupWidth > window.innerWidth) {
      left = x - popupWidth - 12;
    }
    if (top + popupHeight > window.innerHeight) {
      top = y - popupHeight - 12;
    }
    if (left < 8) left = 8;
    if (top < 8) top = 8;

    inspectorPopupIdCounter++;
    const headingId = `nova-inspector-popup-heading-${inspectorPopupIdCounter}`;

    this.popupEl.style.left = `${left}px`;
    this.popupEl.style.top = `${top}px`;
    this.popupEl.style.display = 'flex';

    // Set ARIA dialog attributes
    this.popupEl.setAttribute('data-nova', 'inspector-popup');
    this.popupEl.setAttribute('role', 'dialog');
    this.popupEl.setAttribute('aria-modal', 'true');
    this.popupEl.setAttribute('aria-labelledby', headingId);

    this.popupEl.innerHTML = '';

    // Header row with title and close button
    const headerRow = document.createElement('div');
    headerRow.className = 'popup-header-row';

    const header = document.createElement('div');
    header.className = 'popup-header';
    header.id = headingId;
    header.textContent = `${strings.targetEmoji} ${label}`;
    headerRow.appendChild(header);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'popup-close-btn';
    closeBtn.setAttribute('data-nova', 'close');
    closeBtn.setAttribute('aria-label', strings.closeDialogAriaLabel);
    closeBtn.textContent = strings.closeX;
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deactivate();
    });
    headerRow.appendChild(closeBtn);

    this.popupEl.appendChild(headerRow);

    const question = document.createElement('div');
    question.className = 'popup-question';
    question.textContent = strings.inspectorQuestion;
    this.popupEl.appendChild(question);

    const inputRow = document.createElement('div');
    inputRow.className = 'popup-input-row';

    const input = document.createElement('input');
    input.className = 'popup-input';
    input.type = 'text';
    input.placeholder = strings.inspectorPlaceholder;
    input.addEventListener('input', () => {
      if (this.selectedElement) {
        this.savePopupState(this.selectedElement, input.value, x, y);
      }
    });
    inputRow.appendChild(input);

    const micBtn = document.createElement('button');
    micBtn.className = 'popup-mic';
    micBtn.textContent = strings.micEmoji;
    micBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePopupVoice(input, micBtn);
    });
    inputRow.appendChild(micBtn);

    this.popupEl.appendChild(inputRow);

    const btnRow = document.createElement('div');
    btnRow.className = 'popup-buttons';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'popup-btn popup-btn-cancel';
    cancelBtn.textContent = strings.inspectorCancel;
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deactivate();
    });

    const executeBtn = document.createElement('button');
    executeBtn.className = 'popup-btn popup-btn-execute';
    executeBtn.textContent = strings.inspectorExecute;
    executeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleSubmit(input.value);
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(executeBtn);
    this.popupEl.appendChild(btnRow);

    // Event listeners on input — Enter submits, Escape handled by focus trap
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && input.value.trim()) {
        this.handleSubmit(input.value);
      }
    });

    // Install focus trap on the host (which contains the popup in shadow DOM)
    if (this.host) {
      this.focusTrap = installFocusTrap(this.host);
    }

    // Auto-focus input after a tick (shadow DOM timing)
    requestAnimationFrame(() => input.focus());
  }

  private handleSubmit(instruction: string): void {
    const trimmed = instruction.trim();
    if (!trimmed || !this.selectedElement) return;

    const element = this.selectedElement;
    for (const handler of this.submitHandlers) {
      handler(element, trimmed);
    }

    this.deactivate();
  }

  private togglePopupVoice(input: HTMLInputElement, micBtn: HTMLButtonElement): void {
    const win = window as unknown as Record<string, unknown>;
    const Ctor = win['SpeechRecognition'] ?? win['webkitSpeechRecognition'];
    if (!Ctor) return;

    if (this.popupRecognition) {
      this.popupRecognition.stop();
      this.popupRecognition = null;
      micBtn.classList.remove('recording');
      return;
    }

    const recognition = new (Ctor as new () => SpeechRecognition)();
    recognition.continuous = true;
    recognition.interimResults = true;
    const savedLang = localStorage.getItem('nova-voice-lang');
    if (savedLang) recognition.lang = savedLang;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      input.value = transcript;
    };

    recognition.onend = () => {
      this.popupRecognition = null;
      micBtn.classList.remove('recording');
    };

    recognition.start();
    this.popupRecognition = recognition;
    micBtn.classList.add('recording');
  }

  private getStyleSheet(): string {
    return `
      :host {
        position: fixed;
        top: 0;
        left: 0;
        width: 0;
        height: 0;
        overflow: visible;
        z-index: ${Z_INDEX.commandInput};
        pointer-events: none;
      }

      .inspector-highlight {
        display: none;
        position: fixed;
        outline: 2px solid #ffffff;
        box-shadow: 0 0 0 4px var(--nova-accent);
        pointer-events: none;
        z-index: ${Z_INDEX.commandInput};
        transition: top 0.05s, left 0.05s, width 0.05s, height 0.05s;
        box-sizing: border-box;
        border-radius: 2px;
      }

      .inspector-backdrop {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        pointer-events: auto;
        z-index: ${Z_INDEX.commandInput - 1};
        background: transparent;
      }

      .inspector-highlight-label {
        position: absolute;
        top: -22px;
        left: 0;
        background: var(--nova-accent);
        color: #fff;
        font-size: 11px;
        font-family: monospace;
        padding: 2px 6px;
        border-radius: 3px;
        white-space: nowrap;
        pointer-events: none;
      }

      .inspector-popup {
        position: fixed;
        display: none;
        flex-direction: column;
        gap: 8px;
        width: 340px;
        padding: 14px 16px;
        background: var(--nova-panel-bg);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid var(--nova-panel-border);
        border-radius: 10px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        z-index: ${Z_INDEX.commandInput};
        pointer-events: auto;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }

      .popup-header-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
      }

      .popup-header {
        font-size: 13px;
        font-weight: 600;
        color: var(--nova-text-primary);
        font-family: monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        min-width: 0;
      }

      .popup-close-btn {
        background: none;
        border: 1px solid var(--nova-panel-border);
        border-radius: 6px;
        color: var(--nova-text-secondary);
        font-size: 14px;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        flex-shrink: 0;
        padding: 0;
      }

      .popup-close-btn:hover {
        background: var(--nova-input-border);
        color: var(--nova-text-primary);
      }

      .popup-question {
        font-size: 12px;
        color: var(--nova-text-secondary);
      }

      .popup-input-row {
        display: flex;
        gap: 6px;
        align-items: center;
      }

      .popup-input {
        flex: 1;
        min-width: 0;
        padding: 8px 10px;
        background: var(--nova-input-bg);
        border: 1px solid var(--nova-input-border);
        border-radius: 6px;
        color: var(--nova-text-primary);
        font-size: 13px;
        outline: none;
        box-sizing: border-box;
        font-family: inherit;
      }

      .popup-input:focus {
        border-color: var(--nova-accent);
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
      }

      .popup-input::placeholder {
        color: var(--nova-text-secondary);
      }

      .popup-buttons {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }

      .popup-btn {
        padding: 6px 14px;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s;
        font-family: inherit;
      }

      .popup-btn-cancel {
        background: var(--nova-input-border);
        color: var(--nova-text-primary);
      }

      .popup-btn-cancel:hover {
        background: var(--nova-text-secondary);
      }

      .popup-btn-execute {
        background: var(--nova-accent);
        color: #fff;
      }

      .popup-btn-execute:hover {
        opacity: 0.85;
      }

      .popup-mic {
        background: none;
        border: 1px solid var(--nova-panel-border);
        border-radius: 50%;
        width: 28px;
        height: 28px;
        font-size: 14px;
        cursor: pointer;
        flex-shrink: 0;
        transition: all 0.2s;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .popup-mic:hover {
        border-color: var(--nova-accent);
      }

      .popup-mic.recording {
        border-color: var(--nova-success);
        animation: mic-pulse 1.5s infinite;
      }

      @keyframes mic-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
        50% { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
      }
    `;
  }
}

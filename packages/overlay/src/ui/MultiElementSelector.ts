import { Z_INDEX } from './styles.js';

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

type SubmitHandler = (elements: Array<{number: number; element: HTMLElement}>, instruction: string) => void;

export class MultiElementSelector {
  private active = false;
  private panelVisible = false;
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private highlightEl: HTMLElement | null = null;
  private markerContainer: HTMLElement | null = null;
  private panelEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private markedElements: Map<number, HTMLElement> = new Map();
  private markerOverlays: Map<number, HTMLElement> = new Map();
  private nextNumber = 1;
  private submitHandlers: SubmitHandler[] = [];
  private animFrameId: number | null = null;

  private popupRecognition: SpeechRecognition | null = null;

  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private mousemoveHandler: ((e: MouseEvent) => void) | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;

  mount(container: HTMLElement): void {
    if (this.host) return;

    this.host = document.createElement('div');
    this.host.setAttribute('data-nova-multi-selector', '');
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = this.getStyleSheet();
    this.shadow.appendChild(style);

    // Highlight overlay element (hover)
    this.highlightEl = document.createElement('div');
    this.highlightEl.className = 'ms-highlight';
    this.shadow.appendChild(this.highlightEl);

    // Container for numbered marker overlays
    this.markerContainer = document.createElement('div');
    this.markerContainer.className = 'ms-marker-container';
    this.shadow.appendChild(this.markerContainer);

    // Command panel (hidden by default)
    this.panelEl = document.createElement('div');
    this.panelEl.className = 'ms-panel';
    this.panelEl.style.display = 'none';
    this.shadow.appendChild(this.panelEl);

    container.appendChild(this.host);

    this.bindGlobalEvents();
  }

  unmount(): void {
    this.deactivate();
    this.unbindGlobalEvents();
    if (this.host && this.host.parentNode) {
      this.host.parentNode.removeChild(this.host);
    }
    this.host = null;
    this.shadow = null;
    this.highlightEl = null;
    this.markerContainer = null;
    this.panelEl = null;
    this.listEl = null;
    this.inputEl = null;
  }

  onSubmit(handler: SubmitHandler): void {
    this.submitHandlers.push(handler);
  }

  toggle(): void {
    if (this.active) {
      this.deactivate();
    } else {
      this.activate();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  deactivate(): void {
    this.active = false;
    this.panelVisible = false;
    document.body.style.cursor = '';

    if (this.popupRecognition) {
      this.popupRecognition.stop();
      this.popupRecognition = null;
    }

    if (this.highlightEl) {
      this.highlightEl.style.display = 'none';
    }

    this.clearMarkers();
    this.hidePanel();
    this.stopPositionLoop();
  }

  private activate(): void {
    this.active = true;
    document.body.style.cursor = 'crosshair';
    this.startPositionLoop();
  }

  private bindGlobalEvents(): void {
    this.keydownHandler = (e: KeyboardEvent) => {
      // Option+K (Mac) / Alt+K (Win) toggles mode
      if (e.altKey && e.code === 'KeyK') {
        e.preventDefault();
        e.stopPropagation();
        this.toggle();
        return;
      }

      // Escape cancels
      if (e.key === 'Escape' && this.active) {
        e.preventDefault();
        e.stopPropagation();
        this.deactivate();
      }
    };

    this.mousemoveHandler = (e: MouseEvent) => {
      if (!this.active) return;
      this.highlightElementAt(e.clientX, e.clientY);
    };

    this.clickHandler = (e: MouseEvent) => {
      if (!this.active) return;
      // Allow clicks on the panel itself (input, buttons)
      if (this.panelEl && e.composedPath().includes(this.panelEl)) return;

      const target = this.getElementAt(e.clientX, e.clientY);
      if (!target) return;

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // Check if element is already marked
      const existingNumber = this.findMarkedNumber(target);
      if (existingNumber !== null) {
        this.unmarkElement(existingNumber);
      } else {
        this.markElement(target);
      }

      // Show panel after first element is marked
      if (this.markedElements.size > 0 && !this.panelVisible) {
        this.showPanel();
      } else if (this.markedElements.size === 0 && this.panelVisible) {
        this.hidePanel();
      } else {
        this.updatePanelList();
      }
    };

    document.addEventListener('keydown', this.keydownHandler, true);
    document.addEventListener('mousemove', this.mousemoveHandler, true);
    document.addEventListener('click', this.clickHandler, true);
  }

  private unbindGlobalEvents(): void {
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler, true);
      this.keydownHandler = null;
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

  private getElementAt(x: number, y: number): HTMLElement | null {
    // Temporarily hide only the highlight overlay for elementFromPoint
    // Do NOT hide panel — it causes flickering
    const prevHighlight = this.highlightEl?.style.display;
    if (this.highlightEl) this.highlightEl.style.display = 'none';

    const el = document.elementFromPoint(x, y) as HTMLElement | null;

    if (this.highlightEl) this.highlightEl.style.display = prevHighlight ?? '';

    // Ignore Nova UI elements
    if (el?.closest('#nova-root') || el?.closest('[data-nova-pill]') || el?.closest('[data-nova-multi-selector]')) {
      return null;
    }

    return el;
  }

  private highlightElementAt(x: number, y: number): void {
    const el = this.getElementAt(x, y);
    if (!el || !this.highlightEl) {
      if (this.highlightEl) this.highlightEl.style.display = 'none';
      return;
    }

    const rect = el.getBoundingClientRect();
    this.highlightEl.style.display = 'block';
    this.highlightEl.style.top = `${rect.top}px`;
    this.highlightEl.style.left = `${rect.left}px`;
    this.highlightEl.style.width = `${rect.width}px`;
    this.highlightEl.style.height = `${rect.height}px`;
  }

  private getElementLabel(el: HTMLElement): string {
    const tag = el.tagName.toLowerCase();
    const classes = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    const id = el.id ? `#${el.id}` : '';
    return `<${tag}${id}${classes}>`;
  }

  private findMarkedNumber(el: HTMLElement): number | null {
    for (const [num, markedEl] of this.markedElements) {
      if (markedEl === el) return num;
    }
    return null;
  }

  private markElement(el: HTMLElement): void {
    const num = this.nextNumber++;
    this.markedElements.set(num, el);

    // Create marker overlay
    const marker = document.createElement('div');
    marker.className = 'ms-marker';
    marker.textContent = String(num);

    const rect = el.getBoundingClientRect();
    marker.style.top = `${rect.top}px`;
    marker.style.left = `${rect.left}px`;

    this.markerContainer?.appendChild(marker);
    this.markerOverlays.set(num, marker);
  }

  private unmarkElement(num: number): void {
    this.markedElements.delete(num);

    const marker = this.markerOverlays.get(num);
    if (marker && marker.parentNode) {
      marker.parentNode.removeChild(marker);
    }
    this.markerOverlays.delete(num);
  }

  private clearMarkers(): void {
    for (const marker of this.markerOverlays.values()) {
      if (marker.parentNode) {
        marker.parentNode.removeChild(marker);
      }
    }
    this.markedElements.clear();
    this.markerOverlays.clear();
    this.nextNumber = 1;
  }

  private updateMarkerPositions(): void {
    for (const [num, el] of this.markedElements) {
      const marker = this.markerOverlays.get(num);
      if (!marker) continue;
      const rect = el.getBoundingClientRect();
      marker.style.top = `${rect.top}px`;
      marker.style.left = `${rect.left}px`;
    }
  }

  private startPositionLoop(): void {
    this.stopPositionLoop();
    const loop = (): void => {
      this.updateMarkerPositions();
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  private stopPositionLoop(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private showPanel(): void {
    if (!this.panelEl) return;

    this.panelVisible = true;
    this.panelEl.innerHTML = '';
    this.panelEl.style.display = 'flex';

    // Hide hover highlight when panel is visible
    if (this.highlightEl) {
      this.highlightEl.style.display = 'none';
    }

    const title = document.createElement('div');
    title.className = 'ms-panel-title';
    title.textContent = 'Multi-Edit';
    this.panelEl.appendChild(title);

    this.listEl = document.createElement('div');
    this.listEl.className = 'ms-panel-list';
    this.panelEl.appendChild(this.listEl);
    this.updatePanelList();

    const hint = document.createElement('div');
    hint.className = 'ms-panel-hint';
    hint.textContent = "Describe what to do. Use numbers to reference elements (e.g. 'swap 1 and 2', 'make 1 look like 3')";
    this.panelEl.appendChild(hint);

    const inputRow = document.createElement('div');
    inputRow.className = 'ms-panel-input-row';

    this.inputEl = document.createElement('input');
    this.inputEl.className = 'ms-panel-input';
    this.inputEl.type = 'text';
    this.inputEl.placeholder = 'e.g. "swap 1 and 2", "align all elements"...';
    inputRow.appendChild(this.inputEl);

    const micBtn = document.createElement('button');
    micBtn.className = 'ms-mic';
    micBtn.textContent = '\uD83C\uDFA4';
    micBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePopupVoice(this.inputEl!, micBtn);
    });
    inputRow.appendChild(micBtn);

    this.panelEl.appendChild(inputRow);

    const btnRow = document.createElement('div');
    btnRow.className = 'ms-panel-buttons';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ms-btn ms-btn-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deactivate();
    });

    const executeBtn = document.createElement('button');
    executeBtn.className = 'ms-btn ms-btn-execute';
    executeBtn.textContent = 'Execute';
    executeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleSubmit();
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(executeBtn);
    this.panelEl.appendChild(btnRow);

    this.inputEl.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && this.inputEl?.value.trim()) {
        this.handleSubmit();
      } else if (e.key === 'Escape') {
        this.deactivate();
      }
    });

    requestAnimationFrame(() => this.inputEl?.focus());
  }

  private hidePanel(): void {
    if (this.panelEl) {
      this.panelEl.style.display = 'none';
      this.panelEl.innerHTML = '';
    }
    this.panelVisible = false;
    this.listEl = null;
    this.inputEl = null;
  }

  private updatePanelList(): void {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';

    for (const [num, el] of this.markedElements) {
      const item = document.createElement('div');
      item.className = 'ms-panel-list-item';
      item.textContent = `${num}: ${this.getElementLabel(el)}`;
      this.listEl.appendChild(item);
    }
  }

  private handleSubmit(): void {
    const instruction = this.inputEl?.value.trim();
    if (!instruction || this.markedElements.size === 0) return;

    const elements: Array<{number: number; element: HTMLElement}> = [];
    for (const [num, el] of this.markedElements) {
      elements.push({ number: num, element: el });
    }

    for (const handler of this.submitHandlers) {
      handler(elements, instruction);
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
        z-index: ${Z_INDEX.multiSelector};
        pointer-events: none;
      }

      .ms-highlight {
        display: none;
        position: fixed;
        border: 2px dashed #3b82f6;
        background: rgba(59, 130, 246, 0.08);
        pointer-events: none;
        z-index: ${Z_INDEX.multiSelector};
        transition: top 0.05s, left 0.05s, width 0.05s, height 0.05s;
        box-sizing: border-box;
      }

      .ms-marker-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 0;
        height: 0;
        overflow: visible;
        pointer-events: none;
      }

      .ms-marker {
        position: fixed;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: #3b82f6;
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        z-index: ${Z_INDEX.multiSelector};
        transform: translate(-50%, -50%);
      }

      .ms-panel {
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        display: none;
        flex-direction: column;
        gap: 10px;
        max-width: 500px;
        width: 90vw;
        padding: 16px 18px;
        background: #1a1a1aee;
        border: 1px solid #333;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        z-index: ${Z_INDEX.multiSelector};
        pointer-events: auto;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        animation: ms-slide-up 0.2s ease-out;
      }

      @keyframes ms-slide-up {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(16px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }

      .ms-panel-title {
        font-size: 14px;
        font-weight: 600;
        color: #e5e5e5;
      }

      .ms-panel-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 120px;
        overflow-y: auto;
      }

      .ms-panel-list-item {
        font-size: 12px;
        font-family: monospace;
        color: #93c5fd;
        padding: 2px 0;
      }

      .ms-panel-hint {
        font-size: 11px;
        color: #9ca3af;
        line-height: 1.4;
      }

      .ms-panel-input-row {
        display: flex;
        gap: 6px;
        align-items: center;
      }

      .ms-panel-input {
        flex: 1;
        min-width: 0;
        padding: 8px 10px;
        background: #111827;
        border: 1px solid #374151;
        border-radius: 6px;
        color: #f9fafb;
        font-size: 13px;
        outline: none;
        box-sizing: border-box;
        font-family: inherit;
      }

      .ms-panel-input:focus {
        border-color: #3b82f6;
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
      }

      .ms-panel-input::placeholder {
        color: #6b7280;
      }

      .ms-panel-buttons {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }

      .ms-btn {
        padding: 6px 14px;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.15s;
        font-family: inherit;
      }

      .ms-btn-cancel {
        background: #374151;
        color: #d1d5db;
      }

      .ms-btn-cancel:hover {
        background: #4b5563;
      }

      .ms-btn-execute {
        background: #3b82f6;
        color: #fff;
      }

      .ms-btn-execute:hover {
        background: #2563eb;
      }

      .ms-mic {
        background: none;
        border: 1px solid rgba(255,255,255,0.2);
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

      .ms-mic:hover {
        border-color: #3b82f6;
      }

      .ms-mic.recording {
        border-color: #22c55e;
        animation: ms-mic-pulse 1.5s infinite;
      }

      @keyframes ms-mic-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
        50% { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
      }
    `;
  }
}

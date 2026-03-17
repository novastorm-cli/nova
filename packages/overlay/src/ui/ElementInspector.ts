import { Z_INDEX } from './styles.js';

export class ElementInspector {
  private active = false;
  private popupVisible = false;
  private popupEl: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private host: HTMLElement | null = null;
  private highlightEl: HTMLElement | null = null;
  private highlightLabel: HTMLElement | null = null;
  private selectedElement: HTMLElement | null = null;
  private submitHandlers: Array<(element: HTMLElement, instruction: string) => void> = [];

  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private keyupHandler: ((e: KeyboardEvent) => void) | null = null;
  private mousemoveHandler: ((e: MouseEvent) => void) | null = null;
  private clickHandler: ((e: MouseEvent) => void) | null = null;

  mount(container: HTMLElement): void {
    if (this.host) return;

    this.host = document.createElement('div');
    this.host.setAttribute('data-nova-inspector', '');
    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = this.getStyleSheet();
    this.shadow.appendChild(style);

    // Highlight overlay element
    this.highlightEl = document.createElement('div');
    this.highlightEl.className = 'inspector-highlight';
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
    if (this.host && this.host.parentNode) {
      this.host.parentNode.removeChild(this.host);
    }
    this.host = null;
    this.shadow = null;
    this.highlightEl = null;
    this.highlightLabel = null;
    this.popupEl = null;
  }

  private bindGlobalEvents(): void {
    // Option+I (Mac) or Alt+I (Win/Linux) toggles inspector mode
    // Use e.code ('KeyI') because Option+I on Mac produces a special character for e.key
    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.altKey && e.code === 'KeyI') {
        e.preventDefault();
        e.stopPropagation();
        if (this.popupVisible) return;
        if (this.active) {
          this.deactivate();
        } else {
          this.activate();
        }
      }
      // Escape deactivates
      if (e.key === 'Escape' && this.active && !this.popupVisible) {
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
  }

  private deactivate(): void {
    this.active = false;
    this.popupVisible = false;
    this.selectedElement = null;
    document.body.style.cursor = '';

    if (this.highlightEl) {
      this.highlightEl.style.display = 'none';
    }
    if (this.popupEl) {
      this.popupEl.style.display = 'none';
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
      if (this.highlightEl) this.highlightEl.style.display = 'none';
      return;
    }

    const rect = el.getBoundingClientRect();
    this.highlightEl.style.display = 'block';
    this.highlightEl.style.top = `${rect.top}px`;
    this.highlightEl.style.left = `${rect.left}px`;
    this.highlightEl.style.width = `${rect.width}px`;
    this.highlightEl.style.height = `${rect.height}px`;

    this.highlightLabel.textContent = this.getElementLabel(el);
  }

  private getElementLabel(el: HTMLElement): string {
    const tag = el.tagName.toLowerCase();
    const classes = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    const id = el.id ? `#${el.id}` : '';
    return `${tag}${id}${classes}`;
  }

  private showPopup(x: number, y: number, element: HTMLElement): void {
    if (!this.popupEl) return;

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

    this.popupEl.style.left = `${left}px`;
    this.popupEl.style.top = `${top}px`;
    this.popupEl.style.display = 'flex';

    this.popupEl.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'popup-header';
    header.textContent = `\uD83C\uDFAF ${label}`;
    this.popupEl.appendChild(header);

    const question = document.createElement('div');
    question.className = 'popup-question';
    question.textContent = 'What do you want to do with this element?';
    this.popupEl.appendChild(question);

    const input = document.createElement('input');
    input.className = 'popup-input';
    input.type = 'text';
    input.placeholder = 'e.g. "change color to red", "make it bigger"...';
    this.popupEl.appendChild(input);

    const btnRow = document.createElement('div');
    btnRow.className = 'popup-buttons';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'popup-btn popup-btn-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.deactivate();
    });

    const executeBtn = document.createElement('button');
    executeBtn.className = 'popup-btn popup-btn-execute';
    executeBtn.textContent = 'Execute';
    executeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleSubmit(input.value);
    });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(executeBtn);
    this.popupEl.appendChild(btnRow);

    // Event listeners on input
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && input.value.trim()) {
        this.handleSubmit(input.value);
      } else if (e.key === 'Escape') {
        this.deactivate();
      }
    });

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
        border: 2px dashed #3b82f6;
        background: rgba(59, 130, 246, 0.08);
        pointer-events: none;
        z-index: ${Z_INDEX.commandInput};
        transition: top 0.05s, left 0.05s, width 0.05s, height 0.05s;
        box-sizing: border-box;
      }

      .inspector-highlight-label {
        position: absolute;
        top: -22px;
        left: 0;
        background: #3b82f6;
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
        background: #1a1a1aee;
        border: 1px solid #333;
        border-radius: 10px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        z-index: ${Z_INDEX.commandInput};
        pointer-events: auto;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
      }

      .popup-header {
        font-size: 13px;
        font-weight: 600;
        color: #e5e5e5;
        font-family: monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .popup-question {
        font-size: 12px;
        color: #9ca3af;
      }

      .popup-input {
        width: 100%;
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

      .popup-input:focus {
        border-color: #3b82f6;
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
      }

      .popup-input::placeholder {
        color: #6b7280;
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
        background: #374151;
        color: #d1d5db;
      }

      .popup-btn-cancel:hover {
        background: #4b5563;
      }

      .popup-btn-execute {
        background: #3b82f6;
        color: #fff;
      }

      .popup-btn-execute:hover {
        background: #2563eb;
      }
    `;
  }
}

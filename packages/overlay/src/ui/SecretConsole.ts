import { strings } from './strings.js';
import { COLORS, Z_INDEX, applyStyles } from './styles.js';
import { installFocusTrap, type FocusTrap } from './util/focusTrap.js';

let secretConsoleIdCounter = 0;

export class SecretConsole {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private container: HTMLElement | null = null;
  private submitHandler: ((secrets: Record<string, string>) => void) | null = null;
  private skipHandler: (() => void) | null = null;
  private currentVars: string[] = [];
  private focusTrap: FocusTrap | null = null;

  mount(container: HTMLElement): void {
    this.host = document.createElement('div');
    this.host.setAttribute('data-nova-secret-console', '');
    this.host.setAttribute('data-nova', 'secret-console');
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.container = container;
    container.appendChild(this.host);

    // Default: hidden, positioned as full-screen backdrop
    applyStyles(this.host, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      zIndex: String(Z_INDEX.secretConsole),
      display: 'none',
      pointerEvents: 'auto',
    });
  }

  unmount(): void {
    if (this.focusTrap) {
      this.focusTrap.release();
      this.focusTrap = null;
    }
    if (this.host && this.container) {
      this.container.removeChild(this.host);
    }
    this.host = null;
    this.shadow = null;
    this.container = null;
  }

  show(vars: string[]): void {
    this.currentVars = vars;
    if (!this.host || !this.shadow) return;

    this.host.style.display = 'flex';
    this.host.style.alignItems = 'center';
    this.host.style.justifyContent = 'center';
    this.render();

    // Install focus trap
    if (this.host) {
      this.focusTrap = installFocusTrap(this.host);
    }
  }

  hide(): void {
    if (this.focusTrap) {
      this.focusTrap.release();
      this.focusTrap = null;
    }
    if (!this.host) return;
    this.host.style.display = 'none';
    if (this.shadow) {
      this.shadow.innerHTML = '';
    }
  }

  onSubmit(handler: (secrets: Record<string, string>) => void): void {
    this.submitHandler = handler;
  }

  onSkip(handler: () => void): void {
    this.skipHandler = handler;
  }

  private render(): void {
    if (!this.shadow) return;

    this.shadow.innerHTML = '';

    const style = document.createElement('style');
    style.textContent = this.getStyles();
    this.shadow.appendChild(style);

    // Opaque backdrop — intercepts clicks so they do NOT reach the host page
    const backdrop = document.createElement('div');
    backdrop.className = 'secret-backdrop';
    backdrop.addEventListener('click', (e) => {
      // Block the click from passing through to the host page.
      // Do NOT close the modal — only the close button and Escape do that.
      e.stopPropagation();
    });
    this.shadow.appendChild(backdrop);

    secretConsoleIdCounter++;
    const headingId = `nova-secret-console-heading-${secretConsoleIdCounter}`;

    const panel = document.createElement('div');
    panel.className = 'secret-panel';
    panel.setAttribute('data-nova', 'secret-console');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', headingId);

    // Header with close button
    const header = document.createElement('div');
    header.className = 'secret-header-row';

    const title = document.createElement('h2');
    title.id = headingId;
    title.className = 'secret-title';
    title.textContent = strings.secretConsoleTitle;
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'secret-close-btn';
    closeBtn.setAttribute('data-nova', 'close');
    closeBtn.setAttribute('aria-label', strings.closeDialogAriaLabel);
    closeBtn.textContent = strings.closeX;
    closeBtn.title = strings.diffCloseTitle;
    closeBtn.addEventListener('click', () => {
      this.hide();
      this.skipHandler?.();
    });
    header.appendChild(closeBtn);

    panel.appendChild(header);

    // Description
    const desc = document.createElement('div');
    desc.className = 'secret-desc';
    desc.textContent = strings.secretConsoleDesc;
    panel.appendChild(desc);

    // Fields
    const fields = document.createElement('div');
    fields.className = 'secret-fields';

    for (const varName of this.currentVars) {
      const field = document.createElement('div');
      field.className = 'secret-field';

      const inputId = `secret-${varName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      const label = document.createElement('label');
      label.className = 'secret-label';
      label.textContent = varName;
      label.setAttribute('for', inputId);
      field.appendChild(label);

      const inputWrap = document.createElement('div');
      inputWrap.className = 'secret-input-wrap';

      const input = document.createElement('input');
      input.type = 'password';
      input.id = inputId;
      input.className = 'secret-input';
      input.setAttribute('data-var', varName);
      input.placeholder = `${strings.secretPlaceholderPrefix}${varName}`;
      inputWrap.appendChild(input);

      const toggle = document.createElement('button');
      toggle.className = 'secret-toggle';
      toggle.textContent = strings.secretToggleIcon;
      toggle.title = strings.secretToggleTitle;
      toggle.addEventListener('click', () => {
        input.type = input.type === 'password' ? 'text' : 'password';
      });
      inputWrap.appendChild(toggle);

      field.appendChild(inputWrap);
      fields.appendChild(field);
    }

    panel.appendChild(fields);

    // Buttons
    const actions = document.createElement('div');
    actions.className = 'secret-actions';

    const skipBtn = document.createElement('button');
    skipBtn.className = 'secret-btn secret-btn-skip';
    skipBtn.textContent = strings.secretConsoleSkip;
    skipBtn.addEventListener('click', () => {
      this.hide();
      this.skipHandler?.();
    });
    actions.appendChild(skipBtn);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'secret-btn secret-btn-save';
    saveBtn.textContent = strings.secretConsoleSave;
    saveBtn.addEventListener('click', () => {
      const secrets: Record<string, string> = {};
      const inputs = this.shadow!.querySelectorAll<HTMLInputElement>('.secret-input');
      for (const inp of inputs) {
        const key = inp.getAttribute('data-var');
        if (key && inp.value.trim()) {
          secrets[key] = inp.value.trim();
        }
      }
      if (Object.keys(secrets).length > 0) {
        this.hide();
        this.submitHandler?.(secrets);
      }
    });
    actions.appendChild(saveBtn);

    panel.appendChild(actions);
    this.shadow.appendChild(panel);

    // Auto-focus first input
    requestAnimationFrame(() => {
      const firstInput = this.shadow?.querySelector<HTMLInputElement>('.secret-input');
      firstInput?.focus();
    });
  }

  private getStyles(): string {
    return `
      .secret-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.4);
        z-index: -1;
        pointer-events: auto;
      }

      .secret-panel {
        background: ${COLORS.overlayBg};
        border: 1px solid ${COLORS.inputBorder};
        border-radius: 12px;
        padding: 20px;
        min-width: 400px;
        max-width: 500px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: ${COLORS.textPrimary};
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        position: relative;
        z-index: 1;
      }

      .secret-header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }

      .secret-title {
        font-size: 16px;
        font-weight: 600;
        margin: 0;
      }

      .secret-close-btn {
        background: none;
        border: 1px solid ${COLORS.inputBorder};
        border-radius: 6px;
        color: ${COLORS.textSecondary};
        font-size: 14px;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        flex-shrink: 0;
      }

      .secret-close-btn:hover {
        background: ${COLORS.inputBorder};
        color: ${COLORS.textPrimary};
      }

      .secret-desc {
        font-size: 12px;
        color: ${COLORS.textSecondary};
        margin-bottom: 16px;
        line-height: 1.4;
      }

      .secret-fields {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 16px;
      }

      .secret-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .secret-label {
        font-size: 12px;
        font-weight: 500;
        font-family: monospace;
        color: ${COLORS.textSecondary};
      }

      .secret-input-wrap {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .secret-input {
        flex: 1;
        background: ${COLORS.inputBg};
        border: 1px solid ${COLORS.inputBorder};
        border-radius: 6px;
        padding: 8px 12px;
        color: ${COLORS.textPrimary};
        font-size: 14px;
        font-family: monospace;
        outline: none;
      }

      .secret-input:focus {
        border-color: ${COLORS.info};
      }

      .secret-input::placeholder {
        color: ${COLORS.textSecondary};
        opacity: 0.6;
      }

      .secret-toggle {
        background: none;
        border: 1px solid ${COLORS.inputBorder};
        border-radius: 6px;
        padding: 6px 8px;
        cursor: pointer;
        font-size: 14px;
        color: ${COLORS.textSecondary};
      }

      .secret-toggle:hover {
        border-color: ${COLORS.textPrimary};
      }

      .secret-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      .secret-btn {
        padding: 8px 20px;
        border-radius: 6px;
        border: none;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
      }

      .secret-btn-skip {
        background: ${COLORS.inputBg};
        color: ${COLORS.textSecondary};
        border: 1px solid ${COLORS.inputBorder};
      }

      .secret-btn-skip:hover {
        background: ${COLORS.inputBorder};
      }

      .secret-btn-save {
        background: ${COLORS.success};
        color: #fff;
      }

      .secret-btn-save:hover {
        opacity: 0.9;
      }
    `;
  }
}

import { COLORS, Z_INDEX, applyStyles } from './styles.js';

export class SecretConsole {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private container: HTMLElement | null = null;
  private submitHandler: ((secrets: Record<string, string>) => void) | null = null;
  private skipHandler: (() => void) | null = null;
  private currentVars: string[] = [];
  private escapeHandler: ((e: KeyboardEvent) => void) | null = null;

  mount(container: HTMLElement): void {
    this.host = document.createElement('div');
    this.host.setAttribute('data-nova-secret-console', '');
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.container = container;
    container.appendChild(this.host);

    applyStyles(this.host, {
      position: 'fixed',
      bottom: '80px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: String(Z_INDEX.secretConsole),
      display: 'none',
      pointerEvents: 'auto',
    });
  }

  unmount(): void {
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

    this.host.style.display = 'block';
    this.render();

    this.escapeHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.hide();
        this.skipHandler?.();
      }
    };
    document.addEventListener('keydown', this.escapeHandler);
  }

  hide(): void {
    if (!this.host) return;
    this.host.style.display = 'none';
    if (this.shadow) {
      this.shadow.innerHTML = '';
    }
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler);
      this.escapeHandler = null;
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

    const panel = document.createElement('div');
    panel.className = 'secret-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'secret-header';
    header.textContent = 'Environment Variables Required';
    panel.appendChild(header);

    // Description
    const desc = document.createElement('div');
    desc.className = 'secret-desc';
    desc.textContent = 'The generated code requires these environment variables. Enter values to save to .env.local (gitignored).';
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
      input.placeholder = `Enter ${varName}`;
      inputWrap.appendChild(input);

      const toggle = document.createElement('button');
      toggle.className = 'secret-toggle';
      toggle.textContent = '\u{1F441}';
      toggle.title = 'Toggle visibility';
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
    skipBtn.textContent = 'Skip';
    skipBtn.addEventListener('click', () => {
      this.hide();
      this.skipHandler?.();
    });
    actions.appendChild(skipBtn);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'secret-btn secret-btn-save';
    saveBtn.textContent = 'Save';
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
  }

  private getStyles(): string {
    return `
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
      }
      .secret-header {
        font-size: 16px;
        font-weight: 600;
        margin-bottom: 8px;
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

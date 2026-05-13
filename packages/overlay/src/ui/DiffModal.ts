import { strings } from './strings.js';
import { Z_INDEX } from './styles.js';

interface DiffLine {
  type: 'added' | 'removed' | 'context' | 'hunk' | 'file-header';
  content: string;
  oldNum: string;
  newNum: string;
}

export class DiffModal {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private overlayEl: HTMLElement | null = null;
  private escHandler: ((e: KeyboardEvent) => void) | null = null;

  mount(container: HTMLElement): void {
    this.host = document.createElement('div');
    this.host.setAttribute('data-nova-diff-modal', '');
    this.host.style.position = 'fixed';
    this.host.style.top = '0';
    this.host.style.left = '0';
    this.host.style.width = '0';
    this.host.style.height = '0';
    this.host.style.overflow = 'visible';
    this.host.style.zIndex = String(Z_INDEX.toast + 10);

    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = this.getStyles();
    this.shadow.appendChild(style);

    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'diff-overlay hidden';
    this.overlayEl.addEventListener('click', (e) => {
      if (e.target === this.overlayEl) {
        this.hide();
      }
    });

    this.shadow.appendChild(this.overlayEl);
    container.appendChild(this.host);

    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.hide();
      }
    };
    document.addEventListener('keydown', this.escHandler);
  }

  show(filePath: string, diffContent: string): void {
    if (!this.overlayEl) return;

    this.overlayEl.innerHTML = '';

    const modal = document.createElement('div');
    modal.className = 'diff-modal';

    // Header
    const header = document.createElement('div');
    header.className = 'diff-header';

    const fileLabel = document.createElement('span');
    fileLabel.className = 'diff-file-path';
    fileLabel.textContent = filePath;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'diff-close-btn';
    closeBtn.textContent = strings.closeX;
    closeBtn.title = strings.diffCloseTitle;
    closeBtn.addEventListener('click', () => this.hide());

    header.appendChild(fileLabel);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Diff body
    const body = document.createElement('div');
    body.className = 'diff-body';

    const lines = this.parseLines(diffContent);

    const table = document.createElement('table');
    table.className = 'diff-table';

    for (const line of lines) {
      const row = document.createElement('tr');
      row.className = `diff-line diff-line-${line.type}`;

      const oldNumCell = document.createElement('td');
      oldNumCell.className = 'line-num';
      oldNumCell.textContent = line.oldNum;

      const newNumCell = document.createElement('td');
      newNumCell.className = 'line-num';
      newNumCell.textContent = line.newNum;

      const contentCell = document.createElement('td');
      contentCell.className = 'line-content';
      contentCell.textContent = line.content;

      row.appendChild(oldNumCell);
      row.appendChild(newNumCell);
      row.appendChild(contentCell);
      table.appendChild(row);
    }

    body.appendChild(table);
    modal.appendChild(body);
    this.overlayEl.appendChild(modal);
    this.overlayEl.classList.remove('hidden');
  }

  hide(): void {
    this.overlayEl?.classList.add('hidden');
  }

  unmount(): void {
    if (this.escHandler) {
      document.removeEventListener('keydown', this.escHandler);
      this.escHandler = null;
    }
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.overlayEl = null;
  }

  private parseLines(diffContent: string): DiffLine[] {
    const rawLines = diffContent.split('\n');
    const result: DiffLine[] = [];
    let oldLine = 0;
    let newLine = 0;

    for (const raw of rawLines) {
      if (raw.startsWith('@@')) {
        // Parse hunk header: @@ -oldStart,count +newStart,count @@
        const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (match) {
          oldLine = parseInt(match[1], 10);
          newLine = parseInt(match[2], 10);
        }
        result.push({ type: 'hunk', content: raw, oldNum: '', newNum: '' });
      } else if (raw.startsWith('---') || raw.startsWith('+++')) {
        result.push({ type: 'file-header', content: raw, oldNum: '', newNum: '' });
      } else if (raw.startsWith('-')) {
        result.push({ type: 'removed', content: raw, oldNum: String(oldLine), newNum: '' });
        oldLine++;
      } else if (raw.startsWith('+')) {
        result.push({ type: 'added', content: raw, oldNum: '', newNum: String(newLine) });
        newLine++;
      } else {
        // Context line (may start with space or be empty)
        const content = raw.startsWith(' ') ? raw : raw;
        result.push({
          type: 'context',
          content,
          oldNum: oldLine > 0 ? String(oldLine) : '',
          newNum: newLine > 0 ? String(newLine) : '',
        });
        if (oldLine > 0) oldLine++;
        if (newLine > 0) newLine++;
      }
    }

    return result;
  }

  private getStyles(): string {
    return `
      .diff-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: var(--nova-backdrop);
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
        animation: fadeIn 0.15s ease;
      }

      .diff-overlay.hidden {
        display: none;
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .diff-modal {
        background: var(--nova-panel-bg);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid var(--nova-panel-border);
        border-radius: 12px;
        max-width: 80vw;
        max-height: 80vh;
        width: 900px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
        animation: scaleIn 0.15s ease;
      }

      @keyframes scaleIn {
        from { opacity: 0; transform: scale(0.96); }
        to { opacity: 1; transform: scale(1); }
      }

      .diff-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid var(--nova-panel-border);
        flex-shrink: 0;
      }

      .diff-file-path {
        font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
        font-size: 13px;
        color: var(--nova-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .diff-close-btn {
        background: none;
        border: 1px solid var(--nova-panel-border);
        border-radius: 6px;
        color: var(--nova-text-secondary);
        font-size: 14px;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.15s;
        flex-shrink: 0;
        margin-left: 12px;
      }

      .diff-close-btn:hover {
        background: var(--nova-dropdown-hover);
        color: var(--nova-text-primary);
        border-color: var(--nova-panel-border);
      }

      .diff-body {
        overflow: auto;
        flex: 1;
        min-height: 0;
      }

      .diff-body::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }

      .diff-body::-webkit-scrollbar-track {
        background: transparent;
      }

      .diff-body::-webkit-scrollbar-thumb {
        background: var(--nova-panel-border);
        border-radius: 3px;
      }

      .diff-table {
        width: 100%;
        border-collapse: collapse;
        font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
        font-size: 12px;
        line-height: 1.5;
      }

      .diff-line td {
        padding: 0 12px;
        white-space: pre;
        vertical-align: top;
      }

      .line-num {
        width: 1px;
        min-width: 40px;
        text-align: right;
        color: var(--nova-text-secondary);
        user-select: none;
        padding-right: 8px !important;
        border-right: 1px solid var(--nova-panel-border);
      }

      .line-content {
        padding-left: 12px !important;
      }

      /* Context lines */
      .diff-line-context .line-content {
        color: var(--nova-text-secondary);
      }

      /* Added lines */
      .diff-line-added {
        background: rgba(63, 185, 80, 0.1);
      }

      .diff-line-added .line-content {
        color: var(--nova-success);
        border-left: 3px solid var(--nova-success);
        padding-left: 9px !important;
      }

      /* Removed lines */
      .diff-line-removed {
        background: rgba(248, 81, 73, 0.1);
      }

      .diff-line-removed .line-content {
        color: var(--nova-error);
        border-left: 3px solid var(--nova-error);
        padding-left: 9px !important;
      }

      /* Hunk headers */
      .diff-line-hunk {
        background: rgba(167, 139, 250, 0.1);
      }

      .diff-line-hunk .line-content {
        color: var(--nova-accent);
      }

      /* File headers (--- +++) */
      .diff-line-file-header .line-content {
        color: var(--nova-text-secondary);
        font-weight: bold;
      }
    `;
  }
}

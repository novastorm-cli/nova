import { strings } from './strings.js';
import { Z_INDEX } from './styles.js';
import { installFocusTrap, type FocusTrap } from './util/focusTrap.js';

interface DiffLine {
  type: 'added' | 'removed' | 'context' | 'hunk' | 'file-header';
  content: string;
  oldNum: string;
  newNum: string;
}

interface DiffStats {
  added: number;
  removed: number;
}

interface DiffModalShowOptions {
  absPath?: string;
  firstLineNumber?: number;
  canOpen?: boolean;
  onRevert?: (filePath: string) => void;
}

let diffModalIdCounter = 0;

export class DiffModal {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private overlayEl: HTMLElement | null = null;
  private focusTrap: FocusTrap | null = null;
  private currentFilePath = '';
  private currentDiffContent = '';

  mount(container: HTMLElement): void {
    this.host = document.createElement('div');
    this.host.setAttribute('data-nova-diff-modal', '');
    this.host.style.position = 'fixed';
    this.host.style.top = '0';
    this.host.style.left = '0';
    this.host.style.width = '0';
    this.host.style.height = '0';
    this.host.style.overflow = 'visible';
    this.host.style.zIndex = String(Z_INDEX.diffModal);

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
  }

  show(filePath: string, diffContent: string, options: DiffModalShowOptions = {}): void {
    if (!this.overlayEl) return;

    this.currentFilePath = filePath;
    this.currentDiffContent = diffContent;
    this.overlayEl.innerHTML = '';

    diffModalIdCounter++;
    const headingId = `nova-diff-modal-heading-${diffModalIdCounter}`;

    const modal = document.createElement('div');
    modal.className = 'diff-modal';
    modal.setAttribute('data-nova', 'diff-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', headingId);

    // Header
    const header = document.createElement('div');
    header.className = 'diff-header';

    const fileLabel = document.createElement('span');
    fileLabel.className = 'diff-file-path';
    fileLabel.id = headingId;
    fileLabel.textContent = filePath;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'diff-close-btn';
    closeBtn.setAttribute('data-nova', 'close');
    closeBtn.setAttribute('aria-label', strings.closeDialogAriaLabel);
    closeBtn.textContent = strings.closeX;
    closeBtn.title = strings.diffCloseTitle;
    closeBtn.addEventListener('click', () => this.hide());

    header.appendChild(fileLabel);
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Toolbar
    const lines = this.parseLines(diffContent);
    const stats = this.computeStats(lines);

    const toolbar = this.buildToolbar(filePath, diffContent, stats, options);
    toolbar.setAttribute('data-nova', 'toolbar');
    modal.appendChild(toolbar);

    // Diff body
    const body = document.createElement('div');
    body.className = 'diff-body';

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

    // Install focus trap on the host (which contains the modal in shadow DOM)
    if (this.host) {
      this.focusTrap = installFocusTrap(this.host);
    }
  }

  hide(): void {
    // Release focus trap (restores focus to opener)
    if (this.focusTrap) {
      this.focusTrap.release();
      this.focusTrap = null;
    }
    this.overlayEl?.classList.add('hidden');
  }

  unmount(): void {
    if (this.focusTrap) {
      this.focusTrap.release();
      this.focusTrap = null;
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

  private computeStats(lines: DiffLine[]): DiffStats {
    let added = 0;
    let removed = 0;
    for (const line of lines) {
      if (line.type === 'added') added++;
      if (line.type === 'removed') removed++;
    }
    return { added, removed };
  }

  private buildToolbar(
    filePath: string,
    diffContent: string,
    stats: DiffStats,
    options: DiffModalShowOptions,
  ): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'diff-toolbar';

    // Stats badge: +N -M
    const statsChip = document.createElement('span');
    statsChip.className = 'diff-stats-chip';
    statsChip.setAttribute('data-nova', 'stats');
    statsChip.setAttribute('aria-label', strings.diffStatsAriaLabel);
    const addedSpan = document.createElement('span');
    addedSpan.className = 'stats-added';
    addedSpan.textContent = `+${stats.added}`;
    const removedSpan = document.createElement('span');
    removedSpan.className = 'stats-removed';
    removedSpan.textContent = ` -${stats.removed}`;
    statsChip.appendChild(addedSpan);
    statsChip.appendChild(removedSpan);
    toolbar.appendChild(statsChip);

    // Spacer
    const spacer = document.createElement('div');
    spacer.className = 'diff-toolbar-spacer';
    toolbar.appendChild(spacer);

    // Copy diff button
    const copyBtn = document.createElement('button');
    copyBtn.className = 'diff-tool-btn';
    copyBtn.setAttribute('data-nova', 'copy');
    copyBtn.setAttribute('aria-label', strings.diffCopyAriaLabel);
    copyBtn.textContent = strings.diffCopyButton;
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void (async () => {
        try {
          await navigator.clipboard.writeText(diffContent);
          const originalText = copyBtn.textContent;
          copyBtn.textContent = strings.diffCopied;
          copyBtn.classList.add('copied-flash');
          setTimeout(() => {
            copyBtn.textContent = originalText;
            copyBtn.classList.remove('copied-flash');
          }, 1500);
        } catch {
          // Clipboard write may fail in non-secure contexts
        }
      })();
    });
    toolbar.appendChild(copyBtn);

    // Open file button (only when canOpen is true)
    if (options.canOpen) {
      const openBtn = document.createElement('button');
      openBtn.className = 'diff-tool-btn';
      openBtn.setAttribute('data-nova', 'open-file');
      openBtn.setAttribute('aria-label', strings.diffOpenFileAriaLabel);
      openBtn.textContent = strings.diffOpenFileButton;
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const absPath = options.absPath ?? filePath;
        const line = options.firstLineNumber ?? 1;
        void window.open(`vscode://file/${absPath}:${line}`, '_blank');
      });
      toolbar.appendChild(openBtn);
    }

    // Revert this file button
    const revertBtn = document.createElement('button');
    revertBtn.className = 'diff-tool-btn diff-tool-btn-danger';
    revertBtn.setAttribute('data-nova', 'revert');
    revertBtn.setAttribute('aria-label', strings.diffRevertAriaLabel);
    revertBtn.textContent = strings.diffRevertButton;
    revertBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (options.onRevert) {
        options.onRevert(filePath);
      }
    });
    toolbar.appendChild(revertBtn);

    return toolbar;
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

      @media (prefers-reduced-motion: no-preference) {
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
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

      @media (prefers-reduced-motion: no-preference) {
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
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

      /* --- Toolbar --- */
      .diff-toolbar {
        display: flex;
        align-items: center;
        padding: 8px 16px;
        border-bottom: 1px solid var(--nova-panel-border);
        gap: 8px;
        flex-shrink: 0;
      }

      .diff-toolbar-spacer {
        flex: 1;
      }

      .diff-stats-chip {
        display: inline-flex;
        align-items: center;
        background: var(--nova-input-bg);
        border: 1px solid var(--nova-panel-border);
        border-radius: 12px;
        padding: 3px 10px;
        font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
      }

      .stats-added {
        color: var(--nova-success);
      }

      .stats-removed {
        color: var(--nova-error);
      }

      .diff-tool-btn {
        background: var(--nova-input-bg);
        border: 1px solid var(--nova-panel-border);
        border-radius: 6px;
        color: var(--nova-text-secondary);
        font-size: 11px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        padding: 4px 10px;
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
      }

      .diff-tool-btn:hover {
        background: var(--nova-dropdown-hover);
        color: var(--nova-text-primary);
        border-color: var(--nova-text-secondary);
      }

      .diff-tool-btn.copied-flash {
        background: rgba(63, 185, 80, 0.2);
        border-color: var(--nova-success);
        color: var(--nova-success);
        transition: all 0.1s;
      }

      .diff-tool-btn-danger {
        color: var(--nova-error);
        border-color: var(--nova-error);
      }

      .diff-tool-btn-danger:hover {
        background: rgba(248, 81, 73, 0.15);
        color: var(--nova-error);
        border-color: var(--nova-error);
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

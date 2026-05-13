import { strings } from './strings.js';
import { Z_INDEX } from './styles.js';

type EntryType = 'info' | 'thinking' | 'success' | 'error' | 'code';

const STORAGE_KEY = 'nova-activity-log';

interface StoredEntry {
  message: string;
  type: EntryType;
  time: string;
}

export class ActivityLog {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private panelEl: HTMLElement | null = null;
  private logEl: HTMLElement | null = null;
  private titleEl: HTMLElement | null = null;
  private collapseBtn: HTMLElement | null = null;
  private maxEntries = 50;
  private lastEntry: HTMLElement | null = null;
  private entryCount = 0;
  private collapsed = false;
  private unreadCount = 0;
  private badgeEl: HTMLElement | null = null;
  private storedEntries: StoredEntry[] = [];
  private diffClickHandler: ((filePath: string, diff: string) => void) | null = null;

  mount(container: HTMLElement): void {
    this.host = document.createElement('div');
    this.host.setAttribute('data-nova-activity-log', '');
    this.host.style.position = 'fixed';
    this.host.style.bottom = '20px';
    this.host.style.left = '20px';
    this.host.style.zIndex = String(Z_INDEX.activityLog);

    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = this.getStyles();
    this.shadow.appendChild(style);

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'activity-panel hidden'; // Hidden until first entry

    // Title bar with collapse button
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'activity-title';

    const titleText = document.createElement('span');
    titleText.textContent = strings.activityLogTitle;

    this.collapseBtn = document.createElement('button');
    this.collapseBtn.className = 'collapse-btn';
    this.collapseBtn.setAttribute('aria-label', strings.collapseButtonAriaLabel);
    this.collapseBtn.textContent = strings.collapseIcon;
    this.collapseBtn.title = strings.collapseButtonTitle;
    this.collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleCollapse();
    });

    // Unread badge — hidden by default, shown while collapsed with pending entries
    this.badgeEl = document.createElement('span');
    this.badgeEl.setAttribute('data-nova', 'unread');
    this.badgeEl.className = 'unread-badge';
    this.badgeEl.textContent = '';
    this.badgeEl.style.display = 'none';

    this.titleEl.appendChild(titleText);
    this.titleEl.appendChild(this.badgeEl);
    this.titleEl.appendChild(this.collapseBtn);

    // Click on title also toggles collapse
    this.titleEl.addEventListener('click', () => this.toggleCollapse());

    this.panelEl.appendChild(this.titleEl);

    this.logEl = document.createElement('div');
    this.logEl.className = 'activity-log';
    this.panelEl.appendChild(this.logEl);

    this.shadow.appendChild(this.panelEl);
    container.appendChild(this.host);

    // Restore from sessionStorage
    this.restoreState();
  }

  addEntry(
    message: string,
    type: EntryType,
    skipSave = false,
    serverTimestamp?: number,
  ): HTMLElement | null {
    if (!this.logEl || !this.panelEl) return null;

    // Show panel on first entry
    if (this.entryCount === 0) {
      this.panelEl.classList.remove('hidden');
    }
    this.entryCount++;

    // If collapsed: error auto-uncollapses, non-error increments unread badge
    if (this.collapsed) {
      if (type === 'error') {
        this.uncollapse();
      } else {
        this.unreadCount++;
        this.updateBadge();
      }
    }

    const now = serverTimestamp ? new Date(serverTimestamp) : new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    const entry = document.createElement('div');
    entry.className = `entry entry-${type}`;

    const timestamp = document.createElement('span');
    timestamp.className = 'timestamp';
    timestamp.textContent = timeStr;

    const prefix = this.getPrefix(type);

    const msg = document.createElement('span');
    msg.className = 'message';
    msg.textContent = prefix ? `${prefix} ${message}` : message;

    // Save to storage (skip for restored entries)
    if (!skipSave) {
      this.storedEntries.push({ message, type, time: timeStr });
      if (this.storedEntries.length > this.maxEntries) {
        this.storedEntries.shift();
      }
      this.saveState();
    }

    entry.appendChild(timestamp);
    entry.appendChild(msg);
    this.logEl.appendChild(entry);

    this.lastEntry = entry;

    // Trim old entries
    while (this.logEl.children.length > this.maxEntries) {
      this.logEl.removeChild(this.logEl.children[0]);
    }

    // Auto-scroll to bottom
    this.logEl.scrollTop = this.logEl.scrollHeight;

    return entry;
  }

  /** Add an entry with a summary line and collapsible details (click to expand). */
  addCollapsibleEntry(
    summary: string,
    details: string,
    type: EntryType,
    serverTimestamp?: number,
  ): HTMLElement | null {
    if (!this.logEl || !this.panelEl) return null;

    if (this.entryCount === 0) {
      this.panelEl.classList.remove('hidden');
    }
    this.entryCount++;
    if (this.collapsed) {
      if (type === 'error') {
        this.uncollapse();
      } else {
        this.unreadCount++;
        this.updateBadge();
      }
    }

    const now = serverTimestamp ? new Date(serverTimestamp) : new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    const entry = document.createElement('div');
    entry.className = `entry entry-${type} collapsible`;

    const timestamp = document.createElement('span');
    timestamp.className = 'timestamp';
    timestamp.textContent = timeStr;

    const prefix = this.getPrefix(type);
    const summaryEl = document.createElement('span');
    summaryEl.className = 'message collapsible-summary';
    summaryEl.textContent = prefix ? `${prefix} ${summary}` : summary;
    summaryEl.title = strings.clickToExpand;

    const detailsEl = document.createElement('pre');
    detailsEl.className = 'collapsible-details hidden';
    detailsEl.textContent = details;

    summaryEl.addEventListener('click', () => {
      detailsEl.classList.toggle('hidden');
      if (this.logEl) this.logEl.scrollTop = this.logEl.scrollHeight;
    });

    entry.appendChild(timestamp);
    const contentWrap = document.createElement('div');
    contentWrap.className = 'collapsible-wrap';
    contentWrap.appendChild(summaryEl);
    contentWrap.appendChild(detailsEl);
    entry.appendChild(contentWrap);
    this.logEl.appendChild(entry);

    this.lastEntry = entry;

    while (this.logEl.children.length > this.maxEntries) {
      this.logEl.removeChild(this.logEl.children[0]);
    }
    this.logEl.scrollTop = this.logEl.scrollHeight;
    return entry;
  }

  /** Register a handler for diff entry clicks. */
  onDiffClick(handler: (filePath: string, diff: string) => void): void {
    this.diffClickHandler = handler;
  }

  /** Expose public state for e2e testing. */
  getState(): { collapsed: boolean; unreadCount: number; entryCount: number; isHidden: boolean } {
    return {
      collapsed: this.collapsed,
      unreadCount: this.unreadCount,
      entryCount: this.entryCount,
      isHidden: this.panelEl?.classList.contains('hidden') ?? true,
    };
  }

  /** Add a clickable entry that opens a diff modal when clicked. */
  addDiffEntry(
    filePath: string,
    diffContent: string,
    type: EntryType,
    serverTimestamp?: number,
  ): HTMLElement | null {
    if (!this.logEl || !this.panelEl) return null;

    if (this.entryCount === 0) {
      this.panelEl.classList.remove('hidden');
    }
    this.entryCount++;
    if (this.collapsed) {
      if (type === 'error') {
        this.uncollapse();
      } else {
        this.unreadCount++;
        this.updateBadge();
      }
    }

    const now = serverTimestamp ? new Date(serverTimestamp) : new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    const entry = document.createElement('div');
    entry.className = `entry entry-${type}`;

    const timestamp = document.createElement('span');
    timestamp.className = 'timestamp';
    timestamp.textContent = timeStr;

    const prefix = this.getPrefix(type);
    const isDiff = diffContent.includes('-') || diffContent.includes('+');
    const label = isDiff
      ? `${strings.diffModified}${filePath}`
      : `${strings.diffCreated}${filePath}`;

    const msg = document.createElement('span');
    msg.className = 'message diff-link';
    msg.textContent = prefix ? `${prefix} ${label}` : label;
    msg.title = strings.clickToViewDiff;
    msg.addEventListener('click', () => {
      if (this.diffClickHandler) {
        this.diffClickHandler(filePath, diffContent);
      }
    });

    entry.appendChild(timestamp);
    entry.appendChild(msg);
    this.logEl.appendChild(entry);

    this.lastEntry = entry;

    while (this.logEl.children.length > this.maxEntries) {
      this.logEl.removeChild(this.logEl.children[0]);
    }
    this.logEl.scrollTop = this.logEl.scrollHeight;
    return entry;
  }

  updateLastEntry(text: string): void {
    if (!this.lastEntry) return;
    const msg = this.lastEntry.querySelector('.message');
    if (msg) {
      msg.textContent = text;
    }
    if (this.logEl) {
      this.logEl.scrollTop = this.logEl.scrollHeight;
    }
  }

  unmount(): void {
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.panelEl = null;
    this.logEl = null;
    this.titleEl = null;
    this.collapseBtn = null;
    this.badgeEl = null;
    this.lastEntry = null;
    this.entryCount = 0;
    this.unreadCount = 0;
  }

  private toggleCollapse(): void {
    if (this.collapsed) {
      this.uncollapse();
    } else {
      this.collapse();
    }
  }

  private collapse(): void {
    this.collapsed = true;
    this.logEl?.classList.add('collapsed');
    if (this.collapseBtn) {
      this.collapseBtn.textContent = strings.expandIcon;
      this.collapseBtn.title = strings.expandButtonTitle;
      this.collapseBtn.setAttribute('aria-label', strings.expandButtonAriaLabel);
    }
  }

  private uncollapse(): void {
    this.collapsed = false;
    this.unreadCount = 0;
    this.updateBadge();
    this.logEl?.classList.remove('collapsed');
    if (this.collapseBtn) {
      this.collapseBtn.textContent = strings.collapseIcon;
      this.collapseBtn.title = strings.collapseButtonTitle;
      this.collapseBtn.setAttribute('aria-label', strings.collapseButtonAriaLabel);
    }
    // Scroll to bottom after expand
    if (this.logEl) {
      requestAnimationFrame(() => {
        if (this.logEl) {
          this.logEl.scrollTop = this.logEl.scrollHeight;
        }
      });
    }
  }

  private updateBadge(): void {
    if (!this.badgeEl) return;
    if (this.unreadCount > 0 && this.collapsed) {
      this.badgeEl.textContent = strings.unreadBadge(this.unreadCount);
      this.badgeEl.style.display = '';
    } else {
      this.badgeEl.textContent = '';
      this.badgeEl.style.display = 'none';
    }
  }

  private saveState(): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.storedEntries));
    } catch {
      // sessionStorage may be unavailable in some environments
    }
  }

  private restoreState(): void {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const entries = JSON.parse(raw) as StoredEntry[];
      if (!Array.isArray(entries) || entries.length === 0) return;

      this.storedEntries = entries;
      for (const stored of entries) {
        this.addEntry(stored.message, stored.type, true);
      }
    } catch {
      // Corrupted or unparseable stored state — ignore
    }
  }

  private getPrefix(type: EntryType): string {
    switch (type) {
      case 'thinking':
        return strings.thinkingEmoji;
      case 'success':
        return strings.successEmoji;
      case 'error':
        return strings.errorEmoji;
      case 'code':
        return strings.codeEmoji;
      default:
        return '';
    }
  }

  private getStyles(): string {
    return `
      .activity-panel {
        width: 350px;
        background: var(--nova-panel-bg);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-radius: 10px;
        border: 1px solid var(--nova-panel-border);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 11px;
        color: var(--nova-text-primary);
        pointer-events: auto;
        transition: background 0.3s ease, opacity 0.3s ease;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .activity-panel.hidden {
        display: none;
      }

      .activity-panel:hover {
        background: var(--nova-panel-bg);
      }

      .activity-title {
        padding: 8px 12px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--nova-text-secondary);
        border-bottom: 1px solid var(--nova-panel-border);
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        user-select: none;
      }

      .activity-title:hover {
        color: var(--nova-text-primary);
      }

      .collapse-btn {
        background: none;
        border: none;
        color: var(--nova-text-secondary);
        font-size: 12px;
        cursor: pointer;
        padding: 0 2px;
        line-height: 1;
        transition: color 0.2s;
      }

      .collapse-btn:hover {
        color: var(--nova-text-primary);
      }

      .unread-badge {
        font-size: 9px;
        font-weight: 700;
        color: var(--nova-accent);
        background: rgba(59, 130, 246, 0.15);
        padding: 1px 6px;
        border-radius: 8px;
        margin-left: 6px;
        flex-shrink: 0;
      }

      .activity-log {
        overflow-y: auto;
        padding: 4px 10px;
        height: 250px;
        transition: height 0.3s ease;
      }

      .activity-log.collapsed {
        height: 0;
        padding: 0 10px;
        overflow: hidden;
      }

      .activity-log::-webkit-scrollbar {
        width: 4px;
      }

      .activity-log::-webkit-scrollbar-track {
        background: transparent;
      }

      .activity-log::-webkit-scrollbar-thumb {
        background: var(--nova-panel-border);
        border-radius: 2px;
      }

      .entry {
        padding: 3px 0;
        border-bottom: 1px solid var(--nova-panel-border);
        display: flex;
        gap: 6px;
        align-items: flex-start;
        word-break: break-word;
      }

      .timestamp {
        color: var(--nova-text-secondary);
        font-size: 10px;
        flex-shrink: 0;
        font-variant-numeric: tabular-nums;
      }

      .message {
        font-size: 11px;
        line-height: 1.3;
      }

      .entry-info .message { color: var(--nova-text-primary); }
      .entry-thinking .message { color: var(--nova-warning); font-style: italic; }
      .entry-success .message { color: var(--nova-success); }
      .entry-error .message { color: var(--nova-error); }
      .entry-code .message { color: var(--nova-text-secondary); font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; }

      .diff-link {
        cursor: pointer;
        text-decoration: underline;
        text-decoration-style: dotted;
        text-underline-offset: 2px;
      }
      .diff-link:hover {
        color: var(--nova-text-primary);
      }

      .collapsible-wrap {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .collapsible-summary {
        cursor: pointer;
        text-decoration: underline;
        text-decoration-style: dotted;
        text-underline-offset: 2px;
      }
      .collapsible-summary:hover {
        color: var(--nova-text-primary);
      }
      .collapsible-details {
        margin-top: 4px;
        padding: 6px 8px;
        background: var(--nova-surface-subtle);
        border-radius: 4px;
        font-size: 10px;
        line-height: 1.3;
        color: var(--nova-text-secondary);
        font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
        white-space: pre-wrap;
        word-break: break-all;
        max-height: 200px;
        overflow-y: auto;
      }
      .collapsible-details.hidden {
        display: none;
      }
    `;
  }
}

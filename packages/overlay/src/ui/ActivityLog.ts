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
  private storedEntries: StoredEntry[] = [];

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
    titleText.textContent = 'Nova Activity';

    this.collapseBtn = document.createElement('button');
    this.collapseBtn.className = 'collapse-btn';
    this.collapseBtn.textContent = '\u2796'; // ➖ minimize
    this.collapseBtn.title = 'Collapse';
    this.collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleCollapse();
    });

    this.titleEl.appendChild(titleText);
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

  addEntry(message: string, type: EntryType, skipSave = false, serverTimestamp?: number): HTMLElement | null {
    if (!this.logEl || !this.panelEl) return null;

    // Show panel on first entry
    if (this.entryCount === 0) {
      this.panelEl.classList.remove('hidden');
    }
    this.entryCount++;

    // If collapsed, uncollapse to show new activity
    if (this.collapsed) {
      this.uncollapse();
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

  updateLastEntry(text: string): void {
    if (!this.lastEntry) return;
    const msg = this.lastEntry.querySelector('.message');
    if (msg) {
      msg.textContent = `\u{1F9E0} ${text}`;
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
    this.lastEntry = null;
    this.entryCount = 0;
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
      this.collapseBtn.textContent = '\u2795'; // ➕ expand
      this.collapseBtn.title = 'Expand';
    }
  }

  private uncollapse(): void {
    this.collapsed = false;
    this.logEl?.classList.remove('collapsed');
    if (this.collapseBtn) {
      this.collapseBtn.textContent = '\u2796'; // ➖ minimize
      this.collapseBtn.title = 'Collapse';
    }
    // Scroll to bottom after expand
    if (this.logEl) {
      requestAnimationFrame(() => {
        this.logEl!.scrollTop = this.logEl!.scrollHeight;
      });
    }
  }

  private saveState(): void {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.storedEntries));
    } catch {}
  }

  private restoreState(): void {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const entries: StoredEntry[] = JSON.parse(raw);
      if (!Array.isArray(entries) || entries.length === 0) return;

      this.storedEntries = entries;
      for (const stored of entries) {
        this.addEntry(stored.message, stored.type, true);
      }
    } catch {}
  }

  private getPrefix(type: EntryType): string {
    switch (type) {
      case 'thinking': return '\u{1F9E0}';
      case 'success': return '\u2705';
      case 'error': return '\u274C';
      case 'code': return '\u{1F4DD}';
      default: return '';
    }
  }

  private getStyles(): string {
    return `
      .activity-panel {
        width: 350px;
        background: rgba(26, 26, 26, 0.4);
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 11px;
        color: #ffffff;
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
        background: rgba(26, 26, 26, 0.95);
      }

      .activity-title {
        padding: 8px 12px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: rgba(255, 255, 255, 0.5);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: pointer;
        user-select: none;
      }

      .activity-title:hover {
        color: rgba(255, 255, 255, 0.8);
      }

      .collapse-btn {
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.4);
        font-size: 12px;
        cursor: pointer;
        padding: 0 2px;
        line-height: 1;
        transition: color 0.2s;
      }

      .collapse-btn:hover {
        color: rgba(255, 255, 255, 0.8);
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
        background: rgba(255, 255, 255, 0.15);
        border-radius: 2px;
      }

      .entry {
        padding: 3px 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        display: flex;
        gap: 6px;
        align-items: flex-start;
        word-break: break-word;
      }

      .timestamp {
        color: rgba(255, 255, 255, 0.3);
        font-size: 10px;
        flex-shrink: 0;
        font-variant-numeric: tabular-nums;
      }

      .message {
        font-size: 11px;
        line-height: 1.3;
      }

      .entry-info .message { color: #d1d5db; }
      .entry-thinking .message { color: #fbbf24; font-style: italic; }
      .entry-success .message { color: #34d399; }
      .entry-error .message { color: #f87171; }
      .entry-code .message { color: #9ca3af; font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace; }
    `;
  }
}

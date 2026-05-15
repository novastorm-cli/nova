import { strings } from './strings.js';
import { Z_INDEX } from './styles.js';

interface TaskEntry {
  id: string;
  description: string;
  lane: number;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  commitHash?: string | undefined;
  error?: string | undefined;
  element: HTMLElement;
}

const AUTO_HIDE_DELAY_MS = 5000;
const STORAGE_KEY = 'nova-task-panel-state';
const RECENT_TASKS_KEY = 'nova_recent_tasks';
const MAX_RECENT_TASKS = 20;

interface StoredTask {
  id: string;
  description: string;
  lane: number;
  status: TaskEntry['status'];
  commitHash?: string | undefined;
  error?: string | undefined;
}

export class TaskPanel {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private listEl: HTMLElement | null = null;
  private panelEl: HTMLElement | null = null;
  private tasks: Map<string, TaskEntry> = new Map();
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private isHovering = false;
  private isHistoryMode = false;

  /** Returns the host element (for layout manager registration). */
  getHost(): HTMLElement | null {
    return this.host;
  }

  mount(container: HTMLElement): void {
    this.host = document.createElement('div');
    this.host.setAttribute('data-nova-task-panel', '');
    this.host.style.position = 'fixed';
    this.host.style.top = 'auto';
    this.host.style.right = 'auto';
    this.host.style.left = '20px';
    this.host.style.bottom = '20px';
    this.host.style.zIndex = String(Z_INDEX.taskPanel);
    this.host.style.pointerEvents = 'none';

    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = this.getStyles();
    this.shadow.appendChild(style);

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'task-panel hidden';
    this.panelEl.setAttribute('data-nova', 'task-panel');

    // Title bar with close button
    const titleBar = document.createElement('div');
    titleBar.className = 'task-panel-title-bar';

    const title = document.createElement('div');
    title.className = 'task-panel-title';
    title.textContent = strings.taskPanelTitle;
    titleBar.appendChild(title);

    // Close button (×)
    const closeBtn = document.createElement('button');
    closeBtn.className = 'task-panel-close';
    closeBtn.setAttribute('data-nova', 'close');
    closeBtn.setAttribute('aria-label', strings.taskPanelCloseAriaLabel);
    closeBtn.innerHTML = strings.closeX;
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeImmediately();
    });
    titleBar.appendChild(closeBtn);

    this.panelEl.appendChild(titleBar);

    this.listEl = document.createElement('div');
    this.listEl.className = 'task-list';
    this.panelEl.appendChild(this.listEl);

    this.shadow.appendChild(this.panelEl);

    // Pin-on-hover: suspend/resume auto-hide timer
    this.panelEl.addEventListener('pointerenter', () => {
      this.isHovering = true;
      this.clearHideTimer();
    });
    this.panelEl.addEventListener('pointerleave', () => {
      this.isHovering = false;
      this.checkAllDone();
    });

    container.appendChild(this.host);

    // Restore state after hot reload
    this.restoreState();
  }

  unmount(): void {
    this.clearHideTimer();
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.listEl = null;
    this.panelEl = null;
    this.tasks.clear();
  }

  setPendingTasks(tasks: Array<{ id: string; description: string; lane: number }>): void {
    this.clearHideTimer();
    this.tasks.clear();
    if (this.listEl) {
      this.listEl.innerHTML = '';
    }

    for (const task of tasks) {
      const element = this.createTaskRow(task.description, 'pending');
      this.listEl?.appendChild(element);
      this.tasks.set(task.id, {
        id: task.id,
        description: task.description,
        lane: task.lane,
        status: 'pending',
        element,
      });
    }

    this.show();
    this.saveState();
  }

  /** Add a single task without clearing existing ones. */
  addTask(task: { id: string; description: string; lane: number }): void {
    if (this.tasks.has(task.id)) return; // Already exists

    this.clearHideTimer();
    const element = this.createTaskRow(task.description, 'pending');
    this.listEl?.appendChild(element);
    this.tasks.set(task.id, {
      id: task.id,
      description: task.description,
      lane: task.lane,
      status: 'pending',
      element,
    });

    this.show();
    this.saveState();
  }

  setTaskStarted(taskId: string): void {
    const entry = this.tasks.get(taskId);
    if (!entry) return;
    entry.status = 'executing';
    this.updateTaskRow(entry);
    this.saveState();
  }

  setTaskCompleted(taskId: string, commitHash: string): void {
    const entry = this.tasks.get(taskId);
    if (!entry) return;
    entry.status = 'completed';
    entry.commitHash = commitHash;
    this.updateTaskRow(entry);
    this.saveState();
    this.persistToRecent();
    this.checkAllDone();
  }

  setTaskFailed(taskId: string, error: string): void {
    const entry = this.tasks.get(taskId);
    if (!entry) return;
    entry.status = 'failed';
    entry.error = error;
    this.updateTaskRow(entry);
    this.saveState();
    this.persistToRecent();
    this.checkAllDone();
  }

  setStreamingText(taskId: string, text: string, phase: string): void {
    const entry = this.tasks.get(taskId);
    if (!entry || !this.shadow) return;

    const row = entry.element;
    let streamArea = row.querySelector('.task-stream');
    if (!streamArea) {
      streamArea = document.createElement('div');
      streamArea.className = `task-stream phase-${phase}`;
      row.appendChild(streamArea);
    }

    // Update phase class
    streamArea.className = `task-stream phase-${phase}`;

    streamArea.textContent = text;

    // Auto-scroll to bottom
    streamArea.scrollTop = streamArea.scrollHeight;
  }

  hide(): void {
    this.clearHideTimer();
    this.panelEl?.classList.add('hidden');
  }

  /** Close immediately — used by the × button. */
  closeImmediately(): void {
    this.clearHideTimer();
    this.isHistoryMode = false;
    this.panelEl?.classList.add('hidden');
    if (this.listEl) this.listEl.innerHTML = '';
    this.tasks.clear();
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // sessionStorage may be unavailable
    }
  }

  /** Show the recent tasks history panel (from localStorage). */
  showHistory(): void {
    this.clearHideTimer();
    this.isHistoryMode = true;

    // Clear current tasks
    this.tasks.clear();
    if (this.listEl) this.listEl.innerHTML = '';

    try {
      const raw = localStorage.getItem(RECENT_TASKS_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as StoredTask[];
      if (!Array.isArray(data) || data.length === 0) return;

      // Show history entries (all completed/failed, not live tasks)
      for (const stored of data) {
        const element = this.createTaskRow(stored.description, stored.status);
        this.listEl?.appendChild(element);
        const entry: TaskEntry = {
          id: stored.id,
          description: stored.description,
          lane: stored.lane,
          status: stored.status,
          commitHash: stored.commitHash,
          error: stored.error,
          element,
        };
        this.tasks.set(stored.id, entry);

        // Update meta for completed/failed
        if (stored.status === 'completed' || stored.status === 'failed') {
          this.updateTaskRow(entry);
        }
      }
    } catch {
      // Ignore parse errors
      return;
    }

    this.panelEl?.classList.remove('hidden');
  }

  private show(): void {
    this.panelEl?.classList.remove('hidden');
  }

  private checkAllDone(): void {
    const allDone = Array.from(this.tasks.values()).every(
      (t) => t.status === 'completed' || t.status === 'failed',
    );
    if (allDone && this.tasks.size > 0) {
      this.clearHideTimer();
      // Don't start timer if hovering over panel
      if (!this.isHovering) {
        this.hideTimer = setTimeout(() => {
          this.hide();
          try {
            sessionStorage.removeItem(STORAGE_KEY);
          } catch {
            // sessionStorage may be unavailable
          }
        }, AUTO_HIDE_DELAY_MS);
      }
    }
  }

  /** Save completed/failed tasks to localStorage for persistent history (max 20). */
  private persistToRecent(): void {
    try {
      const terminal = Array.from(this.tasks.values()).filter(
        (t) => t.status === 'completed' || t.status === 'failed',
      );
      if (terminal.length === 0) return;

      // Load existing recent tasks
      let recent: StoredTask[] = [];
      const raw = localStorage.getItem(RECENT_TASKS_KEY);
      if (raw) {
        recent = JSON.parse(raw) as StoredTask[];
        if (!Array.isArray(recent)) recent = [];
      }

      // Merge terminal tasks into the front (dedup by id)
      const existingIds = new Set(recent.map((t) => t.id));
      for (const t of terminal) {
        if (!existingIds.has(t.id)) {
          recent.unshift({
            id: t.id,
            description: t.description,
            lane: t.lane,
            status: t.status,
            commitHash: t.commitHash,
            error: t.error,
          });
          existingIds.add(t.id);
        }
      }

      // Trim to max
      if (recent.length > MAX_RECENT_TASKS) {
        recent = recent.slice(0, MAX_RECENT_TASKS);
      }

      localStorage.setItem(RECENT_TASKS_KEY, JSON.stringify(recent));
    } catch {
      // localStorage might be unavailable
    }
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  private createTaskRow(description: string, status: TaskEntry['status']): HTMLElement {
    const row = document.createElement('div');
    row.className = `task-row status-${status}`;

    const icon = document.createElement('span');
    icon.className = 'task-icon';
    icon.innerHTML = this.getIcon(status);

    const desc = document.createElement('span');
    desc.className = 'task-desc';
    desc.textContent = description;
    desc.title = description;

    const meta = document.createElement('span');
    meta.className = 'task-meta';

    row.appendChild(icon);
    row.appendChild(desc);
    row.appendChild(meta);

    return row;
  }

  private updateTaskRow(entry: TaskEntry): void {
    const row = entry.element;
    row.className = `task-row status-${entry.status}`;

    const icon = row.querySelector('.task-icon');
    if (icon) {
      icon.innerHTML = this.getIcon(entry.status);
    }

    const meta = row.querySelector('.task-meta');
    if (meta) {
      if (entry.status === 'completed' && entry.commitHash) {
        meta.textContent = entry.commitHash.slice(0, 7);
      } else if (entry.status === 'failed' && entry.error) {
        meta.textContent = entry.error.slice(0, 30);
        meta.setAttribute('title', entry.error);
      } else {
        meta.textContent = '';
      }
    }
  }

  private getIcon(status: TaskEntry['status']): string {
    switch (status) {
      case 'pending':
        return '<svg class="task-spinner" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="30 14" stroke-linecap="round"/></svg>';
      case 'executing':
        return '<svg class="task-spinner task-spinner-fast" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="30 14" stroke-linecap="round"/></svg>';
      case 'completed':
        return '<svg class="task-check" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="currentColor" opacity="0.15"/><circle cx="9" cy="9" r="8" fill="none" stroke="currentColor" stroke-width="1.5"/><path class="checkmark" d="M5 9.5L7.5 12L13 6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      case 'failed':
        return '<svg class="task-fail" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="currentColor" opacity="0.15"/><circle cx="9" cy="9" r="8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M6 6L12 12M12 6L6 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    }
  }

  private saveState(): void {
    try {
      const data: StoredTask[] = Array.from(this.tasks.values()).map((t) => ({
        id: t.id,
        description: t.description,
        lane: t.lane,
        status: t.status,
        commitHash: t.commitHash,
        error: t.error,
      }));
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // sessionStorage might be unavailable
    }
  }

  private restoreState(): void {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const data = JSON.parse(raw) as StoredTask[];
      if (!Array.isArray(data) || data.length === 0) return;

      // Check if all tasks are done — if so, don't restore (stale)
      const allDone = data.every((t) => t.status === 'completed' || t.status === 'failed');
      if (allDone) {
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }

      // Restore tasks
      this.tasks.clear();
      if (this.listEl) this.listEl.innerHTML = '';

      for (const stored of data) {
        const element = this.createTaskRow(stored.description, stored.status);
        this.listEl?.appendChild(element);
        const entry: TaskEntry = {
          ...stored,
          element,
        };
        this.tasks.set(stored.id, entry);

        // Update meta for completed/failed
        if (stored.status === 'completed' || stored.status === 'failed') {
          this.updateTaskRow(entry);
        }
      }

      this.show();
    } catch {
      // Ignore parse errors
    }
  }

  private getStyles(): string {
    return `
      .task-panel {
        background: var(--nova-panel-bg);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-radius: 10px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        max-width: 400px;
        min-width: 280px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        pointer-events: auto;
        opacity: 1;
        transform: translateY(0);
        transition: opacity 0.3s ease, transform 0.3s ease;
        overflow: hidden;
      }

      .task-panel.hidden {
        opacity: 0;
        transform: translateY(-10px);
        pointer-events: none;
      }

      .task-panel-title-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 12px 8px 16px;
      }

      .task-panel-title {
        font-size: 13px;
        font-weight: 600;
        color: var(--nova-text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .task-panel-close {
        background: none;
        border: none;
        color: var(--nova-text-secondary);
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        padding: 2px 4px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.15s, background 0.15s;
      }

      .task-panel-close:hover {
        color: var(--nova-text-primary);
        background: var(--nova-surface-subtle);
      }

      .task-list {
        padding: 0 12px 12px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .task-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 6px;
        font-size: 13px;
        color: var(--nova-text-primary);
        background: var(--nova-surface-subtle);
      }

      .task-icon {
        flex-shrink: 0;
        width: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .task-desc {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .task-meta {
        flex-shrink: 0;
        font-size: 11px;
        font-family: "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        color: var(--nova-text-secondary);
      }

      /* Pending: spinning loader */
      .task-spinner {
        animation: spin 1s linear infinite;
        color: var(--nova-accent);
      }

      /* Executing: faster spinning loader */
      .task-spinner.task-spinner-fast {
        animation: spin 0.6s linear infinite;
        color: var(--nova-accent);
      }

      /* Completed: checkmark draw animation */
      .task-check {
        color: var(--nova-success);
      }

      .task-check .checkmark {
        stroke-dasharray: 20;
        stroke-dashoffset: 20;
        animation: checkmark-draw 0.4s ease forwards;
      }

      /* Failed: red X */
      .task-fail {
        color: var(--nova-error);
      }

      .status-executing {
        color: var(--nova-accent);
      }

      /* Completed: green */
      .status-completed {
        color: var(--nova-success);
      }

      .status-completed .task-meta {
        color: var(--nova-text-secondary);
      }

      /* Failed: red */
      .status-failed {
        color: var(--nova-error);
      }

      .status-failed .task-meta {
        color: var(--nova-error);
      }

      .task-stream {
        margin-top: 4px;
        padding: 4px 6px;
        background: var(--nova-surface-subtle);
        border-radius: 4px;
        font-family: "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 11px;
        max-height: 100px;
        overflow-y: auto;
        overflow-x: hidden;
        white-space: pre-wrap;
        word-break: break-all;
        color: var(--nova-text-primary);
      }

      .task-stream.phase-reasoning {
        color: var(--nova-text-secondary);
        font-style: italic;
      }

      .task-stream.phase-code {
        color: var(--nova-text-primary);
        font-style: normal;
      }

      @media (prefers-reduced-motion: no-preference) {
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        @keyframes checkmark-draw {
          to { stroke-dashoffset: 0; }
        }
      }
    `;
  }
}

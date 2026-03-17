import { Z_INDEX } from './styles.js';

interface TaskEntry {
  id: string;
  description: string;
  lane: number;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  commitHash?: string;
  error?: string;
  element: HTMLElement;
}

const AUTO_HIDE_DELAY_MS = 5000;
const STORAGE_KEY = 'nova-task-panel-state';

interface StoredTask {
  id: string;
  description: string;
  lane: number;
  status: TaskEntry['status'];
  commitHash?: string;
  error?: string;
}

export class TaskPanel {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private listEl: HTMLElement | null = null;
  private panelEl: HTMLElement | null = null;
  private tasks: Map<string, TaskEntry> = new Map();
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  mount(container: HTMLElement): void {
    this.host = document.createElement('div');
    this.host.setAttribute('data-nova-task-panel', '');
    this.host.style.position = 'fixed';
    this.host.style.top = '20px';
    this.host.style.right = '20px';
    this.host.style.zIndex = String(Z_INDEX.taskPanel);
    this.host.style.pointerEvents = 'none';

    this.shadow = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = this.getStyles();
    this.shadow.appendChild(style);

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'task-panel hidden';

    const title = document.createElement('div');
    title.className = 'task-panel-title';
    title.textContent = 'Nova Tasks';
    this.panelEl.appendChild(title);

    this.listEl = document.createElement('div');
    this.listEl.className = 'task-list';
    this.panelEl.appendChild(this.listEl);

    this.shadow.appendChild(this.panelEl);
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
    this.checkAllDone();
  }

  setTaskFailed(taskId: string, error: string): void {
    const entry = this.tasks.get(taskId);
    if (!entry) return;
    entry.status = 'failed';
    entry.error = error;
    this.updateTaskRow(entry);
    this.saveState();
    this.checkAllDone();
  }

  setStreamingText(taskId: string, text: string, phase: string): void {
    const entry = this.tasks.get(taskId);
    if (!entry || !this.shadow) return;

    const row = entry.element;
    let streamArea = row.querySelector('.task-stream') as HTMLElement | null;
    if (!streamArea) {
      streamArea = document.createElement('div');
      streamArea.className = `task-stream phase-${phase}`;
      row.appendChild(streamArea);
    }

    // Update phase class
    streamArea.className = `task-stream phase-${phase}`;

    // Append text, keep last ~300 chars to avoid DOM bloat
    const current = streamArea.textContent ?? '';
    const updated = current + text;
    streamArea.textContent = updated.length > 300 ? updated.slice(-300) : updated;

    // Auto-scroll to bottom
    streamArea.scrollTop = streamArea.scrollHeight;
  }

  hide(): void {
    this.panelEl?.classList.add('hidden');
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
      this.hideTimer = setTimeout(() => {
        this.hide();
        try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
      }, AUTO_HIDE_DELAY_MS);
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
    icon.textContent = this.getIcon(status);

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
      icon.textContent = this.getIcon(entry.status);
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
        return '\u23F3';
      case 'executing':
        return '\u23F3';
      case 'completed':
        return '\u2705';
      case 'failed':
        return '\u274C';
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

      const data: StoredTask[] = JSON.parse(raw);
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
        background: #1a1a1aee;
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

      .task-panel-title {
        padding: 12px 16px 8px;
        font-size: 13px;
        font-weight: 600;
        color: #9ca3af;
        text-transform: uppercase;
        letter-spacing: 0.05em;
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
        color: #f9fafb;
        background: rgba(255, 255, 255, 0.04);
      }

      .task-icon {
        flex-shrink: 0;
        width: 20px;
        text-align: center;
        font-size: 14px;
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
        color: #6b7280;
      }

      /* Pending: pulse animation */
      .status-pending .task-icon {
        animation: pulse 2s ease-in-out infinite;
      }

      /* Executing: faster pulse (spin-like) */
      .status-executing .task-icon {
        animation: spin-pulse 0.8s ease-in-out infinite;
      }

      .status-executing {
        color: #60a5fa;
      }

      /* Completed: green */
      .status-completed {
        color: #6ee7b7;
      }

      .status-completed .task-meta {
        color: #4b5563;
      }

      /* Failed: red */
      .status-failed {
        color: #fca5a5;
      }

      .status-failed .task-meta {
        color: #ef4444;
      }

      .task-stream {
        margin-top: 4px;
        padding: 4px 6px;
        background: #111;
        border-radius: 4px;
        font-family: "SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 11px;
        max-height: 100px;
        overflow-y: auto;
        overflow-x: hidden;
        white-space: pre-wrap;
        word-break: break-all;
        color: #e5e7eb;
      }

      .task-stream.phase-reasoning {
        color: #9ca3af;
        font-style: italic;
      }

      .task-stream.phase-code {
        color: #e5e7eb;
        font-style: normal;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }

      @keyframes spin-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.5; transform: scale(1.15); }
      }
    `;
  }
}

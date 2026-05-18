// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TaskPanel } from '../TaskPanel.js';

describe('TaskPanel', () => {
  let taskPanel: TaskPanel;
  let container: HTMLElement;
  let mockSessionStorage: Record<string, string>;
  let mockLocalStorage: Record<string, string>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    taskPanel = new TaskPanel();

    mockSessionStorage = {};
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn((key: string) => mockSessionStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockSessionStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockSessionStorage[key];
      }),
      clear: vi.fn(() => {
        Object.keys(mockSessionStorage).forEach((k) => delete mockSessionStorage[k]);
      }),
      get length() {
        return Object.keys(mockSessionStorage).length;
      },
      key: vi.fn((i: number) => Object.keys(mockSessionStorage)[i] ?? null),
    });

    mockLocalStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => mockLocalStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockLocalStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockLocalStorage[key];
      }),
      clear: vi.fn(() => {
        Object.keys(mockLocalStorage).forEach((k) => delete mockLocalStorage[k]);
      }),
      get length() {
        return Object.keys(mockLocalStorage).length;
      },
      key: vi.fn((i: number) => Object.keys(mockLocalStorage)[i] ?? null),
    });

    vi.useFakeTimers();
  });

  afterEach(() => {
    taskPanel.unmount();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── Mount / Unmount ────────────────────────────────────────

  it('mount(container) creates shadow DOM and renders the panel', () => {
    taskPanel.mount(container);

    const hostEl = container.querySelector('[data-nova-task-panel]');
    expect(hostEl).not.toBeNull();
    expect(hostEl!.shadowRoot).not.toBeNull();
  });

  it('panel starts hidden after mount and has data-nova="task-panel"', () => {
    taskPanel.mount(container);
    const hostEl = container.querySelector('[data-nova-task-panel]')!;
    const shadow = hostEl.shadowRoot!;
    const panelEl = shadow.querySelector('.task-panel');
    expect(panelEl).not.toBeNull();
    expect(panelEl!.classList.contains('hidden')).toBe(true);
    expect(panelEl!.getAttribute('data-nova')).toBe('task-panel');
  });

  it('unmount() removes element from container', () => {
    taskPanel.mount(container);
    expect(container.children.length).toBeGreaterThan(0);
    taskPanel.unmount();
    expect(container.children.length).toBe(0);
  });

  // ── Close button ────────────────────────────────────────────

  it('renders a close button with aria-label and data-nova attribute', () => {
    taskPanel.mount(container);
    const hostEl = container.querySelector('[data-nova-task-panel]')!;
    const shadow = hostEl.shadowRoot!;
    const closeBtn = shadow.querySelector('.task-panel-close');
    expect(closeBtn).not.toBeNull();
    expect(closeBtn!.getAttribute('aria-label')).toBe('Close task panel');
    expect(closeBtn!.getAttribute('data-nova')).toBe('close');
  });

  it('close button hides the panel immediately', () => {
    taskPanel.mount(container);
    taskPanel.setPendingTasks([{ id: 't1', description: 'Test task', lane: 1 }]);

    const hostEl = container.querySelector('[data-nova-task-panel]')!;
    const shadow = hostEl.shadowRoot!;
    const panelEl = shadow.querySelector('.task-panel')!;
    expect(panelEl.classList.contains('hidden')).toBe(false);

    const closeBtn = shadow.querySelector('.task-panel-close') as HTMLElement;
    closeBtn.click();

    expect(panelEl.classList.contains('hidden')).toBe(true);
  });

  it('close button clears any pending auto-hide timer', () => {
    taskPanel.mount(container);
    taskPanel.setPendingTasks([{ id: 't1', description: 'Test', lane: 1 }]);
    taskPanel.setTaskCompleted('t1', 'abc1234');

    // At this point, the auto-hide timer should be pending (5s)
    const hostEl = container.querySelector('[data-nova-task-panel]')!;
    const shadow = hostEl.shadowRoot!;
    const panelEl = shadow.querySelector('.task-panel')!;
    expect(panelEl.classList.contains('hidden')).toBe(false);

    // Click close — should hide immediately, not wait 5s
    const closeBtn = shadow.querySelector('.task-panel-close') as HTMLElement;
    closeBtn.click();

    expect(panelEl.classList.contains('hidden')).toBe(true);

    // Advance time past 5s — panel should still be hidden (timer was cleared)
    vi.advanceTimersByTime(6000);
    expect(panelEl.classList.contains('hidden')).toBe(true);
  });

  // ── Auto-hide after all tasks complete ──────────────────────

  it('auto-hides 5s after all tasks complete', () => {
    taskPanel.mount(container);
    taskPanel.setPendingTasks([{ id: 't1', description: 'Task 1', lane: 1 }]);

    const hostEl = container.querySelector('[data-nova-task-panel]')!;
    const shadow = hostEl.shadowRoot!;
    const panelEl = shadow.querySelector('.task-panel')!;

    taskPanel.setTaskCompleted('t1', 'abc1234');

    // Panel should still be visible before 5s
    vi.advanceTimersByTime(4000);
    expect(panelEl.classList.contains('hidden')).toBe(false);

    // After 5s, panel should hide
    vi.advanceTimersByTime(2000); // total 6s
    expect(panelEl.classList.contains('hidden')).toBe(true);
  });

  it('does NOT hide if tasks are still pending', () => {
    taskPanel.mount(container);
    taskPanel.setPendingTasks([
      { id: 't1', description: 'Task 1', lane: 1 },
      { id: 't2', description: 'Task 2', lane: 2 },
    ]);

    const hostEl = container.querySelector('[data-nova-task-panel]')!;
    const shadow = hostEl.shadowRoot!;
    const panelEl = shadow.querySelector('.task-panel')!;

    taskPanel.setTaskCompleted('t1', 'abc1234');
    // t2 is still pending

    vi.advanceTimersByTime(10000);
    expect(panelEl.classList.contains('hidden')).toBe(false);
  });

  // ── Pin-on-hover ────────────────────────────────────────────

  it('pin-on-hover prevents auto-hide timer from starting', () => {
    taskPanel.mount(container);
    taskPanel.setPendingTasks([{ id: 't1', description: 'Task 1', lane: 1 }]);

    const hostEl = container.querySelector('[data-nova-task-panel]')!;
    const shadow = hostEl.shadowRoot!;
    const panelEl = shadow.querySelector('.task-panel')!;

    // Simulate hovering over the panel
    panelEl.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    taskPanel.setTaskCompleted('t1', 'abc1234');

    // Timer should not fire while hovering
    vi.advanceTimersByTime(10000);
    expect(panelEl.classList.contains('hidden')).toBe(false);

    // Leave hover — timer should restart
    panelEl.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));

    vi.advanceTimersByTime(5100);
    expect(panelEl.classList.contains('hidden')).toBe(true);
  });

  it('hover during countdown suspends the timer', () => {
    taskPanel.mount(container);
    taskPanel.setPendingTasks([{ id: 't1', description: 'Task 1', lane: 1 }]);

    const hostEl = container.querySelector('[data-nova-task-panel]')!;
    const shadow = hostEl.shadowRoot!;
    const panelEl = shadow.querySelector('.task-panel')!;

    taskPanel.setTaskCompleted('t1', 'abc1234');

    // After 2s, start hovering
    vi.advanceTimersByTime(2000);
    panelEl.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));

    // Even after 6s total, panel should still be visible (hover paused timer)
    vi.advanceTimersByTime(4000);
    expect(panelEl.classList.contains('hidden')).toBe(false);

    // Leave hover — fresh 5s timer starts
    panelEl.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));

    vi.advanceTimersByTime(10000);
    expect(panelEl.classList.contains('hidden')).toBe(true);
  });

  // ── Task lifecycle ──────────────────────────────────────────

  it('setPendingTasks shows panel and renders task rows', () => {
    taskPanel.mount(container);

    const hostEl = container.querySelector('[data-nova-task-panel]')!;
    const shadow = hostEl.shadowRoot!;

    taskPanel.setPendingTasks([
      { id: 't1', description: 'Add login page', lane: 1 },
      { id: 't2', description: 'Fix navbar', lane: 2 },
    ]);

    const panelEl = shadow.querySelector('.task-panel')!;
    expect(panelEl.classList.contains('hidden')).toBe(false);

    const rows = shadow.querySelectorAll('.task-row');
    expect(rows.length).toBe(2);
  });

  it('setTaskStarted updates row to executing state', () => {
    taskPanel.mount(container);
    taskPanel.setPendingTasks([{ id: 't1', description: 'Test', lane: 1 }]);
    taskPanel.setTaskStarted('t1');

    const hostEl = container.querySelector('[data-nova-task-panel]')!;
    const shadow = hostEl.shadowRoot!;
    const row = shadow.querySelector('.task-row')!;
    expect(row.className).toContain('status-executing');
  });

  it('setTaskCompleted shows completed state and commit hash', () => {
    taskPanel.mount(container);
    taskPanel.setPendingTasks([{ id: 't1', description: 'Test', lane: 1 }]);
    taskPanel.setTaskCompleted('t1', 'abc1234567');

    const hostEl = container.querySelector('[data-nova-task-panel]')!;
    const shadow = hostEl.shadowRoot!;
    const row = shadow.querySelector('.task-row')!;
    expect(row.className).toContain('status-completed');

    const meta = row.querySelector('.task-meta');
    expect(meta).not.toBeNull();
    expect(meta!.textContent).toBe('abc1234');
  });

  it('setTaskFailed shows failed state and error', () => {
    taskPanel.mount(container);
    taskPanel.setPendingTasks([{ id: 't1', description: 'Test', lane: 1 }]);
    taskPanel.setTaskFailed('t1', 'Something went wrong');

    const hostEl = container.querySelector('[data-nova-task-panel]')!;
    const shadow = hostEl.shadowRoot!;
    const row = shadow.querySelector('.task-row')!;
    expect(row.className).toContain('status-failed');

    const meta = row.querySelector('.task-meta');
    expect(meta).not.toBeNull();
    expect(meta!.textContent).toContain('Something went wrong');
  });

  it('addTask adds a task without clearing existing ones', () => {
    taskPanel.mount(container);
    taskPanel.setPendingTasks([{ id: 't1', description: 'Task 1', lane: 1 }]);
    taskPanel.addTask({ id: 't2', description: 'Task 2', lane: 2 });

    const hostEl = container.querySelector('[data-nova-task-panel]')!;
    const shadow = hostEl.shadowRoot!;
    expect(shadow.querySelectorAll('.task-row').length).toBe(2);
  });

  it('addTask ignores duplicate task IDs', () => {
    taskPanel.mount(container);
    taskPanel.setPendingTasks([{ id: 't1', description: 'Task 1', lane: 1 }]);
    taskPanel.addTask({ id: 't1', description: 'Task 1 dup', lane: 2 });

    const hostEl = container.querySelector('[data-nova-task-panel]')!;
    const shadow = hostEl.shadowRoot!;
    expect(shadow.querySelectorAll('.task-row').length).toBe(1);
  });

  // ── localStorage persistence for recent tasks ───────────────

  it('persists completed tasks to localStorage under nova:recent-tasks', () => {
    taskPanel.mount(container);
    taskPanel.setPendingTasks([
      { id: 't1', description: 'Task 1', lane: 1 },
      { id: 't2', description: 'Task 2', lane: 2 },
    ]);

    taskPanel.setTaskCompleted('t1', 'abc1234');
    taskPanel.setTaskCompleted('t2', 'def5678');

    const stored = JSON.parse(mockLocalStorage['nova:recent-tasks']!) as Array<{
      id: string;
      status: string;
    }>;
    expect(stored).toHaveLength(2);
    expect(stored[0]!.id).toBe('t2'); // most recent first
    expect(stored[1]!.id).toBe('t1');
    expect(stored[0]!.status).toBe('completed');
    expect(stored[1]!.status).toBe('completed');
  });

  it('persists failed tasks in recent tasks', () => {
    taskPanel.mount(container);
    taskPanel.setPendingTasks([{ id: 't1', description: 'Task 1', lane: 1 }]);
    taskPanel.setTaskFailed('t1', 'something broke');

    const stored = JSON.parse(mockLocalStorage['nova:recent-tasks']!) as Array<{
      status: string;
      error: string;
    }>;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.status).toBe('failed');
    expect(stored[0]!.error).toBe('something broke');
  });

  it('caps recent tasks at 20', () => {
    taskPanel.mount(container);

    // Pre-populate localStorage with 19 existing tasks
    const existing = Array.from({ length: 19 }, (_, i) => ({
      id: `old-${i}`,
      description: `Old task ${i}`,
      lane: 1,
      status: 'completed' as const,
      commitHash: 'abc',
    }));
    mockLocalStorage['nova:recent-tasks'] = JSON.stringify(existing);

    // Add 3 new tasks
    taskPanel.setPendingTasks([
      { id: 'new-1', description: 'New 1', lane: 1 },
      { id: 'new-2', description: 'New 2', lane: 1 },
      { id: 'new-3', description: 'New 3', lane: 1 },
    ]);
    taskPanel.setTaskCompleted('new-1', 'abc');
    taskPanel.setTaskCompleted('new-2', 'abc');
    taskPanel.setTaskCompleted('new-3', 'abc');

    const stored = JSON.parse(mockLocalStorage['nova:recent-tasks']) as Array<{
      id: string;
    }>;
    expect(stored.length).toBe(20); // 19 old + 3 new = 22, capped to 20

    // Newer tasks should be at the front
    expect(stored[0]!.id).toBe('new-3');
    expect(stored[1]!.id).toBe('new-2');
    expect(stored[2]!.id).toBe('new-1');
  });

  it('deduplicates tasks by id in recent tasks', () => {
    taskPanel.mount(container);

    // Pre-populate with a task
    mockLocalStorage['nova:recent-tasks'] = JSON.stringify([
      { id: 't1', description: 'Old desc', lane: 1, status: 'completed', commitHash: 'old' },
    ]);

    // Complete same task ID again — should not duplicate (id-based dedup)
    taskPanel.setPendingTasks([{ id: 't1', description: 'New desc', lane: 1 }]);
    taskPanel.setTaskCompleted('t1', 'newhash');

    const stored = JSON.parse(mockLocalStorage['nova:recent-tasks']) as Array<{
      id: string;
    }>;
    expect(stored).toHaveLength(1);
    // Existing entry is preserved as-is (new completion at same id doesn't update)
    expect(stored[0]!.id).toBe('t1');
  });

  // ── showHistory ─────────────────────────────────────────────

  it('showHistory renders tasks from localStorage recent tasks', () => {
    taskPanel.mount(container);

    mockLocalStorage['nova:recent-tasks'] = JSON.stringify([
      {
        id: 'hist-1',
        description: 'Added logout button',
        lane: 1,
        status: 'completed',
        commitHash: 'abc1234',
      },
      {
        id: 'hist-2',
        description: 'Fixed header layout',
        lane: 2,
        status: 'failed',
        error: 'build error',
      },
    ]);

    taskPanel.showHistory();

    const hostEl = container.querySelector('[data-nova-task-panel]')!;
    const shadow = hostEl.shadowRoot!;
    const panelEl = shadow.querySelector('.task-panel')!;
    expect(panelEl.classList.contains('hidden')).toBe(false);

    const rows = shadow.querySelectorAll('.task-row');
    expect(rows.length).toBe(2);
    expect(shadow.querySelector('.status-completed')).not.toBeNull();
    expect(shadow.querySelector('.status-failed')).not.toBeNull();
  });

  it('showHistory does nothing when localStorage is empty', () => {
    taskPanel.mount(container);

    taskPanel.showHistory();

    const hostEl = container.querySelector('[data-nova-task-panel]')!;
    const shadow = hostEl.shadowRoot!;
    const panelEl = shadow.querySelector('.task-panel')!;
    // Panel should stay hidden when there's no history to show
    expect(panelEl.classList.contains('hidden')).toBe(true);
    expect(shadow.querySelectorAll('.task-row').length).toBe(0);
  });

  // ── Session state restore ───────────────────────────────────

  it('restores state from sessionStorage across hot reload', () => {
    mockSessionStorage['nova-task-panel-state'] = JSON.stringify([
      { id: 't1', description: 'In progress', lane: 1, status: 'executing' },
      { id: 't2', description: 'Done', lane: 2, status: 'completed', commitHash: 'def5678' },
    ]);

    taskPanel.mount(container);

    const hostEl = container.querySelector('[data-nova-task-panel]')!;
    const shadow = hostEl.shadowRoot!;
    const panelEl = shadow.querySelector('.task-panel')!;
    expect(panelEl.classList.contains('hidden')).toBe(false);

    const rows = shadow.querySelectorAll('.task-row');
    expect(rows.length).toBe(2);
  });

  it('does not restore state when all tasks are done (stale state)', () => {
    mockSessionStorage['nova-task-panel-state'] = JSON.stringify([
      { id: 't1', description: 'Done', lane: 1, status: 'completed', commitHash: 'abc' },
      { id: 't2', description: 'Failed', lane: 1, status: 'failed', error: 'err' },
    ]);

    taskPanel.mount(container);

    const hostEl = container.querySelector('[data-nova-task-panel]')!;
    const shadow = hostEl.shadowRoot!;
    const panelEl = shadow.querySelector('.task-panel')!;
    expect(panelEl.classList.contains('hidden')).toBe(true);
    expect(shadow.querySelectorAll('.task-row').length).toBe(0);

    // sessionStorage should have been cleaned up
    expect(mockSessionStorage['nova-task-panel-state']).toBeUndefined();
  });
});

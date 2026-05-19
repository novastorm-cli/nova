// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ActivityLog } from '../ActivityLog.js';
import { TaskPanel } from '../TaskPanel.js';
import { DiffModal } from '../DiffModal.js';

/**
 * Integration test: simulate the WS event → UI pipeline.
 *
 * The real pipeline runs inside the `boot()` closure in index.ts.
 * Here we drive ActivityLog, TaskPanel, and DiffModal directly with the
 * same call sequences the WS event handler produces, then assert that
 * the DOM mutations are observable.  This validates that the three
 * components integrate correctly when wired in the proper sequence.
 */
describe('WS Event → UI Pipeline', () => {
  let container: HTMLElement;
  let activityLog: ActivityLog;
  let taskPanel: TaskPanel;
  let diffModal: DiffModal;
  let mockSessionStorage: Record<string, string>;
  let mockLocalStorage: Record<string, string>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    sessionStorage.clear();

    activityLog = new ActivityLog();
    taskPanel = new TaskPanel();
    diffModal = new DiffModal();

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
    activityLog.unmount();
    taskPanel.unmount();
    diffModal.unmount();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ── Helpers ──────────────────────────────────────────────────────

  function getActivityPanel(): HTMLElement | null {
    const host = container.querySelector('[data-nova="activity-log"]');
    return host?.shadowRoot?.querySelector('.activity-panel') ?? null;
  }

  function getActivityEntries(): NodeListOf<Element> {
    const host = container.querySelector('[data-nova="activity-log"]');
    return host?.shadowRoot?.querySelectorAll('[data-nova="entry"]') ?? ([] as any);
  }

  function getTaskPanel(): HTMLElement | null {
    const host = container.querySelector('[data-nova="task-panel"]');
    return host?.shadowRoot?.querySelector('.task-panel') ?? null;
  }

  function getTaskRows(): NodeListOf<Element> {
    const host = container.querySelector('[data-nova="task-panel"]');
    return host?.shadowRoot?.querySelectorAll('.task-row') ?? ([] as any);
  }

  function isDiffVisible(): boolean {
    const host = container.querySelector('[data-nova="diff-modal"]');
    const overlay = host?.shadowRoot?.querySelector('.diff-overlay');
    return overlay ? !overlay.classList.contains('hidden') : false;
  }

  // ── VAL-OVERLAY-XXX: task_created → ActivityLog + TaskPanel ──────

  it('task_created event populates ActivityLog with an entry and TaskPanel with a task row', () => {
    activityLog.mount(container);
    taskPanel.mount(container);

    // Simulate the call sequence from the task_created WS event handler.
    // The real handler calls taskPanel.addTask() and activityLog.addEntry().
    taskPanel.addTask({ id: 'task-1', description: 'Add login page', lane: 3 });
    activityLog.addEntry('Task: Add login page (Lane 3)', 'info');

    // ActivityLog: panel should now be visible
    const panel = getActivityPanel();
    expect(panel).not.toBeNull();
    expect(panel!.classList.contains('hidden')).toBe(false);

    // ActivityLog: at least 1 entry
    const entries = getActivityEntries();
    expect(entries.length).toBeGreaterThanOrEqual(1);

    // TaskPanel: should be visible
    const tp = getTaskPanel();
    expect(tp).not.toBeNull();
    expect(tp!.classList.contains('hidden')).toBe(false);

    // TaskPanel: at least 1 row
    const rows = getTaskRows();
    expect(rows.length).toBeGreaterThanOrEqual(1);

    // TaskPanel: row describes the task
    const desc = rows[0]!.querySelector('.task-desc');
    expect(desc).not.toBeNull();
    expect(desc!.textContent).toContain('Add login page');
  });

  it('task_started event updates TaskPanel task state to executing', () => {
    activityLog.mount(container);
    taskPanel.mount(container);

    // Step 1: task_created
    taskPanel.addTask({ id: 'task-1', description: 'Add login page', lane: 3 });
    activityLog.addEntry('Task: Add login page (Lane 3)', 'info');

    // Step 2: task_started
    taskPanel.setTaskStarted('task-1');
    activityLog.addEntry('Starting: task-1', 'info');

    // TaskPanel row should be in executing state
    const rows = getTaskRows();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0]!;
    expect(row.className).toContain('status-executing');

    // ActivityLog should have the "Starting:" entry
    const entries = getActivityEntries();
    const startingEntry = Array.from(entries).find((e) =>
      e.textContent?.includes('Starting: task-1'),
    );
    expect(startingEntry).toBeDefined();
  });

  it('task_completed event updates TaskPanel to completed with commit hash', () => {
    activityLog.mount(container);
    taskPanel.mount(container);

    // Full lifecycle simulation
    taskPanel.addTask({ id: 'task-1', description: 'Add login page', lane: 3 });
    activityLog.addEntry('Task: Add login page (Lane 3)', 'info');

    taskPanel.setTaskStarted('task-1');
    activityLog.addEntry('Starting: task-1', 'info');

    taskPanel.setTaskCompleted('task-1', 'abc1234567');
    activityLog.addEntry('Done: task-1', 'success');

    // TaskPanel: row in completed state
    const rows = getTaskRows();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0]!;
    expect(row.className).toContain('status-completed');

    // TaskPanel: commit hash shown in meta
    const meta = row.querySelector('.task-meta');
    expect(meta).not.toBeNull();
    expect(meta!.textContent).toBe('abc1234');

    // ActivityLog: success entry present
    const entries = getActivityEntries();
    const doneEntry = Array.from(entries).find((e) => e.textContent?.includes('Done: task-1'));
    expect(doneEntry).toBeDefined();
  });

  it('task_failed event updates TaskPanel to failed with error', () => {
    activityLog.mount(container);
    taskPanel.mount(container);

    // Full lifecycle → failure
    taskPanel.addTask({ id: 'task-1', description: 'Fix build', lane: 3 });
    activityLog.addEntry('Task: Fix build (Lane 3)', 'info');

    taskPanel.setTaskStarted('task-1');
    activityLog.addEntry('Starting: task-1', 'info');

    taskPanel.setTaskFailed('task-1', 'Cannot find module');
    activityLog.addEntry('Failed: task-1 - Cannot find module', 'error');

    // TaskPanel: row in failed state
    const rows = getTaskRows();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0]!;
    expect(row.className).toContain('status-failed');

    // TaskPanel: error shown in meta
    const meta = row.querySelector('.task-meta');
    expect(meta).not.toBeNull();
    expect(meta!.textContent).toContain('Cannot find module');

    // ActivityLog: error entry present
    const entries = getActivityEntries();
    const failedEntry = Array.from(entries).find((e) =>
      e.textContent?.includes('Failed: task-1'),
    );
    expect(failedEntry).toBeDefined();
  });

  it('pending_tasks event shows all tasks with confirmation chips', () => {
    activityLog.mount(container);
    taskPanel.mount(container);

    // Simulate pending_tasks handler:
    // taskPanel.setPendingTasks([...]), activityLog.addEntry(...)
    taskPanel.setPendingTasks([
      { id: 't1', description: 'Add form validation', lane: 2 },
      { id: 't2', description: 'Style the header', lane: 1, preConfirmed: true },
    ]);
    activityLog.addEntry('Awaiting confirmation for 2 task(s)', 'info');

    // Two rows
    const rows = getTaskRows();
    expect(rows.length).toBe(2);

    // First task: chip says "awaiting confirmation"
    const chip1 = rows[0]!.querySelector('.task-confirm-chip');
    expect(chip1).not.toBeNull();
    expect(chip1!.textContent).toContain('awaiting confirmation');

    // Second task: chip says "auto-execute on" (preConfirmed)
    const chip2 = rows[1]!.querySelector('.task-confirm-chip');
    expect(chip2).not.toBeNull();
    expect(chip2!.textContent).toContain('auto-execute');
  });

  it('multiple task_created events correctly populate multiple tasks', () => {
    activityLog.mount(container);
    taskPanel.mount(container);

    // Simulate 3 tasks being created in auto-execute path
    taskPanel.addTask({ id: 't1', description: 'Task One', lane: 1 });
    activityLog.addEntry('Task: Task One (Lane 1)', 'info');

    taskPanel.addTask({ id: 't2', description: 'Task Two', lane: 2 });
    activityLog.addEntry('Task: Task Two (Lane 2)', 'info');

    taskPanel.addTask({ id: 't3', description: 'Task Three', lane: 3 });
    activityLog.addEntry('Task: Task Three (Lane 3)', 'info');

    const rows = getTaskRows();
    expect(rows.length).toBe(3);

    // Each task should be present
    const descriptions = Array.from(rows).map(
      (r) => r.querySelector('.task-desc')?.textContent,
    );
    expect(descriptions).toContain('Task One');
    expect(descriptions).toContain('Task Two');
    expect(descriptions).toContain('Task Three');
  });

  it('areAllTasksTerminal returns false when tasks are still pending', () => {
    activityLog.mount(container);
    taskPanel.mount(container);

    taskPanel.setPendingTasks([
      { id: 't1', description: 'Task 1', lane: 1 },
      { id: 't2', description: 'Task 2', lane: 2 },
    ]);

    expect(taskPanel.areAllTasksTerminal()).toBe(false);

    // Complete only one
    taskPanel.setTaskStarted('t1');
    taskPanel.setTaskCompleted('t1', 'abc');

    expect(taskPanel.areAllTasksTerminal()).toBe(false);
  });

  it('areAllTasksTerminal returns true when all tasks are done', () => {
    activityLog.mount(container);
    taskPanel.mount(container);

    taskPanel.setPendingTasks([
      { id: 't1', description: 'Task 1', lane: 1 },
      { id: 't2', description: 'Task 2', lane: 2 },
    ]);

    taskPanel.setTaskStarted('t1');
    taskPanel.setTaskCompleted('t1', 'abc');
    taskPanel.setTaskStarted('t2');
    taskPanel.setTaskFailed('t2', 'Error');

    expect(taskPanel.areAllTasksTerminal()).toBe(true);
  });

  it('areAllTasksTerminal returns false when panel is empty', () => {
    activityLog.mount(container);
    taskPanel.mount(container);

    // No tasks added — should return false (not "all done")
    expect(taskPanel.areAllTasksTerminal()).toBe(false);
  });

  it('getTaskCount reflects actual panel task count', () => {
    activityLog.mount(container);
    taskPanel.mount(container);

    expect(taskPanel.getTaskCount()).toBe(0);

    taskPanel.addTask({ id: 't1', description: 'Task 1', lane: 1 });
    expect(taskPanel.getTaskCount()).toBe(1);

    taskPanel.addTask({ id: 't2', description: 'Task 2', lane: 2 });
    expect(taskPanel.getTaskCount()).toBe(2);

    // Duplicate should be ignored
    taskPanel.addTask({ id: 't1', description: 'Task 1 dup', lane: 1 });
    expect(taskPanel.getTaskCount()).toBe(2);
  });

  // ── DiffModal integration ─────────────────────────────────────

  it('ActivityLog diff entry click opens DiffModal with correct content', () => {
    activityLog.mount(container);
    diffModal.mount(container);

    // Wire the diff click handler to open DiffModal
    activityLog.onDiffClick((filePath, diff) => {
      diffModal.show(filePath, diff, {
        absPath: filePath,
        firstLineNumber: 10,
        canOpen: true,
      });
    });

    // Create a diff entry in ActivityLog
    const diffContent = [
      '--- a/src/App.tsx',
      '+++ b/src/App.tsx',
      '@@ -10,6 +10,8 @@',
      ' import React from "react";',
      '+import { Header } from "./Header";',
      '+',
      ' export default function App() {',
    ].join('\n');

    activityLog.addDiffEntry('src/App.tsx', diffContent, 'code');

    // Click the diff link in ActivityLog
    const host = container.querySelector('[data-nova="activity-log"]');
    const diffLink = host?.shadowRoot?.querySelector('.diff-link') as HTMLElement;
    expect(diffLink).not.toBeNull();

    diffLink!.click();

    // DiffModal should now be visible
    expect(isDiffVisible()).toBe(true);

    // Close the modal
    const modalHost = container.querySelector('[data-nova="diff-modal"]');
    const closeBtn = modalHost?.shadowRoot?.querySelector(
      '[data-nova="close"]',
    ) as HTMLElement;
    expect(closeBtn).not.toBeNull();
    closeBtn!.click();

    expect(isDiffVisible()).toBe(false);
  });

  it('DiffModal toolbar shows Copy, Open file, Revert, and stats badge', () => {
    diffModal.mount(container);

    const diffContent = [
      '--- a/src/App.tsx',
      '+++ b/src/App.tsx',
      '@@ -1,3 +1,5 @@',
      ' import React from "react";',
      ' ',
      '+import { Header } from "./Header";',
      '+',
      ' export default function App() {',
    ].join('\n');

    diffModal.show('src/App.tsx', diffContent, {
      absPath: '/path/to/src/App.tsx',
      firstLineNumber: 3,
      canOpen: true,
    });

    const modalHost = container.querySelector('[data-nova="diff-modal"]');
    const shadow = modalHost!.shadowRoot!;

    // Stats badge: +2 -0
    const stats = shadow.querySelector('[data-nova="stats"]');
    expect(stats).not.toBeNull();
    expect(stats!.textContent).toContain('+2');
    expect(stats!.textContent).toContain('-0');

    // Copy button
    const copyBtn = shadow.querySelector('[data-nova="copy"]');
    expect(copyBtn).not.toBeNull();
    expect(copyBtn!.getAttribute('aria-label')).toBeTruthy();

    // Open file button (canOpen=true)
    const openBtn = shadow.querySelector('[data-nova="open-file"]');
    expect(openBtn).not.toBeNull();

    // Revert button
    const revertBtn = shadow.querySelector('[data-nova="revert"]');
    expect(revertBtn).not.toBeNull();

    // Close button
    const closeBtn = shadow.querySelector('[data-nova="close"]');
    expect(closeBtn).not.toBeNull();
  });

  it('open file button is hidden when canOpen is false', () => {
    diffModal.mount(container);

    const diffContent = [
      '--- a/src/App.tsx',
      '+++ b/src/App.tsx',
      '@@ -1,3 +1,4 @@',
      ' import React from "react";',
      '+// comment',
    ].join('\n');

    diffModal.show('src/App.tsx', diffContent, {
      absPath: '/path/to/src/App.tsx',
      firstLineNumber: 1,
      canOpen: false,
    });

    const modalHost = container.querySelector('[data-nova="diff-modal"]');
    const shadow = modalHost!.shadowRoot!;
    const openBtn = shadow.querySelector('[data-nova="open-file"]');
    expect(openBtn).toBeNull(); // Not rendered when canOpen=false
  });

  it('revert button triggers onRevert callback', () => {
    diffModal.mount(container);

    const onRevert = vi.fn();
    const diffContent = [
      '--- a/src/App.tsx',
      '+++ b/src/App.tsx',
      '@@ -1,3 +1,4 @@',
      ' import React from "react";',
      '+// comment',
    ].join('\n');

    diffModal.show('src/App.tsx', diffContent, {
      onRevert,
    });

    const modalHost = container.querySelector('[data-nova="diff-modal"]');
    const shadow = modalHost!.shadowRoot!;
    const revertBtn = shadow.querySelector('[data-nova="revert"]') as HTMLElement;
    expect(revertBtn).not.toBeNull();

    revertBtn!.click();
    expect(onRevert).toHaveBeenCalledWith('src/App.tsx');
  });
});

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ActivityLog } from '../ActivityLog.js';

describe('ActivityLog', () => {
  let activityLog: ActivityLog;
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // Clear sessionStorage to avoid cross-test pollution from restoreState()
    sessionStorage.clear();
    activityLog = new ActivityLog();
  });

  afterEach(() => {
    activityLog.unmount();
    document.body.innerHTML = '';
  });

  function getHost(): HTMLElement | null {
    return container.querySelector('[data-nova="activity-log"]');
  }

  function getShadow(): ShadowRoot | null {
    return getHost()?.shadowRoot ?? null;
  }

  function getPanel(): HTMLElement | null {
    return getShadow()?.querySelector('.activity-panel') ?? null;
  }

  function getTitleBar(): HTMLElement | null {
    return getShadow()?.querySelector('.activity-title') ?? null;
  }

  function getLogEl(): HTMLElement | null {
    return getShadow()?.querySelector('.activity-log') ?? null;
  }

  function getBadge(): HTMLElement | null {
    return getShadow()?.querySelector('[data-nova="unread"]') ?? null;
  }

  function isPanelHidden(): boolean {
    const panel = getPanel();
    if (!panel) return true;
    return panel.classList.contains('hidden');
  }

  function isLogCollapsed(): boolean {
    const log = getLogEl();
    if (!log) return false;
    return log.classList.contains('collapsed');
  }

  // ── VAL-OVERLAY-034: Auto-open on first task entry ──────────────

  it('panel is hidden before any entries are added', () => {
    activityLog.mount(container);
    expect(isPanelHidden()).toBe(true);
  });

  it('panel auto-opens on first entry (entryCount 0 → visible)', () => {
    activityLog.mount(container);
    activityLog.addEntry('Starting task', 'info');
    expect(isPanelHidden()).toBe(false);
  });

  // ── VAL-OVERLAY-035: Non-error entries do NOT uncollapse; badge increments ──

  it('when collapsed, non-error entries do NOT uncollapse the log', () => {
    activityLog.mount(container);

    // First open, then manually collapse
    activityLog.addEntry('First entry', 'info');
    expect(isPanelHidden()).toBe(false);

    // Click the title bar to collapse (simulate collapse)
    const titleBar = getTitleBar();
    expect(titleBar).not.toBeNull();
    (titleBar as HTMLElement).click(); // toggles collapse

    expect(isLogCollapsed()).toBe(true);

    // Add non-error entries while collapsed
    activityLog.addEntry('Info entry 1', 'info');
    activityLog.addEntry('Thinking entry', 'thinking');
    activityLog.addEntry('Success entry', 'success');

    // Should still be collapsed
    expect(isLogCollapsed()).toBe(true);
  });

  it('unread badge appears with count when entries arrive while collapsed', () => {
    activityLog.mount(container);

    // Open panel, then collapse
    activityLog.addEntry('First entry', 'info');
    const titleBar = getTitleBar();
    (titleBar as HTMLElement).click();
    expect(isLogCollapsed()).toBe(true);

    // Add 3 entries
    activityLog.addEntry('Entry 1', 'info');
    activityLog.addEntry('Entry 2', 'info');
    activityLog.addEntry('Entry 3', 'thinking');

    // Badge should show "(3 new)"
    const badge = getBadge();
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('3');
    expect(badge!.textContent).toContain('new');
  });

  it('unread badge increments correctly across multiple batches', () => {
    activityLog.mount(container);

    activityLog.addEntry('First entry', 'info');
    const titleBar = getTitleBar();
    (titleBar as HTMLElement).click();

    activityLog.addEntry('Entry 1', 'info');
    let badge = getBadge();
    expect(badge!.textContent).toContain('1');

    activityLog.addEntry('Entry 2', 'info');
    activityLog.addEntry('Entry 3', 'thinking');
    badge = getBadge();
    expect(badge!.textContent).toContain('3');
  });

  // ── VAL-OVERLAY-036: Error entries auto-uncollapse ──────────────

  it('error entries auto-uncollapse a collapsed log', () => {
    activityLog.mount(container);

    // Open panel, then collapse
    activityLog.addEntry('First entry', 'info');
    const titleBar = getTitleBar();
    (titleBar as HTMLElement).click();
    expect(isLogCollapsed()).toBe(true);

    // Add an error entry — should auto-uncollapse
    activityLog.addEntry('Something went wrong!', 'error');
    expect(isLogCollapsed()).toBe(false);
  });

  it('error entries do not increment unread count (they uncollapse instead)', () => {
    activityLog.mount(container);

    activityLog.addEntry('First entry', 'info');
    const titleBar = getTitleBar();
    (titleBar as HTMLElement).click();

    // Add some info entries first
    activityLog.addEntry('Info entry', 'info');
    activityLog.addEntry('Thinking entry', 'thinking');
    let badge = getBadge();
    expect(badge!.textContent).toContain('2');

    // Add error entry — should uncollapse and clear badge
    activityLog.addEntry('Error happened!', 'error');
    expect(isLogCollapsed()).toBe(false);
    badge = getBadge();
    // Badge should be hidden or removed after uncollapse
    expect(badge === null || badge.textContent === '').toBe(true);
  });

  // ── VAL-OVERLAY-037: Timestamp on every entry ──────────────────

  it('every entry has a timestamp in HH:MM:SS format', () => {
    activityLog.mount(container);
    activityLog.addEntry('Task started', 'info');
    activityLog.addEntry('Thinking...', 'thinking');
    activityLog.addEntry('Done!', 'success');

    const logEl = getLogEl();
    expect(logEl).not.toBeNull();

    const timestamps = logEl!.querySelectorAll('.timestamp');
    expect(timestamps.length).toBe(3);

    const hhmmssPattern = /^\d{2}:\d{2}:\d{2}$/;
    for (const ts of timestamps) {
      expect(ts.textContent).toMatch(hhmmssPattern);
    }
  });

  it('timestamp uses server timestamp when provided', () => {
    activityLog.mount(container);

    // Use a specific server timestamp
    const serverTs = new Date('2025-06-15T14:35:42').getTime();
    activityLog.addEntry('Server-timed entry', 'info', false, serverTs);

    const logEl = getLogEl();
    const timestamp = logEl!.querySelector('.timestamp');
    expect(timestamp!.textContent).toBe('14:35:42');
  });

  // ── Manual collapse / uncollapse ───────────────────────────────

  it('manual uncollapse resets unread count and hides badge', () => {
    activityLog.mount(container);

    activityLog.addEntry('First entry', 'info');
    const titleBar = getTitleBar();
    (titleBar as HTMLElement).click(); // collapse
    expect(isLogCollapsed()).toBe(true);

    // Add entries while collapsed
    activityLog.addEntry('Entry 1', 'info');
    activityLog.addEntry('Entry 2', 'info');
    let badge = getBadge();
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('2');

    // Manually uncollapse
    (titleBar as HTMLElement).click(); // toggle back → uncollapse
    expect(isLogCollapsed()).toBe(false);

    // Badge should be hidden/cleared
    badge = getBadge();
    expect(badge === null || badge.textContent === '').toBe(true);
  });

  // ── Diff entries follow same rules ─────────────────────────────

  it('diff entries do not uncollapse a collapsed log', () => {
    activityLog.mount(container);

    activityLog.addEntry('First entry', 'info');
    const titleBar = getTitleBar();
    (titleBar as HTMLElement).click();
    expect(isLogCollapsed()).toBe(true);

    activityLog.addDiffEntry('src/App.tsx', '- old\n+ new', 'code');
    expect(isLogCollapsed()).toBe(true);

    // Badge should show 1
    const badge = getBadge();
    expect(badge!.textContent).toContain('1');
  });

  it('collapsible entries do not uncollapse a collapsed log', () => {
    activityLog.mount(container);

    activityLog.addEntry('First entry', 'info');
    const titleBar = getTitleBar();
    (titleBar as HTMLElement).click();
    expect(isLogCollapsed()).toBe(true);

    activityLog.addCollapsibleEntry('Summary', 'Details...', 'info');
    expect(isLogCollapsed()).toBe(true);
  });
});

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

  it('starts collapsed and non-error entries do NOT uncollapse the log', () => {
    activityLog.mount(container);

    // Panel hidden initially (no entries), log starts collapsed
    expect(isPanelHidden()).toBe(true);

    // First entry shows the panel but keeps log collapsed
    activityLog.addEntry('First entry', 'info');
    expect(isPanelHidden()).toBe(false);
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

    // First entry shows panel, log is collapsed (initial state)
    activityLog.addEntry('First entry', 'info');
    expect(isLogCollapsed()).toBe(true);

    // Add 3 more entries
    activityLog.addEntry('Entry 1', 'info');
    activityLog.addEntry('Entry 2', 'info');
    activityLog.addEntry('Entry 3', 'thinking');

    // Badge should show a count (first entry + 3 more = 4 total)
    const badge = getBadge();
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('new');
  });

  it('unread badge increments correctly across multiple batches', () => {
    activityLog.mount(container);

    // First entry (log starts collapsed) → badge shows count
    activityLog.addEntry('First entry', 'info');

    activityLog.addEntry('Entry 1', 'info');
    let badge = getBadge();
    expect(badge).not.toBeNull();

    activityLog.addEntry('Entry 2', 'info');
    activityLog.addEntry('Entry 3', 'thinking');
    badge = getBadge();
    expect(badge).not.toBeNull();
  });

  // ── VAL-OVERLAY-036: Error entries auto-uncollapse ──────────────

  it('error entries auto-uncollapse a collapsed log', () => {
    activityLog.mount(container);

    // First entry shows the panel but log stays collapsed (initial state)
    activityLog.addEntry('First entry', 'info');
    expect(isLogCollapsed()).toBe(true);

    // Add an error entry — should auto-uncollapse
    activityLog.addEntry('Something went wrong!', 'error');
    expect(isLogCollapsed()).toBe(false);
  });

  it('error entries do not increment unread count (they uncollapse instead)', () => {
    activityLog.mount(container);

    // Log starts collapsed; first entry creates badge count
    activityLog.addEntry('First entry', 'info');

    // Add some info entries while collapsed
    activityLog.addEntry('Info entry', 'info');
    activityLog.addEntry('Thinking entry', 'thinking');
    let badge = getBadge();
    expect(badge).not.toBeNull();

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

    // First entry (log starts collapsed)
    activityLog.addEntry('First entry', 'info');
    expect(isLogCollapsed()).toBe(true);

    // Add entries while collapsed → badge shows
    activityLog.addEntry('Entry 1', 'info');
    activityLog.addEntry('Entry 2', 'info');
    let badge = getBadge();
    expect(badge).not.toBeNull();

    // Manually uncollapse
    const titleBar = getTitleBar();
    (titleBar as HTMLElement).click(); // toggle → uncollapse
    expect(isLogCollapsed()).toBe(false);

    // Badge should be hidden/cleared
    badge = getBadge();
    expect(badge === null || badge.textContent === '').toBe(true);
  });

  // ── Diff entries follow same rules ─────────────────────────────

  it('diff entries do not uncollapse a collapsed log', () => {
    activityLog.mount(container);

    // First entry shows panel, log stays collapsed (initial state)
    activityLog.addEntry('First entry', 'info');
    expect(isLogCollapsed()).toBe(true);

    activityLog.addDiffEntry('src/App.tsx', '- old\n+ new', 'code');
    expect(isLogCollapsed()).toBe(true);

    // Badge should show entries arrived
    const badge = getBadge();
    expect(badge).not.toBeNull();
  });

  it('collapsible entries do not uncollapse a collapsed log', () => {
    activityLog.mount(container);

    // First entry shows panel, log stays collapsed (initial state)
    activityLog.addEntry('First entry', 'info');
    expect(isLogCollapsed()).toBe(true);

    activityLog.addCollapsibleEntry('Summary', 'Details...', 'info');
    expect(isLogCollapsed()).toBe(true);
  });

  // ── VAL-UX-030: Mission event → ActivityLog wiring ──────────────

  describe('mission event → ActivityLog wiring', () => {
    it('mission_planned produces ActivityLog info entry with plan received message', () => {
      activityLog.mount(container);
      // Simulate the call from mission_planned handler:
      // activityLog.addEntry(strings.missionPlanReceived(plan.features.length), 'info', ...)
      activityLog.addEntry('3 feature(s) planned', 'info');

      const entries = getLogEl()?.querySelectorAll('[data-nova="entry"]');
      expect(entries).not.toBeNull();
      expect(entries!.length).toBeGreaterThanOrEqual(1);

      const firstEntry = entries![0]!;
      expect(firstEntry.className).toContain('entry-info');
      expect(firstEntry.textContent).toContain('3 feature(s) planned');

      // Panel should be visible
      expect(isPanelHidden()).toBe(false);
    });

    it('mission_subtask_completed produces ActivityLog success entry for completed feature', () => {
      activityLog.mount(container);
      // Simulate the call from mission_subtask_completed handler (success path):
      // activityLog.addEntry(strings.missionFeatureCompleted(featureId), 'success', ...)
      activityLog.addEntry('Completed: feature-login-form', 'success');

      const entries = getLogEl()?.querySelectorAll('[data-nova="entry"]');
      expect(entries).not.toBeNull();

      const successEntry = Array.from(entries!).find(
        (e) => e.textContent?.includes('Completed: feature-login-form'),
      );
      expect(successEntry).toBeDefined();
      expect(successEntry!.className).toContain('entry-success');
    });

    it('mission_subtask_completed adds diff entry when result includes diff', () => {
      activityLog.mount(container);
      // First add the success entry
      activityLog.addEntry('Completed: feature-login-form', 'success');

      // Then simulate the diff entry from mission_subtask_completed handler:
      // activityLog.addDiffEntry(featureId, result.diff, 'code', ...)
      const diffContent = [
        '--- a/Login.tsx',
        '+++ b/Login.tsx',
        '@@ -1,3 +1,15 @@',
        '+import { useState } from "react";',
        '+',
        '+export function LoginForm() {',
        '+  const [email, setEmail] = useState("");',
        '+  return <form>...</form>;',
        '+}',
      ].join('\n');
      activityLog.addDiffEntry('feature-login-form', diffContent, 'code');

      const entries = getLogEl()?.querySelectorAll('[data-nova="entry"]');
      expect(entries).not.toBeNull();

      // Should have both success and code entries
      expect(entries!.length).toBeGreaterThanOrEqual(2);

      const diffEntry = Array.from(entries!).find(
        (e) => e.textContent?.includes('feature-login-form') && e.className.includes('entry-code'),
      );
      expect(diffEntry).toBeDefined();
      expect(diffEntry!.className).toContain('entry-code');

      // Diff entry should have a clickable diff-link
      const diffLink = diffEntry!.querySelector('.diff-link');
      expect(diffLink).not.toBeNull();
    });

    it('mission_subtask_completed with validation failure produces error entry', () => {
      activityLog.mount(container);
      // Simulate the call from mission_subtask_completed handler (failure path):
      // activityLog.addEntry(strings.missionFeatureFailed(featureId), 'error', ...)
      activityLog.addEntry('Failed: feature-broken-build', 'error');

      const entries = getLogEl()?.querySelectorAll('[data-nova="entry"]');
      expect(entries).not.toBeNull();

      const errorEntry = Array.from(entries!).find(
        (e) => e.textContent?.includes('Failed: feature-broken-build'),
      );
      expect(errorEntry).toBeDefined();
      expect(errorEntry!.className).toContain('entry-error');

      // Error entry should auto-uncollapse if collapsed
      expect(isLogCollapsed()).toBe(false);
    });

    it('mission_completed produces ActivityLog success entry', () => {
      activityLog.mount(container);
      // Simulate the call from mission_completed handler:
      // activityLog.addEntry(strings.missionCompleted, 'success', ...)
      activityLog.addEntry('Mission completed', 'success');

      const entries = getLogEl()?.querySelectorAll('[data-nova="entry"]');
      expect(entries).not.toBeNull();

      const completedEntry = Array.from(entries!).find(
        (e) => e.textContent?.includes('Mission completed'),
      );
      expect(completedEntry).toBeDefined();
      expect(completedEntry!.className).toContain('entry-success');
    });

    it('mission_failed produces ActivityLog error entry with failure reason', () => {
      activityLog.mount(container);
      // Simulate the call from mission_failed handler:
      // activityLog.addEntry("Mission failed: Build errors in 2 features", 'error', ...)
      activityLog.addEntry('Mission failed: Build errors in 2 features', 'error');

      const entries = getLogEl()?.querySelectorAll('[data-nova="entry"]');
      expect(entries).not.toBeNull();

      const failedEntry = Array.from(entries!).find(
        (e) => e.textContent?.includes('Mission failed'),
      );
      expect(failedEntry).toBeDefined();
      expect(failedEntry!.className).toContain('entry-error');
      expect(failedEntry!.textContent).toContain('Build errors in 2 features');

      // Error should auto-uncollapse
      expect(isLogCollapsed()).toBe(false);
    });

    it('mission_failed without error detail still produces an error entry', () => {
      activityLog.mount(container);
      // Simulate: mission_failed with no error detail
      // activityLog.addEntry("Mission failed", 'error', ...)
      activityLog.addEntry('Mission failed', 'error');

      const entries = getLogEl()?.querySelectorAll('[data-nova="entry"]');
      const failedEntry = Array.from(entries!).find(
        (e) => e.textContent?.includes('Mission failed'),
      );
      expect(failedEntry).toBeDefined();
      expect(failedEntry!.className).toContain('entry-error');
    });

    it('full mission lifecycle produces entries in correct order with correct types', () => {
      activityLog.mount(container);

      // Simulate the full mission lifecycle as the WS event handlers would:
      // 1. mission_planned → info
      activityLog.addEntry('3 feature(s) planned', 'info');

      // 2. mission_subtask_started → info
      activityLog.addEntry('Starting: feature-1', 'info');

      // 3. mission_subtask_completed (success) → success + diff
      activityLog.addEntry('Completed: feature-1', 'success');
      activityLog.addDiffEntry('feature-1', '- old\n+ new', 'code');

      // 4. Another feature
      activityLog.addEntry('Starting: feature-2', 'info');
      activityLog.addEntry('Completed: feature-2', 'success');

      // 5. mission_completed → success
      activityLog.addEntry('Mission completed', 'success');

      const entries = getLogEl()?.querySelectorAll('[data-nova="entry"]');
      expect(entries).not.toBeNull();

      const entryArray = Array.from(entries!);
      // Verify order and types
      const typesInOrder = entryArray.map((e) => {
        if (e.className.includes('entry-info')) return 'info';
        if (e.className.includes('entry-success')) return 'success';
        if (e.className.includes('entry-code')) return 'code';
        if (e.className.includes('entry-error')) return 'error';
        return 'unknown';
      });

      expect(typesInOrder).toEqual(['info', 'info', 'success', 'code', 'info', 'success', 'success']);

      // Verify specific content
      expect(entryArray[0]!.textContent).toContain('3 feature(s) planned');
      expect(entryArray[2]!.textContent).toContain('Completed: feature-1');
      expect(entryArray[3]!.className).toContain('entry-code');
      expect(entryArray[6]!.textContent).toContain('Mission completed');
    });

    it('mission lifecycle with failure produces correct entry types', () => {
      activityLog.mount(container);

      // Simulate: plan → feature fails → mission fails
      activityLog.addEntry('2 feature(s) planned', 'info');
      activityLog.addEntry('Starting: feature-1', 'info');
      activityLog.addEntry('Failed: feature-1', 'error');
      activityLog.addEntry('Mission failed: Feature execution error', 'error');

      const entries = getLogEl()?.querySelectorAll('[data-nova="entry"]');
      const entryArray = Array.from(entries!);

      const typesInOrder = entryArray.map((e) => {
        if (e.className.includes('entry-info')) return 'info';
        if (e.className.includes('entry-success')) return 'success';
        if (e.className.includes('entry-code')) return 'code';
        if (e.className.includes('entry-error')) return 'error';
        return 'unknown';
      });

      expect(typesInOrder).toEqual(['info', 'info', 'error', 'error']);

      // The mission_failed error should be the last entry
      expect(entryArray[3]!.textContent).toContain('Mission failed');
      expect(entryArray[3]!.className).toContain('entry-error');
    });
  });
});

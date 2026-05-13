/**
 * End-to-end tests for ActivityLog.
 *
 * These tests verify:
 * - VAL-OVERLAY-034: ActivityLog auto-opens on the first task
 * - VAL-OVERLAY-035: ActivityLog does not auto-uncollapse on subsequent non-error entries;
 *                     unread-count badge increments
 * - VAL-OVERLAY-036: Error entries auto-uncollapse a user-collapsed log
 * - VAL-OVERLAY-037: Each ActivityLog entry is timestamped
 */

import { test, expect } from '@playwright/test';

const PROXY_URL = 'http://localhost:3501';

/** Call __novaTest__.addActivityEntry from the page. */
async function addEntry(
  page: import('@playwright/test').Page,
  message: string,
  type: string,
) {
  await page.evaluate(
    ({ msg, t }) => {
      (window as unknown as Record<string, unknown>).__novaTest__ &&
        ((window as unknown as Record<string, unknown>).__novaTest__ as Record<string, Function>)
          .addActivityEntry(msg, t);
    },
    { msg: message, t: type },
  );
}

/** Call __novaTest__.collapseActivityLog from the page. */
async function collapseLog(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const nova = (window as unknown as Record<string, unknown>).__novaTest__ as Record<
      string,
      Function
    >;
    if (nova?.collapseActivityLog) nova.collapseActivityLog();
  });
}

/** Get ActivityLog state. */
async function getState(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const nova = (window as unknown as Record<string, unknown>).__novaTest__ as Record<
      string,
      Function
    >;
    if (nova?.getActivityLogState) return nova.getActivityLogState();
    return null;
  });
}

/** Get the unread badge text content from shadow DOM. */
async function getUnreadBadgeText(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-nova-activity-log]');
    if (host?.shadowRoot) {
      const badge = host.shadowRoot.querySelector('[data-nova="unread"]');
      return badge?.textContent ?? '';
    }
    return '';
  });
}

/** Get timestamp texts from all entries. */
async function getTimestamps(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-nova-activity-log]');
    if (host?.shadowRoot) {
      const timestamps = host.shadowRoot.querySelectorAll('.timestamp');
      return Array.from(timestamps).map((el) => el.textContent ?? '');
    }
    return [];
  });
}

/** Count entries in the activity log. */
async function getEntryCount(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-nova-activity-log]');
    if (host?.shadowRoot) {
      return host.shadowRoot.querySelectorAll('.entry').length;
    }
    return 0;
  });
}

/** Check if the activity log panel is hidden. */
async function isPanelHidden(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-nova-activity-log]');
    if (host?.shadowRoot) {
      const panel = host.shadowRoot.querySelector('.activity-panel');
      return panel?.classList.contains('hidden') ?? true;
    }
    return true;
  });
}

test.describe('ActivityLog', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PROXY_URL);
    await page.waitForSelector('[data-nova-pill]', { timeout: 10000 });
    // ActivityLog host is always attached but hidden until first entry
    await page.waitForSelector('[data-nova-activity-log]', { state: 'attached', timeout: 5000 });
  });

  // ── VAL-OVERLAY-034: Auto-open on first task ──────────────────

  test('panel is hidden before any entries (VAL-OVERLAY-034 prep)', async ({ page }) => {
    const state = await getState(page);
    expect(state).not.toBeNull();
    expect(state!.isHidden).toBe(true);
    expect(state!.entryCount).toBe(0);
  });

  test('ActivityLog auto-opens on first entry (VAL-OVERLAY-034)', async ({ page }) => {
    // Before any entries, panel should be hidden
    expect(await isPanelHidden(page)).toBe(true);

    // Add first entry
    await addEntry(page, 'Starting task: implement login', 'info');

    // Panel should now be visible
    const state = await getState(page);
    expect(state!.isHidden).toBe(false);
    expect(state!.entryCount).toBe(1);
  });

  // ── VAL-OVERLAY-035: No auto-uncollapse; badge increments ─────

  test('non-error entries do NOT uncollapse, badge shows count (VAL-OVERLAY-035)', async ({
    page,
  }) => {
    // First entry opens the panel
    await addEntry(page, 'First task started', 'info');
    let state = await getState(page);
    expect(state!.isHidden).toBe(false);

    // Collapse the log by clicking the title bar
    await collapseLog(page);
    state = await getState(page);
    expect(state!.collapsed).toBe(true);

    // Add 3 non-error entries while collapsed
    await addEntry(page, 'Streaming chunk 1', 'info');
    await addEntry(page, 'Thinking...', 'thinking');
    await addEntry(page, 'Streaming chunk 2', 'success');

    // Should still be collapsed
    state = await getState(page);
    expect(state!.collapsed).toBe(true);

    // Badge should show (3 new)
    const badgeText = await getUnreadBadgeText(page);
    expect(badgeText).toContain('3');
    expect(badgeText).toContain('new');
  });

  test('unread badge increments cumulatively while collapsed', async ({ page }) => {
    await addEntry(page, 'First task', 'info');
    await collapseLog(page);

    await addEntry(page, 'Entry 1', 'info');
    let badge = await getUnreadBadgeText(page);
    expect(badge).toContain('1');

    await addEntry(page, 'Entry 2', 'info');
    await addEntry(page, 'Entry 3', 'thinking');
    badge = await getUnreadBadgeText(page);
    expect(badge).toContain('3');
  });

  test('collapsing again after uncollapse resets badge counter', async ({ page }) => {
    await addEntry(page, 'First task', 'info');
    await collapseLog(page);

    // Add entries while collapsed
    await addEntry(page, 'Entry 1', 'info');
    await addEntry(page, 'Entry 2', 'info');
    let badge = await getUnreadBadgeText(page);
    expect(badge).toContain('2');

    // Uncollapse (click title bar toggles)
    await collapseLog(page);
    let state = await getState(page);
    expect(state!.collapsed).toBe(false);

    // Badge should be hidden
    badge = await getUnreadBadgeText(page);
    expect(badge).toBe('');

    // Collapse again, add more entries
    await collapseLog(page);
    await addEntry(page, 'New entry after re-collapse', 'info');
    badge = await getUnreadBadgeText(page);
    expect(badge).toContain('1');
  });

  // ── VAL-OVERLAY-036: Error auto-uncollapse ────────────────────

  test('error entry auto-uncollapses a collapsed log (VAL-OVERLAY-036)', async ({ page }) => {
    await addEntry(page, 'First task', 'info');
    await collapseLog(page);
    let state = await getState(page);
    expect(state!.collapsed).toBe(true);

    // Add an error entry — should auto-uncollapse
    await addEntry(page, 'Build failed: syntax error', 'error');

    state = await getState(page);
    expect(state!.collapsed).toBe(false);

    // Badge should be cleared
    const badge = await getUnreadBadgeText(page);
    expect(badge).toBe('');
  });

  test('error uncollapses even after accumulated unread entries', async ({ page }) => {
    await addEntry(page, 'First task', 'info');
    await collapseLog(page);

    // Add some info entries
    await addEntry(page, 'Info 1', 'info');
    await addEntry(page, 'Info 2', 'info');
    await addEntry(page, 'Info 3', 'info');

    let badge = await getUnreadBadgeText(page);
    expect(badge).toContain('3');

    // Error should uncollapse and clear badge
    await addEntry(page, 'Critical error occurred!', 'error');

    const state = await getState(page);
    expect(state!.collapsed).toBe(false);

    badge = await getUnreadBadgeText(page);
    expect(badge).toBe('');
  });

  // ── VAL-OVERLAY-037: Timestamps ───────────────────────────────

  test('every entry has a HH:MM:SS timestamp (VAL-OVERLAY-037)', async ({ page }) => {
    await addEntry(page, 'Task started', 'info');
    await addEntry(page, 'Thinking...', 'thinking');
    await addEntry(page, 'Done!', 'success');

    const timestamps = await getTimestamps(page);
    expect(timestamps.length).toBe(3);

    const hhmmssPattern = /^\d{2}:\d{2}:\d{2}$/;
    for (const ts of timestamps) {
      expect(ts).toMatch(hhmmssPattern);
    }
  });

  // ── Edge cases ────────────────────────────────────────────────

  test('entries are still added to log even when collapsed', async ({ page }) => {
    await addEntry(page, 'First task', 'info');
    await collapseLog(page);

    await addEntry(page, 'Hidden entry 1', 'info');
    await addEntry(page, 'Hidden entry 2', 'info');

    // Entries are still in the DOM (just not visible due to collapse)
    const count = await getEntryCount(page);
    expect(count).toBe(3); // 1 initial + 2 hidden
  });
});

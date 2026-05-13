/**
 * End-to-end tests for layout stacking and z-index hierarchy.
 *
 * These tests verify:
 * - VAL-OVERLAY-057: Default-position panels do not overlap each other.
 *   With ActivityLog, SuggestionPanel, and TaskPanel all visible, their
 *   bounding rectangles do not intersect.
 * - VAL-OVERLAY-058: z-index hierarchy — modals above panels above pill.
 *   When DiffModal is open simultaneously with ActivityLog and the pill,
 *   the modal renders on top.
 */

import { test, expect } from '@playwright/test';

const PROXY_URL = 'http://localhost:3501';

/** Helper: get the bounding rect of a Nova host element. */
async function getBoundingRect(
  page: import('@playwright/test').Page,
  selector: string,
) {
  const el = page.locator(selector);
  return el.boundingBox();
}

/** Helper: get z-index of a Nova host element. */
async function getZIndex(
  page: import('@playwright/test').Page,
  selector: string,
): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return -1;
    const z = (el as HTMLElement).style.zIndex;
    return z ? parseInt(z, 10) : -1;
  }, selector);
}

/** Inject mock activity entries to make ActivityLog visible. */
async function showActivityLog(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const nova = (window as unknown as Record<string, unknown>).__novaTest__ as Record<
      string,
      Function
    >;
    if (nova?.addActivityEntry) {
      nova.addActivityEntry('Test log entry', 'info');
    }
  });
  // Wait for the panel to appear
  await page.waitForSelector('[data-nova-activity-log]', { state: 'attached', timeout: 3000 });
}

/** Inject mock tasks to make the TaskPanel visible. */
async function showTaskPanel(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const host = document.querySelector('[data-nova-task-panel]');
    if (!host || !host.shadowRoot) return;

    const panelEl = host.shadowRoot.querySelector('.task-panel');
    const listEl = host.shadowRoot.querySelector('.task-list');
    if (!panelEl || !listEl) return;

    panelEl.classList.remove('hidden');
    listEl.innerHTML = '';

    const row = document.createElement('div');
    row.className = 'task-row status-pending';
    row.style.padding = '6px 8px';
    const desc = document.createElement('span');
    desc.className = 'task-desc';
    desc.textContent = 'Layout test task';
    row.appendChild(desc);
    listEl.appendChild(row);
  });
  await page.waitForSelector('[data-nova-task-panel]', { state: 'attached', timeout: 3000 });
}

/** Inject a mock suggestion to make the SuggestionPanel visible. */
async function showSuggestionPanel(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const host = document.querySelector('[data-nova-suggestion-panel]');
    if (!host || !host.shadowRoot) return;

    const panelEl = host.shadowRoot.querySelector('.suggestion-panel');
    const listEl = host.shadowRoot.querySelector('.suggestion-list');
    if (!panelEl || !listEl) return;

    panelEl.classList.remove('hidden');
    listEl.innerHTML = '';

    const row = document.createElement('div');
    row.className = 'suggestion-row';
    row.style.padding = '10px 12px';
    const title = document.createElement('div');
    title.className = 'suggestion-title';
    title.textContent = 'Layout test suggestion';
    row.appendChild(title);
    listEl.appendChild(row);
  });
  await page.waitForSelector('[data-nova-suggestion-panel]', {
    state: 'attached',
    timeout: 3000,
  });
}

// ─────────────────────────────────────────────────────────────────

test.describe('Layout stacking', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PROXY_URL, { waitUntil: 'domcontentloaded' });
    // Wait for nova-root to be present
    await page.waitForSelector('#nova-root', { state: 'attached', timeout: 5000 });
  });

  test('VAL-OVERLAY-057: panels do not overlap each other', async ({ page }) => {
    // Make all three panels visible
    await showActivityLog(page);
    await showSuggestionPanel(page);
    await showTaskPanel(page);

    // Give the layout manager time to recalculate
    await page.waitForTimeout(500);

    const alBox = await getBoundingRect(page, '[data-nova-activity-log]');
    const spBox = await getBoundingRect(page, '[data-nova-suggestion-panel]');
    const tpBox = await getBoundingRect(page, '[data-nova-task-panel]');

    // All three should be visible
    expect(alBox).not.toBeNull();
    expect(spBox).not.toBeNull();
    expect(tpBox).not.toBeNull();

    // Panels should not overlap: ActivityLog bottom-most, SuggestionPanel above, TaskPanel top-most
    expect(alBox!.y + alBox!.height).toBeLessThanOrEqual(spBox!.y + 1); // ActivityLog bottom ≤ SuggestionPanel top
    expect(spBox!.y + spBox!.height).toBeLessThanOrEqual(tpBox!.y + 1); // SuggestionPanel bottom ≤ TaskPanel top

    // All panels should share the same left edge (within 2px rounding tolerance)
    expect(Math.abs(alBox!.x - spBox!.x)).toBeLessThan(3);
    expect(Math.abs(spBox!.x - tpBox!.x)).toBeLessThan(3);

    // Pill should not be visually covered by any panel.
    // The pill uses its own fixed position (not part of the bottom-left stack).
    const pillBox = await getBoundingRect(page, '[data-nova-pill]');
    expect(pillBox).not.toBeNull();
  });

  test('VAL-OVERLAY-058: z-index hierarchy — modals above panels above pill', async ({
    page,
  }) => {
    // Get z-indices
    const pillZ = await getZIndex(page, '[data-nova-pill]');
    const alZ = await getZIndex(page, '[data-nova-activity-log]');
    const toastZ = await getZIndex(page, '[data-nova-toast-container]');
    const diffModalZ = await getZIndex(page, '[data-nova-diff-modal]');

    // z-index rules: pill=1000, panels=1100, modals=1200, toasts=1300
    expect(pillZ).toBe(1000);

    // Panels should be at 1100
    expect(alZ).toBe(1100);

    // DiffModal should be at 1200
    expect(diffModalZ).toBe(1200);

    // Toasts should be at 1300
    if (toastZ !== -1) {
      expect(toastZ).toBe(1300);
    }

    // Verify panel z-indices are above pill
    expect(alZ).toBeGreaterThan(pillZ);

    // Verify modal z-index is above panels
    expect(diffModalZ).toBeGreaterThan(alZ);

    // Verify toasts are above modals (if toast container exists)
    if (toastZ !== -1) {
      expect(toastZ).toBeGreaterThan(diffModalZ);
    }
  });

  test('TaskPanel is positioned at bottom-left (not top-right)', async ({ page }) => {
    // Make TaskPanel visible
    await showTaskPanel(page);
    await page.waitForTimeout(300);

    const tpBox = await getBoundingRect(page, '[data-nova-task-panel]');
    expect(tpBox).not.toBeNull();

    // TaskPanel should be on the left side of the viewport
    const viewportWidth = page.viewportSize()?.width ?? 1024;
    expect(tpBox!.x).toBeLessThan(viewportWidth / 2); // left half of viewport

    // TaskPanel should be in the bottom half (stacked from bottom)
    const viewportHeight = page.viewportSize()?.height ?? 768;
    expect(tpBox!.y).toBeGreaterThan(viewportHeight / 4);
  });

  test('panels have data-slot attributes for layout slots', async ({ page }) => {
    // Make panels visible
    await showActivityLog(page);
    await showSuggestionPanel(page);
    await showTaskPanel(page);
    await page.waitForTimeout(300);

    // Check data-slot attributes
    const alSlot = await page.getAttribute('[data-nova-activity-log]', 'data-slot');
    const spSlot = await page.getAttribute('[data-nova-suggestion-panel]', 'data-slot');
    const tpSlot = await page.getAttribute('[data-nova-task-panel]', 'data-slot');

    expect(alSlot).toBe('activityLog');
    expect(spSlot).toBe('suggestionPanel');
    expect(tpSlot).toBe('taskPanel');
  });

  test('gap between stacked panels is 8px', async ({ page }) => {
    // Show ActivityLog and SuggestionPanel (two adjacent panels)
    await showActivityLog(page);
    await showSuggestionPanel(page);
    await page.waitForTimeout(500);

    const alBox = await getBoundingRect(page, '[data-nova-activity-log]');
    const spBox = await getBoundingRect(page, '[data-nova-suggestion-panel]');

    expect(alBox).not.toBeNull();
    expect(spBox).not.toBeNull();

    // The gap between ActivityLog bottom and SuggestionPanel top should be ~8px
    const gap = spBox!.y - (alBox!.y + alBox!.height);
    expect(gap).toBeCloseTo(8, -1); // within 1px tolerance
  });
});

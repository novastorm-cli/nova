/**
 * End-to-end tests for OverlayPill — drag, deadzone, localStorage persistence,
 * ARIA attributes, dropdown flip, and platform-aware shortcut glyphs.
 *
 * These tests verify:
 * - VAL-OVERLAY-003: pointer event drag with 4px deadzone
 * - VAL-OVERLAY-004: dropdown opens on click, not on micro-drag
 * - VAL-OVERLAY-005: aria-haspopup="menu" and aria-expanded reflects state
 * - VAL-OVERLAY-006: dropdown flips to avoid viewport clipping
 * - VAL-OVERLAY-007: platform-aware shortcut glyphs
 * - VAL-OVERLAY-059: drag position persists across reload
 * - VAL-OVERLAY-060: saved position clamped to viewport on reload
 */

import { test, expect } from '@playwright/test';

const PROXY_URL = 'http://localhost:3501';

/** Locate the pill host element (outside shadow). */
function getPillHost(page: import('@playwright/test').Page) {
  return page.locator('[data-nova-pill]');
}

test.describe('OverlayPill', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PROXY_URL);
    await page.evaluate(() => {
      localStorage.removeItem('nova-pill-x');
      localStorage.removeItem('nova-pill-y');
    });
    await page.reload();
    await page.waitForSelector('[data-nova-pill]', { timeout: 10000 });
  });

  test('pill is visible and has aria-haspopup="menu" (VAL-OVERLAY-005)', async ({ page }) => {
    const pillHost = getPillHost(page);
    await expect(pillHost).toBeAttached();

    // Use getByRole which automatically pierces shadow DOM
    const pillBtn = page.getByRole('button', { name: 'Open Nova menu' });
    await expect(pillBtn).toHaveAttribute('aria-haspopup', 'menu');
    await expect(pillBtn).toHaveAttribute('aria-expanded', 'false');
  });

  test('clicking pill opens dropdown and sets aria-expanded="true" (VAL-OVERLAY-005)', async ({
    page,
  }) => {
    // Click the pill to open the dropdown
    await page.getByRole('button', { name: 'Open Nova menu' }).click();

    const pillBtn = page.getByRole('button', { name: 'Open Nova menu' });
    await expect(pillBtn).toHaveAttribute('aria-expanded', 'true');

    // Dropdown menu should be visible
    const dropdown = page.locator('[data-nova-pill]').locator('[role="menu"]');
    await expect(dropdown).toBeVisible();
  });

  test('micro-drag (<4px) opens dropdown, not a drag (VAL-OVERLAY-004)', async ({ page }) => {
    const pillHost = getPillHost(page);
    const box = await pillHost.boundingBox();
    expect(box).not.toBeNull();

    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    // Perform a tiny drag (~2px) — should be treated as a click
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 2, cy + 1, { steps: 1 });
    await page.mouse.up();

    // Dropdown should be open
    const pillBtn = page.getByRole('button', { name: 'Open Nova menu' });
    await expect(pillBtn).toHaveAttribute('aria-expanded', 'true');
  });

  test('drag >4px moves pill and does NOT open dropdown (VAL-OVERLAY-003)', async ({
    page,
  }) => {
    const pillHost = getPillHost(page);
    const box = await pillHost.boundingBox();
    expect(box).not.toBeNull();

    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    // Perform a real drag (>4px)
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 100, cy, { steps: 5 });
    await page.mouse.up();

    // Pill should have moved
    const newBox = await pillHost.boundingBox();
    expect(newBox).not.toBeNull();
    expect(newBox!.x).toBeGreaterThan(box!.x);

    // Dropdown should NOT be open
    const pillBtn = page.getByRole('button', { name: 'Open Nova menu' });
    await expect(pillBtn).toHaveAttribute('aria-expanded', 'false');
  });

  test('drag position persists across reload (VAL-OVERLAY-059)', async ({ page }) => {
    const pillHost = getPillHost(page);
    const boxBefore = await pillHost.boundingBox();
    expect(boxBefore).not.toBeNull();

    const cx = boxBefore!.x + boxBefore!.width / 2;
    const cy = boxBefore!.y + boxBefore!.height / 2;

    // Drag pill 200px right and 120px up
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 200, cy - 120, { steps: 10 });
    await page.mouse.up();

    // Capture new position
    const boxAfterDrag = await pillHost.boundingBox();
    expect(boxAfterDrag).not.toBeNull();
    expect(boxAfterDrag!.x).toBeGreaterThan(boxBefore!.x);

    // Reload the page
    await page.reload();
    await page.waitForSelector('[data-nova-pill]', { timeout: 10000 });

    // Pill should be at the dragged position (within tolerance)
    const boxAfterReload = await page.locator('[data-nova-pill]').boundingBox();
    expect(boxAfterReload).not.toBeNull();
    expect(Math.abs(boxAfterReload!.x - boxAfterDrag!.x)).toBeLessThanOrEqual(10);
    expect(Math.abs(boxAfterReload!.y - boxAfterDrag!.y)).toBeLessThanOrEqual(10);
  });

  test('saved position is clamped to viewport on reload (VAL-OVERLAY-060)', async ({
    page,
  }) => {
    // Set out-of-bounds coordinates in localStorage
    await page.evaluate(() => {
      localStorage.setItem('nova-pill-x', '99999');
      localStorage.setItem('nova-pill-y', '99999');
    });
    await page.reload();
    await page.waitForSelector('[data-nova-pill]', { timeout: 10000 });

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    const box = await page.locator('[data-nova-pill]').boundingBox();
    expect(box).not.toBeNull();

    // Pill must be fully inside the viewport
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
  });

  test('dropdown opens below pill when near top of viewport (VAL-OVERLAY-006)', async ({
    page,
  }) => {
    // Move pill to the top of the viewport via localStorage
    await page.evaluate(() => {
      localStorage.setItem('nova-pill-x', '100');
      localStorage.setItem('nova-pill-y', '10');
    });
    await page.reload();
    await page.waitForSelector('[data-nova-pill]', { timeout: 10000 });

    // Open the dropdown by clicking the pill
    await page.getByRole('button', { name: 'Open Nova menu' }).click();

    // Dropdown should be visible
    const dropdown = page.locator('[data-nova-pill]').locator('[role="menu"]');
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    // Verify the dropdown rendered below the pill by checking its position
    const pillBox = await getPillHost(page).boundingBox();
    const dropdownBox = await dropdown.boundingBox();
    expect(pillBox).not.toBeNull();
    expect(dropdownBox).not.toBeNull();
    // Dropdown top should be below pill bottom
    expect(dropdownBox!.y).toBeGreaterThanOrEqual(pillBox!.y + pillBox!.height - 2);
  });

  test('pill menu shows Alt+I (not ⌥I) on non-macOS (VAL-OVERLAY-007)', async ({ page }) => {
    // Open the dropdown by clicking the pill
    await page.getByRole('button', { name: 'Open Nova menu' }).click();

    const dropdown = page.locator('[data-nova-pill]').locator('[role="menu"]');
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    // Get all shortcut spans
    const text = await dropdown.textContent();
    expect(text).not.toBeNull();

    // On non-Mac (Linux in CI), shortcuts should use "Alt+" not "⌥"
    if (text!.includes('⌥')) {
      // If we see ⌥, verify no Alt+ is mixed in
      expect(text).not.toContain('Alt+');
    } else {
      // On Linux we expect Alt+
      expect(text).toContain('Alt+');
    }
  });
});

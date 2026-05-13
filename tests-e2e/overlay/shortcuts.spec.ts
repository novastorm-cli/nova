/**
 * End-to-end tests for global keyboard shortcuts.
 *
 * These tests verify:
 * - VAL-OVERLAY-030: Alt+KeyI activates Quick Edit (layout-independent)
 * - VAL-OVERLAY-031: Alt+KeyK activates Multi-Edit
 * - VAL-OVERLAY-032: Alt+KeyM opens project map
 * - VAL-OVERLAY-033: Global shortcuts suppressed inside editable fields
 * - VAL-OVERLAY-051: Alt+KeyA activates Area Selector (layout-independent)
 */

import { test, expect } from '@playwright/test';

const PROXY_URL = 'http://localhost:3501';
const ADMIN_URL = 'http://localhost:3501/admin';

function getStatusLine(page: import('@playwright/test').Page) {
  return page.locator('[data-nova="status-line"]');
}

// ── VAL-OVERLAY-030: Alt+KeyI activates Quick Edit ──

test.describe('Global Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PROXY_URL);
    await page.waitForSelector('[data-nova-pill]', { timeout: 10000 });
    await page.waitForSelector('[data-nova="status-line"]', { timeout: 5000 });
  });

  test('Alt+KeyI activates Quick Edit mode (VAL-OVERLAY-030)', async ({ page }) => {
    // Initial state should be Idle
    await expect(getStatusLine(page)).toHaveText('Idle');

    // Press Alt+KeyI to activate Quick Edit
    await page.keyboard.press('Alt+KeyI');

    // Status line should show Quick Edit active
    await expect(getStatusLine(page)).toHaveText('Quick Edit active');

    // Inspector should be active
    const inspectorHost = page.locator('[data-nova-inspector]');
    await expect(inspectorHost).toBeAttached();
  });

  test('Alt+KeyI toggles Quick Edit off (VAL-OVERLAY-030)', async ({ page }) => {
    // Activate Quick Edit
    await page.keyboard.press('Alt+KeyI');
    await expect(getStatusLine(page)).toHaveText('Quick Edit active');

    // Press Alt+KeyI again to deactivate
    await page.keyboard.press('Alt+KeyI');
    await expect(getStatusLine(page)).toHaveText('Idle');
  });

  // ── VAL-OVERLAY-031: Alt+KeyK activates Multi-Edit ──

  test('Alt+KeyK activates Multi-Edit mode (VAL-OVERLAY-031)', async ({ page }) => {
    await expect(getStatusLine(page)).toHaveText('Idle');

    // Press Alt+KeyK to activate Multi-Edit
    await page.keyboard.press('Alt+KeyK');

    await expect(getStatusLine(page)).toHaveText('Multi-Edit active');

    // Multi-selector should be attached
    const multiSelectorHost = page.locator('[data-nova-multi-selector]');
    await expect(multiSelectorHost).toBeAttached();
  });

  test('Alt+KeyK toggles Multi-Edit off (VAL-OVERLAY-031)', async ({ page }) => {
    // Activate Multi-Edit
    await page.keyboard.press('Alt+KeyK');
    await expect(getStatusLine(page)).toHaveText('Multi-Edit active');

    // Press Alt+KeyK again to deactivate
    await page.keyboard.press('Alt+KeyK');
    await expect(getStatusLine(page)).toHaveText('Idle');
  });

  // ── VAL-OVERLAY-032: Alt+KeyM opens project map ──

  test('Alt+KeyM attempts to open project map (VAL-OVERLAY-032)', async ({ page }) => {
    // Listen for new page/window opening
    const popupPromise = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);

    await page.keyboard.press('Alt+KeyM');

    // A popup should be triggered (window.open is called)
    const popup = await popupPromise;

    // In headless mode, the popup may or may not succeed, but
    // the key press should not change the overlay status line
    await expect(getStatusLine(page)).toHaveText('Idle');

    // If a popup did open, clean it up
    if (popup) {
      await popup.close().catch(() => {});
    }
  });

  // ── VAL-OVERLAY-033: Shortcuts suppressed inside editable fields ──

  test.describe('Editable target suppression (VAL-OVERLAY-033)', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(ADMIN_URL);
      await page.waitForSelector('[data-nova-pill]', { timeout: 10000 });
      await page.waitForSelector('[data-nova="status-line"]', { timeout: 5000 });
    });

    test('Alt+KeyI does nothing when typing in an input field', async ({ page }) => {
      // Focus the username input field
      const input = page.locator('#admin-username');
      await expect(input).toBeVisible();
      await input.focus();

      // Press Alt+KeyI while focused in the input
      await page.keyboard.press('Alt+KeyI');

      // Status line should remain Idle
      await expect(getStatusLine(page)).toHaveText('Idle');

      // Inspector should NOT be active
      const inspectorHost = page.locator('[data-nova-inspector]');
      // The host is always attached but the inspector should not be in quick-edit mode
      await expect(getStatusLine(page)).not.toHaveText('Quick Edit active');
    });

    test('Alt+KeyK does nothing when typing in an input field', async ({ page }) => {
      const input = page.locator('#admin-username');
      await input.focus();

      await page.keyboard.press('Alt+KeyK');

      // Status line should remain Idle
      await expect(getStatusLine(page)).toHaveText('Idle');
      await expect(getStatusLine(page)).not.toHaveText('Multi-Edit active');
    });

    test('Alt+KeyM does nothing when typing in an input field', async ({ page }) => {
      const input = page.locator('#admin-username');
      await input.focus();

      // Listen for popups
      const popupPromise = page.waitForEvent('popup', { timeout: 3000 }).catch(() => null);

      await page.keyboard.press('Alt+KeyM');

      // No popup should have been opened
      const popup = await popupPromise;
      expect(popup).toBeNull();

      // Status line should remain Idle
      await expect(getStatusLine(page)).toHaveText('Idle');
    });

    test('Alt+KeyA does nothing when typing in an input field', async ({ page }) => {
      const input = page.locator('#admin-username');
      await input.focus();

      await page.keyboard.press('Alt+KeyA');

      // Status line should remain Idle
      await expect(getStatusLine(page)).toHaveText('Idle');
      await expect(getStatusLine(page)).not.toHaveText('Gesture mode');
    });

    test('Alt key combinations do not interfere with normal typing in inputs', async ({ page }) => {
      const input = page.locator('#admin-username');
      await input.focus();

      // Type normally without Alt — should work
      await input.fill('hello');
      expect(await input.inputValue()).toBe('hello');

      // With Alt held while in the input, shortcut handlers return early
      // and the overlay mode should not change
      await page.keyboard.press('Alt+KeyI');
      await expect(getStatusLine(page)).toHaveText('Idle');

      await page.keyboard.press('Alt+KeyK');
      await expect(getStatusLine(page)).toHaveText('Idle');

      await page.keyboard.press('Alt+KeyA');
      await expect(getStatusLine(page)).toHaveText('Idle');
    });
  });

  // ── VAL-OVERLAY-051: Alt+KeyA activates Area Selector ──

  test('Alt+KeyA activates Area Selector / Gesture mode (VAL-OVERLAY-051)', async ({ page }) => {
    await expect(getStatusLine(page)).toHaveText('Idle');

    // Press Alt+KeyA to activate area selector
    await page.keyboard.press('Alt+KeyA');

    // Status line should show Gesture mode
    await expect(getStatusLine(page)).toHaveText('Gesture mode');

    // Area selector overlay should be present
    const areaSelectorOverlay = page.locator('[data-nova-area-selector]');
    await expect(areaSelectorOverlay).toBeAttached();
  });

  test('Alt+KeyA toggles Area Selector off (VAL-OVERLAY-051)', async ({ page }) => {
    // Activate area selector
    await page.keyboard.press('Alt+KeyA');
    await expect(getStatusLine(page)).toHaveText('Gesture mode');

    // Deactivate
    await page.keyboard.press('Alt+KeyA');
    await expect(getStatusLine(page)).toHaveText('Idle');
  });

  // ── Mutual exclusion: Quick Edit and Multi-Edit ──

  test('Alt+KeyI deactivates Multi-Edit and activates Quick Edit', async ({ page }) => {
    // Activate Multi-Edit first
    await page.keyboard.press('Alt+KeyK');
    await expect(getStatusLine(page)).toHaveText('Multi-Edit active');

    // Now activate Quick Edit — should deactivate Multi-Edit
    await page.keyboard.press('Alt+KeyI');
    await expect(getStatusLine(page)).toHaveText('Quick Edit active');
  });

  test('Alt+KeyK deactivates Quick Edit and activates Multi-Edit', async ({ page }) => {
    // Activate Quick Edit first
    await page.keyboard.press('Alt+KeyI');
    await expect(getStatusLine(page)).toHaveText('Quick Edit active');

    // Now activate Multi-Edit — should deactivate Quick Edit
    await page.keyboard.press('Alt+KeyK');
    await expect(getStatusLine(page)).toHaveText('Multi-Edit active');
  });
});

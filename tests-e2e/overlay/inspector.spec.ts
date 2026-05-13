/**
 * End-to-end tests for ElementInspector — highlight visibility, backdrop
 * click interception, and Escape deactivation.
 *
 * These tests verify:
 * - VAL-OVERLAY-048: Inspector highlight visible on any host background
 * - VAL-OVERLAY-049: Inspector popup clicks do not activate host elements
 * - VAL-OVERLAY-050: Escape exits selection mode
 */

import { test, expect } from '@playwright/test';

const PROXY_URL = 'http://localhost:3501';

function getStatusLine(page: import('@playwright/test').Page) {
  return page.locator('[data-nova="status-line"]');
}

test.describe('ElementInspector', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PROXY_URL);
    // Wait for the overlay to fully initialize
    await page.waitForSelector('[data-nova-pill]', { timeout: 10000 });
    await page.waitForSelector('[data-nova="status-line"]', { timeout: 5000 });
    // Ensure we start in Idle state
    await expect(getStatusLine(page)).toHaveText('Idle');
  });

  // ── VAL-OVERLAY-048: Inspector highlight visibility ──

  test('highlight becomes visible when hovering a host element in Quick Edit mode (VAL-OVERLAY-048)', async ({
    page,
  }) => {
    // Activate Quick Edit via Alt+KeyI
    await page.keyboard.press('Alt+KeyI');
    await expect(getStatusLine(page)).toHaveText('Quick Edit active');

    // The inspector host should be present and active
    const inspectorHost = page.locator('[data-nova-inspector]');
    await expect(inspectorHost).toBeAttached();
    await expect(inspectorHost).toHaveAttribute('data-active', 'true');

    // Find the #add-csv-export button and get its bounding box
    const button = page.locator('#add-csv-export');
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();

    // Move mouse to the center of the button — highlight should appear
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);

    // The highlight element should exist inside the inspector's shadow DOM
    const highlightVisible = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-inspector]');
      if (!host || !host.shadowRoot) return false;
      const hl = host.shadowRoot.querySelector('.inspector-highlight') as HTMLElement | null;
      return hl !== null && hl.style.display === 'block' && hl.hasAttribute('data-visible');
    });
    expect(highlightVisible).toBe(true);

    // The highlight label should show the element tag
    const highlightLabel = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-inspector]');
      if (!host || !host.shadowRoot) return '';
      const label = host.shadowRoot.querySelector(
        '.inspector-highlight-label',
      ) as HTMLElement | null;
      return label?.textContent ?? '';
    });
    expect(highlightLabel).toContain('button');
    expect(highlightLabel).toContain('add-csv-export');
  });

  test('highlight is visible on white and dark host backgrounds', async ({
    page,
  }) => {
    // Activate Quick Edit
    await page.keyboard.press('Alt+KeyI');
    await expect(getStatusLine(page)).toHaveText('Quick Edit active');

    // Test on white background
    await page.evaluate(() => {
      document.body.style.backgroundColor = '#ffffff';
    });
    await page.waitForTimeout(200);

    const button = page.locator('#add-csv-export');
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.waitForTimeout(100);

    const highlightOnWhite = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-inspector]');
      if (!host || !host.shadowRoot) return false;
      const hl = host.shadowRoot.querySelector('.inspector-highlight') as HTMLElement | null;
      return hl !== null && hl.style.display === 'block';
    });
    expect(highlightOnWhite).toBe(true);

    // Test on dark background
    await page.evaluate(() => {
      document.body.style.backgroundColor = '#000000';
    });
    await page.waitForTimeout(200);
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.waitForTimeout(100);

    const highlightOnDark = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-inspector]');
      if (!host || !host.shadowRoot) return false;
      const hl = host.shadowRoot.querySelector('.inspector-highlight') as HTMLElement | null;
      return hl !== null && hl.style.display === 'block';
    });
    expect(highlightOnDark).toBe(true);

    // Test on mid-gray background
    await page.evaluate(() => {
      document.body.style.backgroundColor = '#888888';
    });
    await page.waitForTimeout(200);
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.waitForTimeout(100);

    const highlightOnGray = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-inspector]');
      if (!host || !host.shadowRoot) return false;
      const hl = host.shadowRoot.querySelector('.inspector-highlight') as HTMLElement | null;
      return hl !== null && hl.style.display === 'block';
    });
    expect(highlightOnGray).toBe(true);
  });

  test('highlight label changes when moving to a different element', async ({ page }) => {
    // Activate Quick Edit
    await page.keyboard.press('Alt+KeyI');
    await expect(getStatusLine(page)).toHaveText('Quick Edit active');

    const button = page.locator('#add-csv-export');
    const box = await button.boundingBox();
    expect(box).not.toBeNull();

    // Hover over the button — highlight should appear with button label
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.waitForTimeout(200);

    const buttonLabel = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-inspector]');
      if (!host || !host.shadowRoot) return '';
      const label = host.shadowRoot.querySelector(
        '.inspector-highlight-label',
      ) as HTMLElement | null;
      return label?.textContent ?? '';
    });
    expect(buttonLabel).toContain('button');

    // Move mouse to the heading element at the top of the page
    const heading = page.locator('h1').first();
    if ((await heading.count()) > 0) {
      const hBox = await heading.boundingBox();
      if (hBox) {
        await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2);
        await page.waitForTimeout(200);

        // Highlight label should have changed to reflect the new element
        const headingLabel = await page.evaluate(() => {
          const host = document.querySelector('[data-nova-inspector]');
          if (!host || !host.shadowRoot) return '';
          const label = host.shadowRoot.querySelector(
            '.inspector-highlight-label',
          ) as HTMLElement | null;
          return label?.textContent ?? '';
        });
        // Label should now show the h1 tag (different from button)
        expect(headingLabel).toContain('h1');
        expect(headingLabel).not.toBe(buttonLabel);
      }
    }
  });

  // ── VAL-OVERLAY-049: Backdrop click interception ──

  test('clicking a host element during inspector mode intercepts the click (VAL-OVERLAY-049)', async ({
    page,
  }) => {
    // Add a click counter to the host button so we can verify it does NOT fire
    await page.evaluate(() => {
      const btn = document.querySelector('#add-csv-export') as HTMLElement & {
        _clicked: number;
      };
      if (btn) {
        btn._clicked = 0;
        btn.addEventListener('click', () => {
          btn._clicked = (btn._clicked ?? 0) + 1;
        });
      }
    });

    // Activate Quick Edit
    await page.keyboard.press('Alt+KeyI');
    await expect(getStatusLine(page)).toHaveText('Quick Edit active');

    // Click on the host button
    const button = page.locator('#add-csv-export');
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    // The host button should NOT have received the click
    const clickCount = await page.evaluate(() => {
      const btn = document.querySelector('#add-csv-export') as HTMLElement & {
        _clicked: number;
      };
      return btn?._clicked ?? -1;
    });
    expect(clickCount).toBe(0);

    // The inspector popup should have appeared instead
    const popupVisible = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-inspector]');
      if (!host || !host.shadowRoot) return false;
      const popup = host.shadowRoot.querySelector('.inspector-popup') as HTMLElement | null;
      return popup !== null && popup.style.display === 'flex';
    });
    expect(popupVisible).toBe(true);
  });

  test('inspector popup shows element label and has dialog ARIA attributes', async ({
    page,
  }) => {
    // Activate Quick Edit
    await page.keyboard.press('Alt+KeyI');
    await expect(getStatusLine(page)).toHaveText('Quick Edit active');

    // Click on the host button to open the popup
    const button = page.locator('#add-csv-export');
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    // Verify the popup has dialog ARIA attributes
    const popupAttrs = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-inspector]');
      if (!host || !host.shadowRoot) return null;
      const popup = host.shadowRoot.querySelector('.inspector-popup') as HTMLElement | null;
      if (!popup) return null;
      return {
        role: popup.getAttribute('role'),
        ariaModal: popup.getAttribute('aria-modal'),
        ariaLabelledby: popup.getAttribute('aria-labelledby'),
        hasHeader: !!popup.querySelector('.popup-header'),
        hasInput: !!popup.querySelector('.popup-input'),
        hasCloseBtn: !!popup.querySelector('.popup-close-btn'),
        isVisible: popup.style.display === 'flex',
      };
    });

    expect(popupAttrs).not.toBeNull();
    expect(popupAttrs!.role).toBe('dialog');
    expect(popupAttrs!.ariaModal).toBe('true');
    expect(popupAttrs!.ariaLabelledby).toBeTruthy();
    expect(popupAttrs!.hasHeader).toBe(true);
    expect(popupAttrs!.hasInput).toBe(true);
    expect(popupAttrs!.hasCloseBtn).toBe(true);
    expect(popupAttrs!.isVisible).toBe(true);
  });

  test('close button in inspector popup has aria-label', async ({ page }) => {
    // Activate Quick Edit and open popup
    await page.keyboard.press('Alt+KeyI');
    await expect(getStatusLine(page)).toHaveText('Quick Edit active');

    const button = page.locator('#add-csv-export');
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    // Verify close button has aria-label
    const closeLabel = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-inspector]');
      if (!host || !host.shadowRoot) return null;
      const closeBtn = host.shadowRoot.querySelector('[data-nova="close"]') as HTMLElement | null;
      return closeBtn?.getAttribute('aria-label') ?? null;
    });

    expect(closeLabel).toBe('Close dialog');
  });

  // ── VAL-OVERLAY-050: Escape deactivation ──

  test('Escape exits Quick Edit mode and returns to Idle (VAL-OVERLAY-050)', async ({
    page,
  }) => {
    // Activate Quick Edit
    await page.keyboard.press('Alt+KeyI');
    await expect(getStatusLine(page)).toHaveText('Quick Edit active');

    // Press Escape to deactivate
    await page.keyboard.press('Escape');

    // Status line should return to Idle
    await expect(getStatusLine(page)).toHaveText('Idle');

    // Inspector should no longer be active
    const inspectorActive = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-inspector]');
      return host?.hasAttribute('data-active') ?? false;
    });
    expect(inspectorActive).toBe(false);

    // Cursor should be restored (not crosshair)
    const cursor = await page.evaluate(() => document.body.style.cursor);
    expect(cursor).not.toBe('crosshair');
  });

  test('Escape closes the inspector popup and returns to selection mode', async ({
    page,
  }) => {
    // Activate Quick Edit and open popup by clicking an element
    await page.keyboard.press('Alt+KeyI');
    await expect(getStatusLine(page)).toHaveText('Quick Edit active');

    const button = page.locator('#add-csv-export');
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    // Verify popup is visible
    const popupVisibleBefore = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-inspector]');
      if (!host || !host.shadowRoot) return false;
      const popup = host.shadowRoot.querySelector('.inspector-popup') as HTMLElement | null;
      return popup !== null && popup.style.display === 'flex';
    });
    expect(popupVisibleBefore).toBe(true);

    // Press Escape — should close popup AND deactivate inspector
    await page.keyboard.press('Escape');

    // Status line should return to Idle
    await expect(getStatusLine(page)).toHaveText('Idle');

    // Inspector should be deactivated
    const inspectorActive = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-inspector]');
      return host?.hasAttribute('data-active') ?? false;
    });
    expect(inspectorActive).toBe(false);
  });

  test('Escape key does nothing when inspector is not active', async ({ page }) => {
    // Press Escape while idle — should have no effect
    await page.keyboard.press('Escape');

    // Status line should still be Idle
    await expect(getStatusLine(page)).toHaveText('Idle');

    // No inspector activity
    const inspectorActive = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-inspector]');
      return host?.hasAttribute('data-active') ?? false;
    });
    expect(inspectorActive).toBe(false);
  });

  test('repeated Escape presses do not cause errors', async ({ page }) => {
    // Press Escape multiple times while idle
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // Should still be Idle with no errors
    await expect(getStatusLine(page)).toHaveText('Idle');
  });

  // ── Cross-verification with shortcuts ──

  test('Alt+KeyI toggles Quick Edit off on second press', async ({ page }) => {
    // Activate
    await page.keyboard.press('Alt+KeyI');
    await expect(getStatusLine(page)).toHaveText('Quick Edit active');

    // Deactivate with second press
    await page.keyboard.press('Alt+KeyI');
    await expect(getStatusLine(page)).toHaveText('Idle');

    // Inspector should not be active
    const inspectorActive = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-inspector]');
      return host?.hasAttribute('data-active') ?? false;
    });
    expect(inspectorActive).toBe(false);
  });

  test('inspector backdrop is present and covers viewport during active mode', async ({
    page,
  }) => {
    // Activate Quick Edit
    await page.keyboard.press('Alt+KeyI');
    await expect(getStatusLine(page)).toHaveText('Quick Edit active');

    // Verify backdrop exists and is displayed
    const backdropInfo = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-inspector]');
      if (!host || !host.shadowRoot) return null;
      const backdrop = host.shadowRoot.querySelector('.inspector-backdrop') as HTMLElement | null;
      if (!backdrop) return { exists: false };
      return {
        exists: true,
        display: backdrop.style.display,
        className: backdrop.className,
      };
    });

    expect(backdropInfo).not.toBeNull();
    expect(backdropInfo!.exists).toBe(true);
    expect(backdropInfo!.display).toBe('block');

    // Deactivate and verify backdrop is hidden
    await page.keyboard.press('Escape');
    await expect(getStatusLine(page)).toHaveText('Idle');

    const backdropHidden = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-inspector]');
      if (!host || !host.shadowRoot) return true;
      const backdrop = host.shadowRoot.querySelector('.inspector-backdrop') as HTMLElement | null;
      return !backdrop || backdrop.style.display === 'none';
    });
    expect(backdropHidden).toBe(true);
  });
});

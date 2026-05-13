/**
 * End-to-end tests for the status line and aria-live region,
 * driven by the OverlayStateMachine.
 *
 * These tests verify:
 * - VAL-OVERLAY-008: Status line text reflects current FSM state
 * - VAL-OVERLAY-009: State transitions reflected in status line within 300 ms
 * - VAL-OVERLAY-010: aria-live="polite" mirror announces state changes
 */

import { test, expect } from '@playwright/test';

const PROXY_URL = 'http://localhost:3501';

function getStatusLine(page: import('@playwright/test').Page) {
  return page.locator('[data-nova="status-line"]');
}

function getStatusLive(page: import('@playwright/test').Page) {
  return page.locator('[data-nova="status-live"]');
}

test.describe('Status Line + State Machine', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PROXY_URL);
    await page.waitForSelector('[data-nova-pill]', { timeout: 10000 });
    await page.waitForSelector('[data-nova="status-line"]', { timeout: 5000 });
    await page.waitForSelector('[data-nova="status-live"]', { timeout: 5000 });
  });

  // ── VAL-OVERLAY-008: Status line text reflects current FSM state ──

  test('status line shows "Idle" on page load (VAL-OVERLAY-008)', async ({ page }) => {
    const statusLine = getStatusLine(page);
    await expect(statusLine).toBeVisible();

    const text = await statusLine.textContent();
    expect(text).toBe('Idle');
  });

  test('status line is adjacent to the pill and visible', async ({ page }) => {
    const pillBox = await page.locator('[data-nova-pill]').boundingBox();
    const statusBox = await getStatusLine(page).boundingBox();

    expect(pillBox).not.toBeNull();
    expect(statusBox).not.toBeNull();

    // Status line should be to the right of the pill
    expect(statusBox!.x).toBeGreaterThanOrEqual(pillBox!.x + pillBox!.width - 5);

    // Status line should be roughly vertically aligned with the pill
    const pillCenterY = pillBox!.y + pillBox!.height / 2;
    expect(statusBox!.y).toBeLessThanOrEqual(pillCenterY + statusBox!.height);
    expect(statusBox!.y + statusBox!.height).toBeGreaterThanOrEqual(pillCenterY);
  });

  // ── VAL-OVERLAY-010: aria-live="polite" mirror announces state changes ──

  test('aria-live region has aria-live="polite" and mirrors status text (VAL-OVERLAY-010)', async ({
    page,
  }) => {
    const statusLive = getStatusLive(page);

    // Should have aria-live="polite"
    await expect(statusLive).toHaveAttribute('aria-live', 'polite');
    await expect(statusLive).toHaveAttribute('aria-atomic', 'true');

    // Text should match the status line
    const statusText = await getStatusLine(page).textContent();
    const liveText = await statusLive.textContent();
    expect(liveText).toBe(statusText);
    expect(liveText).toBe('Idle');
  });

  test('aria-live updates when status line changes', async ({ page }) => {
    // Initial state
    await expect(getStatusLine(page)).toHaveText('Idle');
    await expect(getStatusLive(page)).toHaveText('Idle');

    // Find the mic button and click it to transition to "Listening"
    const micBtn = page.getByRole('button', { name: /voice|mic/i });
    const micExists = await micBtn.count();
    if (micExists > 0) {
      await micBtn.first().click();

      // Status should change to Listening
      await expect(getStatusLine(page)).toHaveText('Listening', { timeout: 3000 });
      await expect(getStatusLive(page)).toHaveText('Listening', { timeout: 3000 });
    }
  });

  // ── VAL-OVERLAY-009: State transitions reflected in status line within 300 ms ──

  test('status line updates within 300ms of a state transition (VAL-OVERLAY-009)', async ({
    page,
  }) => {
    // Verify initial state
    await expect(getStatusLine(page)).toHaveText('Idle');

    // Find and click the mic button
    const micBtn = page.getByRole('button', { name: /voice|mic/i });
    const micExists = await micBtn.count();
    if (micExists === 0) {
      test.skip(true, 'Mic button not found — cannot test timing');
      return;
    }

    // Measure time for status line to update
    const startTime = Date.now();
    await micBtn.first().click();

    // Poll for the new text — must appear within 300ms
    await expect
      .poll(
        async () => {
          const text = await getStatusLine(page).textContent();
          return text;
        },
        {
          timeout: 300,
          intervals: [50, 100, 150, 200, 250],
          message: 'Status line did not update to Listening within 300ms',
        },
      )
      .toBe('Listening');

    const elapsed = Date.now() - startTime;
    // Just for observation — we already verified via the poll timeout
    expect(elapsed).toBeLessThan(1000); // generous upper bound
  });

  test('status line updates smoothly through multiple transitions', async ({ page }) => {
    const statusLine = getStatusLine(page);
    const statusLive = getStatusLive(page);

    // Start: Idle
    await expect(statusLine).toHaveText('Idle');
    await expect(statusLive).toHaveText('Idle');

    // Try to trigger a listening state via mic
    const micBtn = page.getByRole('button', { name: /voice|mic/i });
    const micExists = await micBtn.count();

    if (micExists > 0) {
      // Click mic → Listening
      await micBtn.first().click();
      await expect(statusLine).toHaveText('Listening', { timeout: 3000 });
      await expect(statusLive).toHaveText('Listening', { timeout: 3000 });

      // Click mic again → Idle
      await micBtn.first().click();
      await expect(statusLine).toHaveText('Idle', { timeout: 3000 });
      await expect(statusLive).toHaveText('Idle', { timeout: 3000 });
    }
  });

  test('status line and aria-live text always match', async ({ page }) => {
    const statusLine = getStatusLine(page);
    const statusLive = getStatusLive(page);

    // Initial match
    const initialStatus = await statusLine.textContent();
    const initialLive = await statusLive.textContent();
    expect(initialLive).toBe(initialStatus);

    // After any interaction, they should still match
    // Try mic toggle
    const micBtn = page.getByRole('button', { name: /voice|mic/i });
    if ((await micBtn.count()) > 0) {
      await micBtn.first().click();
      await page.waitForTimeout(500);

      const afterClickStatus = await statusLine.textContent();
      const afterClickLive = await statusLive.textContent();
      expect(afterClickLive).toBe(afterClickStatus);
      expect(afterClickStatus).toBe('Listening');
    }
  });
});

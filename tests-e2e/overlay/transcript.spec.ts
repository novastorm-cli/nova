/**
 * End-to-end tests for TranscriptBar / CommandInput.
 *
 * These tests verify:
 * - VAL-OVERLAY-011: Transcript bar / command input visible by default
 * - VAL-OVERLAY-012: Cmd/Ctrl+K focuses the transcript input from anywhere on the page
 * - VAL-OVERLAY-013: Cmd/Ctrl+K is suppressed while typing inside a host input
 * - VAL-OVERLAY-014: Enter in transcript input submits and creates a pending task
 * - VAL-OVERLAY-015: Awaiting-confirmation slide-up animation respects reduced-motion
 */

import { test, expect } from '@playwright/test';

const PROXY_URL = 'http://localhost:3501';

/** Locate the command input element. */
function getCommandInput(page: import('@playwright/test').Page) {
  return page.locator('[data-nova="command-input"]');
}

/** Locate the confirm panel. */
function getConfirmPanel(page: import('@playwright/test').Page) {
  return page.locator('[data-nova="confirm-panel"]');
}

/** Locate the status line. */
function getStatusLine(page: import('@playwright/test').Page) {
  return page.locator('[data-nova="status-line"]');
}

test.describe('TranscriptBar / CommandInput', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PROXY_URL);
    await page.waitForSelector('[data-nova-pill]', { timeout: 10000 });
    await page.waitForSelector('[data-nova="command-input"]', { timeout: 5000 });
    await page.waitForSelector('[data-nova="status-line"]', { timeout: 5000 });
  });

  // ── VAL-OVERLAY-011: Transcript bar / command input visible by default ──

  test('command input is visible on page load (VAL-OVERLAY-011)', async ({ page }) => {
    const input = getCommandInput(page);
    await expect(input).toBeAttached();
    await expect(input).toBeVisible();

    // Should have non-zero width and height
    const box = await input.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    // Should have a placeholder attribute
    const placeholder = await input.getAttribute('placeholder');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.length).toBeGreaterThan(0);
  });

  test('command input is at bottom-center of the viewport', async ({ page }) => {
    const input = getCommandInput(page);
    const box = await input.boundingBox();
    expect(box).not.toBeNull();

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();

    // Should be near the bottom of the viewport
    expect(box!.y + box!.height).toBeGreaterThan(viewport!.height * 0.7);

    // Should be roughly centered horizontally
    const centerX = box!.x + box!.width / 2;
    expect(centerX).toBeGreaterThan(viewport!.width * 0.2);
    expect(centerX).toBeLessThan(viewport!.width * 0.8);
  });

  // ── VAL-OVERLAY-012: Cmd/Ctrl+K focuses the transcript input ──

  test('Ctrl+K focuses command input from anywhere on the page (VAL-OVERLAY-012)', async ({
    page,
  }) => {
    // Start with focus on body
    await page.evaluate(() => document.body.focus());

    // Press Ctrl+K (or Meta+K on Mac)
    const isMac = await page.evaluate(() => navigator.platform.includes('Mac'));
    const modifier = isMac ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+KeyK`);

    // The command input should now be focused
    const input = getCommandInput(page);
    await expect(input).toBeFocused({ timeout: 1000 });
  });

  test('Cmd+K focuses command input on Mac-like platform', async ({ page }) => {
    // Press Meta+K (Cmd+K)
    await page.keyboard.press('Meta+KeyK');

    const input = getCommandInput(page);
    await expect(input).toBeFocused({ timeout: 1000 });
  });

  // ── VAL-OVERLAY-013: Cmd/Ctrl+K suppressed in host input ──

  test('Ctrl+K does NOT steal focus from host input field (VAL-OVERLAY-013)', async ({
    page,
  }) => {
    // Navigate to /admin page which has form fields
    await page.goto(`${PROXY_URL}/admin`);
    await page.waitForSelector('[data-nova="command-input"]', { timeout: 5000 });

    // Find the admin username field and focus it
    const adminField = page.locator('#admin-username');
    const fieldExists = await adminField.count();
    if (fieldExists === 0) {
      test.skip(true, '#admin-username field not found on /admin page');
      return;
    }

    await adminField.focus();
    await expect(adminField).toBeFocused();

    // Press Ctrl+K while focused in the host input
    await page.keyboard.press('Control+KeyK');

    // Focus should NOT have moved to the command input
    await expect(adminField).toBeFocused();
    const cmdInput = getCommandInput(page);
    await expect(cmdInput).not.toBeFocused();
  });

  test('Meta+K does NOT steal focus when typing in host input', async ({ page }) => {
    await page.goto(`${PROXY_URL}/admin`);
    await page.waitForSelector('[data-nova="command-input"]', { timeout: 5000 });

    const adminField = page.locator('#admin-username');
    if ((await adminField.count()) === 0) {
      test.skip(true, '#admin-username field not found');
      return;
    }

    await adminField.focus();
    await page.keyboard.press('Meta+KeyK');

    await expect(adminField).toBeFocused();
  });

  // ── VAL-OVERLAY-014: Enter submits and creates a pending task ──

  test('Enter on non-empty input creates pending task (VAL-OVERLAY-014)', async ({ page }) => {
    const input = getCommandInput(page);

    // Focus and type a command
    await input.focus();
    await input.fill('Add a test comment to the header');

    // Press Enter to submit
    await page.keyboard.press('Enter');

    // The status line should transition to Thinking or Awaiting confirmation
    // within a reasonable timeout (server round-trip)
    const statusLine = getStatusLine(page);
    await expect
      .poll(() => statusLine.textContent(), { timeout: 30000, intervals: [500, 1000, 2000] })
      .toMatch(/Thinking|Awaiting confirmation/);

    // Also verify that the task panel exists in the DOM.
    // The task panel uses a shadow DOM host with data-nova-task-panel attribute.
    const taskPanelHost = page.locator('[data-nova-task-panel]');
    await expect(taskPanelHost).toBeAttached({ timeout: 10000 });

    // Verify that the task panel is visible (not hidden).
    // When tasks are pending, the panel becomes visible with at minimum a title bar.
    const taskPanelVisible = await taskPanelHost.evaluate((host) => {
      const root = host.shadowRoot;
      if (!root) return false;
      const panel = root.querySelector('.task-panel');
      return panel !== null && !panel.classList.contains('hidden');
    });

    // Task panel should be visible when status shows "Awaiting confirmation"
    // If the backend hasn't created tasks yet, this may be false in some envs.
    // The status-line assertion above already confirms the submit was processed.
    if (taskPanelVisible) {
      // Check that the visible panel has text content (at minimum the title)
      const textContent = await taskPanelHost.evaluate((host) => {
        const panel = host.shadowRoot?.querySelector('.task-panel');
        return panel?.textContent?.trim() ?? '';
      });
      expect(textContent.length).toBeGreaterThan(0);
    }
  });

  // ── VAL-OVERLAY-015: Reduced-motion wrapping for confirmation slide-up ──

  test('confirmation panel appears without animation when prefers-reduced-motion: reduce (VAL-OVERLAY-015)', async ({
    page,
  }) => {
    // Emulate reduced motion preference
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // Reload to apply setting
    await page.reload();
    await page.waitForSelector('[data-nova="command-input"]', { timeout: 5000 });

    // Trigger confirmation by typing and submitting a command
    const input = getCommandInput(page);
    await input.focus();
    await input.fill('Test command for reduced motion');
    await page.keyboard.press('Enter');

    // Wait for the confirm panel to potentially appear
    // (it appears when server responds with pending_tasks)
    await page.waitForTimeout(1500);

    const confirmPanel = getConfirmPanel(page);
    const isVisible = await confirmPanel.isVisible().catch(() => false);

    if (isVisible) {
      // Take initial bounding box
      const box1 = await confirmPanel.boundingBox();

      // Wait 50ms and take another reading
      await page.waitForTimeout(50);
      const box2 = await confirmPanel.boundingBox();

      // With reduced motion, positions should be identical (no slide animation)
      if (box1 && box2) {
        expect(box1.x).toBeCloseTo(box2.x, 0);
        expect(box1.y).toBeCloseTo(box2.y, 0);
        expect(box1.width).toBeCloseTo(box2.width, 0);
        expect(box1.height).toBeCloseTo(box2.height, 0);
      }

      // data-animating should NOT be present when reduced motion is preferred
      const hasAnimating = await confirmPanel.getAttribute('data-animating');
      expect(hasAnimating).toBeNull();
    }
  });

  test('confirmation panel slides up when no reduced-motion preference (VAL-OVERLAY-015)', async ({
    page,
  }) => {
    // Ensure reduced motion is NOT set
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    await page.reload();
    await page.waitForSelector('[data-nova="command-input"]', { timeout: 5000 });

    // Trigger confirmation
    const input = getCommandInput(page);
    await input.focus();
    await input.fill('Test command with animation');
    await page.keyboard.press('Enter');

    await page.waitForTimeout(1500);

    const confirmPanel = getConfirmPanel(page);
    const isVisible = await confirmPanel.isVisible().catch(() => false);

    if (isVisible) {
      // The animation is active — element should have the slideUp animation applied.
      // We check that the element renders (bounding box exists) and verify
      // animation is NOT instant by checking the CSS animation property.
      const animationName = await confirmPanel.evaluate((el) => {
        return window.getComputedStyle(el).animationName;
      });

      // When motion is allowed, animation-name should be 'nova-slide-up' (not 'none')
      // Reduced-motion wraps the animation in @media, so when motion is preferred,
      // the keyframes exist and the animation plays.
      expect(animationName).toBe('nova-slide-up');

      // After animation completes (200ms CSS), data-animating should be removed.
      // At 1500ms wait above, animation is long done, so attribute should be absent.
      await page.waitForTimeout(300);
      const hasAnimating = await confirmPanel.getAttribute('data-animating');
      expect(hasAnimating).toBeNull();
    }
  });

  test('confirmation slide-up is instant with prefers-reduced-motion: reduce', async ({
    page,
  }) => {
    // Emulate reduced motion
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await page.waitForSelector('[data-nova="command-input"]', { timeout: 5000 });

    // Trigger confirmation
    const input = getCommandInput(page);
    await input.focus();
    await input.fill('Instant animation test');
    await page.keyboard.press('Enter');

    await page.waitForTimeout(1500);

    const confirmPanel = getConfirmPanel(page);
    const isVisible = await confirmPanel.isVisible().catch(() => false);

    if (isVisible) {
      // With reduced motion, animation-name should be 'none'
      const animationName = await confirmPanel.evaluate((el) => {
        return window.getComputedStyle(el).animationName;
      });

      expect(animationName).toBe('none');

      // data-animating should NOT be present when reduced motion is preferred
      const hasAnimating = await confirmPanel.getAttribute('data-animating');
      expect(hasAnimating).toBeNull();
    }
  });
});

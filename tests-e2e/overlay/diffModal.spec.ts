/**
 * End-to-end tests for DiffModal enrichments — toolbar with Copy, Open file,
 * Revert buttons, and +N -M stats badge.
 *
 * These tests verify:
 * - VAL-OVERLAY-022: DiffModal toolbar shows Copy, Open file, Revert, stats badge
 * - VAL-OVERLAY-023: Copy diff writes unified diff to clipboard
 * - VAL-OVERLAY-024: Revert this file triggers revert and closes modal
 * - VAL-OVERLAY-025: Stats badge +N -M matches diff content
 */

import { test, expect } from '@playwright/test';

const PROXY_URL = 'http://localhost:3501';

/** A realistic unified diff fixture for testing.
 *  Added lines (starting with '+' but not '+++'): 7 lines
 *  Removed lines (starting with '-' but not '---'): 2 lines
 */
const TEST_DIFF = `--- a/src/Button.tsx
+++ b/src/Button.tsx
@@ -1,5 +1,6 @@
 import React from 'react';

-export function Button() {
+export function Button({ variant = 'primary' }: ButtonProps) {
+  const classes = variant === 'primary' ? 'btn-primary' : 'btn-secondary';
   return (
-    <button className="btn">Click me</button>
+    <button className={classes}>Click me</button>
   );
 }
@@ -10,4 +11,7 @@
 export function Header() {
   return <header>Site Header</header>;
 }
+
+export function Footer() {
+  return <footer>Site Footer</footer>;
+}`;

const TEST_FILE_PATH = 'src/Button.tsx';

/** Helper: call __novaTest__.showDiffModal from the page. */
async function showDiffModal(
  page: import('@playwright/test').Page,
  filePath: string,
  diff: string,
) {
  await page.evaluate(
    ([fp, d]) => {
      const hook = (window as unknown as Record<string, any>).__novaTest__;
      if (hook && typeof hook.showDiffModal === 'function') {
        hook.showDiffModal(fp, d, fp, 1);
      }
    },
    [filePath, diff] as const,
  );
}

test.describe('DiffModal enrichments', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PROXY_URL);
    // Wait for the overlay root and test hook to be present
    await page.waitForSelector('#nova-root', { state: 'attached', timeout: 10000 });
    await page.waitForFunction(() => {
      const hook = (window as unknown as Record<string, any>).__novaTest__;
      return typeof hook?.showDiffModal === 'function';
    }, null, { timeout: 10000 });
  });

  test('toolbar shows Copy, Open file, Revert buttons and stats badge (VAL-OVERLAY-022)', async ({
    page,
  }) => {
    await showDiffModal(page, TEST_FILE_PATH, TEST_DIFF);

    // Wait for the diff modal host to be present
    const diffHost = page.locator('[data-nova-diff-modal]');
    await expect(diffHost).toBeAttached();

    // The modal is inside a shadow root. Query within it via evaluate.
    const toolbarText = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host || !host.shadowRoot) return null;
      const toolbar = host.shadowRoot.querySelector('[data-nova="toolbar"]');
      if (!toolbar) return null;
      return toolbar.textContent?.trim() ?? null;
    });

    expect(toolbarText).toBeTruthy();
    expect(toolbarText).toContain('Copy diff');
    expect(toolbarText).toContain('Revert this file');
    // Stats badge: +7 for 7 added, -2 for 2 removed
    expect(toolbarText).toContain('+7');
    expect(toolbarText).toContain('-2');

    // Verify aria-labels
    const hasCopyAria = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('[data-nova="copy"]');
      return btn?.getAttribute('aria-label') === 'Copy diff to clipboard';
    });
    expect(hasCopyAria).toBe(true);

    const hasRevertAria = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('[data-nova="revert"]');
      return btn?.getAttribute('aria-label') === 'Revert this file';
    });
    expect(hasRevertAria).toBe(true);

    const hasStatsAria = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host || !host.shadowRoot) return false;
      const chip = host.shadowRoot.querySelector('[data-nova="stats"]');
      return chip?.getAttribute('aria-label') === 'Diff statistics';
    });
    expect(hasStatsAria).toBe(true);

    const hasOpenAria = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host || !host.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('[data-nova="open-file"]');
      return btn?.getAttribute('aria-label') === 'Open file in editor';
    });
    expect(hasOpenAria).toBe(true);
  });

  test('Copy diff writes unified diff text to clipboard (VAL-OVERLAY-023)', async ({
    page,
    context,
  }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await showDiffModal(page, TEST_FILE_PATH, TEST_DIFF);
    await page.waitForSelector('[data-nova-diff-modal]', { state: 'attached', timeout: 5000 });

    // Click the Copy button inside shadow DOM
    await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host || !host.shadowRoot) return;
      const copyBtn = host.shadowRoot.querySelector('[data-nova="copy"]') as HTMLElement;
      copyBtn?.click();
    });

    // Wait for clipboard write
    await page.waitForTimeout(500);

    // Read clipboard
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('--- a/src/Button.tsx');
    expect(clipboardText).toContain('+++ b/src/Button.tsx');
    expect(clipboardText).toContain('@@ -1,5 +1,6 @@');
    expect(clipboardText).toContain('+export function Footer()');
  });

  test('Copy button shows "Copied!" feedback and reverts after delay', async ({
    page,
    context,
  }) => {
    // Grant clipboard permissions so clipboard.writeText succeeds
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await showDiffModal(page, TEST_FILE_PATH, TEST_DIFF);
    await page.waitForSelector('[data-nova-diff-modal]', { state: 'attached', timeout: 5000 });

    // Click Copy
    await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host || !host.shadowRoot) return;
      const copyBtn = host.shadowRoot.querySelector('[data-nova="copy"]') as HTMLElement;
      copyBtn?.click();
    });

    // Verify "Copied!" appears
    const copiedText = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host || !host.shadowRoot) return null;
      const copyBtn = host.shadowRoot.querySelector('[data-nova="copy"]');
      return copyBtn?.textContent?.trim() ?? null;
    });
    expect(copiedText).toBe('Copied!');

    // Wait for feedback to revert
    await page.waitForTimeout(1600);

    const revertedText = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host || !host.shadowRoot) return null;
      const copyBtn = host.shadowRoot.querySelector('[data-nova="copy"]');
      return copyBtn?.textContent?.trim() ?? null;
    });
    expect(revertedText).toBe('Copy diff');
  });

  test('Revert this file closes modal and adds entry to ActivityLog (VAL-OVERLAY-024)', async ({
    page,
  }) => {
    // Clear any existing ActivityLog state
    await page.evaluate(() => {
      sessionStorage.removeItem('nova-activity-log');
    });

    await showDiffModal(page, TEST_FILE_PATH, TEST_DIFF);
    await page.waitForSelector('[data-nova-diff-modal]', { state: 'attached', timeout: 5000 });

    // Verify modal is visible
    let modalVisible = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host || !host.shadowRoot) return false;
      const overlay = host.shadowRoot.querySelector('.diff-overlay');
      return overlay && !overlay.classList.contains('hidden');
    });
    expect(modalVisible).toBe(true);

    // Click Revert button
    await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host || !host.shadowRoot) return;
      const revertBtn = host.shadowRoot.querySelector('[data-nova="revert"]') as HTMLElement;
      revertBtn?.click();
    });

    // Wait for modal to hide
    await page.waitForTimeout(500);

    // Verify modal is now hidden
    modalVisible = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host || !host.shadowRoot) return false;
      const overlay = host.shadowRoot.querySelector('.diff-overlay');
      return overlay && !overlay.classList.contains('hidden');
    });
    expect(modalVisible).toBe(false);

    // Verify ActivityLog has a "Reverted:" entry
    const activityText = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-activity-log]');
      if (!host || !host.shadowRoot) return null;
      const log = host.shadowRoot.querySelector('.activity-log');
      return log?.textContent?.trim() ?? null;
    });

    expect(activityText).toContain('Reverted:');
    expect(activityText).toContain(TEST_FILE_PATH);
  });

  test('Stats badge counts added and removed lines correctly (VAL-OVERLAY-025)', async ({
    page,
  }) => {
    await showDiffModal(page, TEST_FILE_PATH, TEST_DIFF);
    await page.waitForSelector('[data-nova-diff-modal]', { state: 'attached', timeout: 5000 });

    const statsText = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host || !host.shadowRoot) return null;
      const chip = host.shadowRoot.querySelector('[data-nova="stats"]');
      return chip?.textContent?.trim() ?? null;
    });

    expect(statsText).toContain('+7');
    expect(statsText).toContain('-2');
  });

  test('Stats badge format matches +N -M pattern', async ({ page }) => {
    await showDiffModal(page, TEST_FILE_PATH, TEST_DIFF);
    await page.waitForSelector('[data-nova-diff-modal]', { state: 'attached', timeout: 5000 });

    const statsText = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host || !host.shadowRoot) return null;
      const chip = host.shadowRoot.querySelector('[data-nova="stats"]');
      return chip?.textContent?.trim() ?? null;
    });

    expect(statsText).toMatch(/^\+\d+\s+-\d+$/);
  });
});

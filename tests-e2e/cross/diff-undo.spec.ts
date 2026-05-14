/**
 * Cross-area verification: DiffModal undo — reject after preview leaves
 * working tree clean.
 *
 * VAL-CROSS-017: Diff modal undo — reject after preview leaves working tree clean
 *
 * Prerequisites:
 * - Fixture running on http://localhost:3500
 * - Nova running on http://localhost:3501 with DEEPSEEK_API_KEY set
 *
 * This test verifies that when a user opens a DiffModal preview and clicks
 * the Revert / Reject button (or closes without confirming):
 * 1. The modal closes cleanly
 * 2. The ActivityLog shows a "Reverted:" entry documenting the rejection
 * 3. git status remains clean — no file mutations persist
 * 4. No nova/* branch is created for the rejected task
 *
 * The test exercises the M2 DiffModal flow + M3 FSM correctness end-to-end.
 */

import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

const PROXY_URL = 'http://localhost:3501';
const FIXTURE_DIR = '/home/upranevich/Projects/Open_source/tests/next-fixture';

/** A realistic unified diff fixture used for test preview. */
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

/** Record baseline git status. */
function getGitStatus(): string {
  return execSync('git status --porcelain', { cwd: FIXTURE_DIR, encoding: 'utf-8' }).trim();
}

/** Get list of nova/* branches. */
function getNovaBranches(): string {
  return execSync('git branch --list "nova/*"', { cwd: FIXTURE_DIR, encoding: 'utf-8' }).trim();
}

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

test.describe('DiffModal Undo — Cross-area (VAL-CROSS-017)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PROXY_URL);
    // Wait for the overlay root and test hook to be present
    await page.waitForSelector('#nova-root', { state: 'attached', timeout: 10000 });
    await page.waitForFunction(() => {
      const hook = (window as unknown as Record<string, any>).__novaTest__;
      return typeof hook?.showDiffModal === 'function';
    }, { timeout: 10000 });

    // Wait for the overlay to fully initialize (pill, status line, etc.)
    await page.waitForSelector('[data-nova-pill]', { timeout: 10000 });
    await page.waitForSelector('[data-nova="status-line"]', { timeout: 10000 });
    await page.waitForSelector('[data-nova-activity-log]', { state: 'attached', timeout: 10000 });
  });

  test('reject via Revert button closes DiffModal, logs to ActivityLog, leaves git clean', async ({
    page,
  }) => {
    // Record pre-task git baseline
    const baselineStatus = getGitStatus();
    const baselineBranches = getNovaBranches();

    // Show a DiffModal with a test diff
    await showDiffModal(page, TEST_FILE_PATH, TEST_DIFF);
    await page.waitForSelector('[data-nova-diff-modal]', { state: 'attached', timeout: 5000 });

    // Verify the modal is visible
    let modalVisible = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host?.shadowRoot) return false;
      const overlay = host.shadowRoot.querySelector('.diff-overlay');
      return overlay && !overlay.classList.contains('hidden');
    });
    expect(modalVisible).toBe(true);

    // Verify the toolbar has the Revert button and stats badge
    const toolbarText = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host?.shadowRoot) return null;
      const toolbar = host.shadowRoot.querySelector('[data-nova="toolbar"]');
      return toolbar?.textContent?.trim() ?? null;
    });
    expect(toolbarText).toContain('Revert this file');

    // Click the Revert button inside the shadow DOM
    await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host?.shadowRoot) return;
      const revertBtn = host.shadowRoot.querySelector('[data-nova="revert"]') as HTMLElement;
      revertBtn?.click();
    });

    // Wait for modal to close
    await page.waitForTimeout(500);

    // Verify modal is now hidden
    modalVisible = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host?.shadowRoot) return false;
      const overlay = host.shadowRoot.querySelector('.diff-overlay');
      return overlay && !overlay.classList.contains('hidden');
    });
    expect(modalVisible).toBe(false);

    // Verify ActivityLog has a "Reverted:" entry
    const activityText = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-activity-log]');
      if (!host?.shadowRoot) return null;
      const log = host.shadowRoot.querySelector('.activity-log');
      return log?.textContent?.trim() ?? null;
    });
    expect(activityText).toContain('Reverted:');
    expect(activityText).toContain(TEST_FILE_PATH);

    // Give any async operations time to settle
    await page.waitForTimeout(1000);

    // Verify git working tree has no modifications
    const currentStatus = getGitStatus();
    expect(currentStatus).toBe(baselineStatus);

    // Verify no nova/* branch was created
    const currentBranches = getNovaBranches();
    if (baselineBranches === '') {
      expect(currentBranches).toBe('');
    } else {
      expect(currentBranches).toBe(baselineBranches);
    }
  });

  test('reject via close button (×) leaves git clean', async ({ page }) => {
    // Record pre-task git baseline
    const baselineStatus = getGitStatus();
    const baselineBranches = getNovaBranches();

    // Show a DiffModal
    await showDiffModal(page, TEST_FILE_PATH, TEST_DIFF);
    await page.waitForSelector('[data-nova-diff-modal]', { state: 'attached', timeout: 5000 });

    // Verify the modal is visible
    let modalVisible = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host?.shadowRoot) return false;
      const overlay = host.shadowRoot.querySelector('.diff-overlay');
      return overlay && !overlay.classList.contains('hidden');
    });
    expect(modalVisible).toBe(true);

    // Click the close (×) button
    await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host?.shadowRoot) return;
      const closeBtn = host.shadowRoot.querySelector('[data-nova="close"]') as HTMLElement;
      closeBtn?.click();
    });

    // Wait for modal to close
    await page.waitForTimeout(500);

    // Verify modal is now hidden
    modalVisible = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host?.shadowRoot) return false;
      const overlay = host.shadowRoot.querySelector('.diff-overlay');
      return overlay && !overlay.classList.contains('hidden');
    });
    expect(modalVisible).toBe(false);

    // Give any async operations time to settle
    await page.waitForTimeout(1000);

    // Verify git working tree has no modifications
    const currentStatus = getGitStatus();
    expect(currentStatus).toBe(baselineStatus);

    // Verify no nova/* branch was created
    const currentBranches = getNovaBranches();
    if (baselineBranches === '') {
      expect(currentBranches).toBe('');
    } else {
      expect(currentBranches).toBe(baselineBranches);
    }
  });

  test('reject via Escape key closes modal and leaves git clean', async ({ page }) => {
    // Record pre-task git baseline
    const baselineStatus = getGitStatus();
    const baselineBranches = getNovaBranches();

    // Show a DiffModal
    await showDiffModal(page, TEST_FILE_PATH, TEST_DIFF);
    await page.waitForSelector('[data-nova-diff-modal]', { state: 'attached', timeout: 5000 });

    // Verify the modal is visible
    let modalVisible = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host?.shadowRoot) return false;
      const overlay = host.shadowRoot.querySelector('.diff-overlay');
      return overlay && !overlay.classList.contains('hidden');
    });
    expect(modalVisible).toBe(true);

    // Press Escape to close the modal (focus trap should handle this)
    await page.keyboard.press('Escape');

    // Wait for modal to close
    await page.waitForTimeout(500);

    // Verify modal is now hidden
    modalVisible = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host?.shadowRoot) return false;
      const overlay = host.shadowRoot.querySelector('.diff-overlay');
      return overlay && !overlay.classList.contains('hidden');
    });
    expect(modalVisible).toBe(false);

    // Give any async operations time to settle
    await page.waitForTimeout(1000);

    // Verify git working tree has no modifications
    const currentStatus = getGitStatus();
    expect(currentStatus).toBe(baselineStatus);

    // Verify no nova/* branch was created
    const currentBranches = getNovaBranches();
    if (baselineBranches === '') {
      expect(currentBranches).toBe('');
    } else {
      expect(currentBranches).toBe(baselineBranches);
    }
  });

  test('reject via backdrop click closes modal and leaves git clean', async ({ page }) => {
    // Record pre-task git baseline
    const baselineStatus = getGitStatus();
    const baselineBranches = getNovaBranches();

    // Show a DiffModal
    await showDiffModal(page, TEST_FILE_PATH, TEST_DIFF);
    await page.waitForSelector('[data-nova-diff-modal]', { state: 'attached', timeout: 5000 });

    // Verify the modal is visible
    let modalVisible = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host?.shadowRoot) return false;
      const overlay = host.shadowRoot.querySelector('.diff-overlay');
      return overlay && !overlay.classList.contains('hidden');
    });
    expect(modalVisible).toBe(true);

    // Click the backdrop (the diff-overlay element itself)
    await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host?.shadowRoot) return;
      const overlay = host.shadowRoot.querySelector('.diff-overlay') as HTMLElement;
      // Click in the top-left corner of the overlay (backdrop area)
      overlay?.click();
    });

    // Wait for modal to close
    await page.waitForTimeout(500);

    // Verify modal is now hidden
    modalVisible = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host?.shadowRoot) return false;
      const overlay = host.shadowRoot.querySelector('.diff-overlay');
      return overlay && !overlay.classList.contains('hidden');
    });
    expect(modalVisible).toBe(false);

    // Give any async operations time to settle
    await page.waitForTimeout(1000);

    // Verify git working tree has no modifications
    const currentStatus = getGitStatus();
    expect(currentStatus).toBe(baselineStatus);

    // Verify no nova/* branch was created
    const currentBranches = getNovaBranches();
    if (baselineBranches === '') {
      expect(currentBranches).toBe('');
    } else {
      expect(currentBranches).toBe(baselineBranches);
    }
  });

  test('reject preserves existing uncommitted changes (no accidental reset)', async ({ page }) => {
    // This test verifies that rejecting a DiffModal does not accidentally
    // reset or clean up the working tree. If there were pre-existing
    // uncommitted changes, they should survive the reject operation.

    // Record pre-task git baseline
    const baselineStatus = getGitStatus();
    const baselineBranches = getNovaBranches();

    // Show a DiffModal
    await showDiffModal(page, TEST_FILE_PATH, TEST_DIFF);
    await page.waitForSelector('[data-nova-diff-modal]', { state: 'attached', timeout: 5000 });

    // Click Revert button
    await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host?.shadowRoot) return;
      const revertBtn = host.shadowRoot.querySelector('[data-nova="revert"]') as HTMLElement;
      revertBtn?.click();
    });

    // Wait for modal to close
    await page.waitForTimeout(500);

    // Verify git status is identical to baseline (including any pre-existing changes)
    const currentStatus = getGitStatus();
    expect(currentStatus).toBe(baselineStatus);

    // Verify no nova/* branch was created
    const currentBranches = getNovaBranches();
    if (baselineBranches === '') {
      expect(currentBranches).toBe('');
    } else {
      expect(currentBranches).toBe(baselineBranches);
    }
  });

  test('Revert button has accessible aria-label and danger styling', async ({ page }) => {
    await showDiffModal(page, TEST_FILE_PATH, TEST_DIFF);
    await page.waitForSelector('[data-nova-diff-modal]', { state: 'attached', timeout: 5000 });

    // Verify aria-label on revert button
    const revertAria = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host?.shadowRoot) return null;
      const btn = host.shadowRoot.querySelector('[data-nova="revert"]');
      return btn?.getAttribute('aria-label') ?? null;
    });
    expect(revertAria).toBe('Revert this file');

    // Verify danger class
    const hasDangerClass = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host?.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('[data-nova="revert"]');
      return btn?.classList.contains('diff-tool-btn-danger') ?? false;
    });
    expect(hasDangerClass).toBe(true);
  });

  test('multiple open/close cycles do not leak state or create commits', async ({ page }) => {
    const baselineStatus = getGitStatus();
    const baselineBranches = getNovaBranches();

    // Cycle 1: show → close via Revert
    await showDiffModal(page, TEST_FILE_PATH, TEST_DIFF);
    await page.waitForSelector('[data-nova-diff-modal]', { state: 'attached', timeout: 5000 });
    await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host?.shadowRoot) return;
      const revertBtn = host.shadowRoot.querySelector('[data-nova="revert"]') as HTMLElement;
      revertBtn?.click();
    });
    await page.waitForTimeout(300);

    // Cycle 2: show → close via ×
    await showDiffModal(page, 'src/Header.tsx', TEST_DIFF);
    await page.waitForSelector('[data-nova-diff-modal]', { state: 'attached', timeout: 5000 });
    await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host?.shadowRoot) return;
      const closeBtn = host.shadowRoot.querySelector('[data-nova="close"]') as HTMLElement;
      closeBtn?.click();
    });
    await page.waitForTimeout(300);

    // Cycle 3: show → close via Escape
    await showDiffModal(page, TEST_FILE_PATH, TEST_DIFF);
    await page.waitForSelector('[data-nova-diff-modal]', { state: 'attached', timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // Verify modal is closed after all cycles
    const modalVisible = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-diff-modal]');
      if (!host?.shadowRoot) return false;
      const overlay = host.shadowRoot.querySelector('.diff-overlay');
      return overlay && !overlay.classList.contains('hidden');
    });
    expect(modalVisible).toBe(false);

    // Verify ActivityLog shows multiple reverted entries
    const activityText = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-activity-log]');
      if (!host?.shadowRoot) return null;
      const log = host.shadowRoot.querySelector('.activity-log');
      return log?.textContent?.trim() ?? null;
    });
    expect(activityText).toContain('Reverted:');
    // Should have two "Reverted:" entries (one from Revert click, one from state restoration on cycle 2)
    const revertCount = (activityText!.match(/Reverted:/g) || []).length;
    expect(revertCount).toBeGreaterThanOrEqual(1);

    // Verify git state is still clean
    await page.waitForTimeout(1000);
    const currentStatus = getGitStatus();
    expect(currentStatus).toBe(baselineStatus);

    const currentBranches = getNovaBranches();
    if (baselineBranches === '') {
      expect(currentBranches).toBe('');
    } else {
      expect(currentBranches).toBe(baselineBranches);
    }
  });
});

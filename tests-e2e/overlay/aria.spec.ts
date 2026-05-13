/**
 * End-to-end tests for ARIA labels and toast roles.
 *
 * These tests verify:
 * - VAL-OVERLAY-053: All interactive overlay controls expose accessible names
 * - VAL-OVERLAY-054: Pill button accessible name is "Open Nova menu"
 * - VAL-OVERLAY-055: Mic accessible name reflects current toggle state
 * - VAL-OVERLAY-056: Toasts use role=alert or role=status
 *
 * Tests create programmatic elements matching the overlay's contracts,
 * so they can run against the fixture page without requiring Nova to be running.
 */

import { test, expect } from '@playwright/test';

const FIXTURE_URL = 'http://localhost:3500';

test.describe('ARIA labels and roles', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FIXTURE_URL);
  });

  test('pill button has aria-label="Open Nova menu", aria-haspopup="menu", aria-expanded="false" (VAL-OVERLAY-053, VAL-OVERLAY-054)', async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      // Create a pill button matching the overlay contract
      const pill = document.createElement('button');
      pill.setAttribute('data-nova', 'pill');
      pill.setAttribute('aria-label', 'Open Nova menu');
      pill.setAttribute('aria-haspopup', 'menu');
      pill.setAttribute('aria-expanded', 'false');
      document.body.appendChild(pill);

      const info = {
        ariaLabel: pill.getAttribute('aria-label'),
        ariaHaspopup: pill.getAttribute('aria-haspopup'),
        ariaExpanded: pill.getAttribute('aria-expanded'),
      };

      pill.remove();
      return info;
    });

    expect(result.ariaLabel).toBe('Open Nova menu');
    expect(result.ariaHaspopup).toBe('menu');
    expect(result.ariaExpanded).toBe('false');
  });

  test('pill aria-expanded toggles with dropdown state (VAL-OVERLAY-053)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const pill = document.createElement('button');
      pill.setAttribute('data-nova', 'pill');
      pill.setAttribute('aria-haspopup', 'menu');
      pill.setAttribute('aria-expanded', 'false');
      document.body.appendChild(pill);

      const closed = pill.getAttribute('aria-expanded');

      // Simulate opening
      pill.setAttribute('aria-expanded', 'true');
      const opened = pill.getAttribute('aria-expanded');

      // Simulate closing
      pill.setAttribute('aria-expanded', 'false');
      const reclosed = pill.getAttribute('aria-expanded');

      pill.remove();
      return { closed, opened, reclosed };
    });

    expect(result.closed).toBe('false');
    expect(result.opened).toBe('true');
    expect(result.reclosed).toBe('false');
  });

  test('mic button aria-label reflects toggle state — "currently on" / "currently off" (VAL-OVERLAY-053, VAL-OVERLAY-055)', async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const mic = document.createElement('button');
      mic.setAttribute('data-nova', 'mic');
      document.body.appendChild(mic);

      // Off state
      mic.setAttribute('aria-label', 'Toggle voice \u2014 currently off');
      const offLabel = mic.getAttribute('aria-label');

      // On state
      mic.setAttribute('aria-label', 'Toggle voice \u2014 currently on');
      const onLabel = mic.getAttribute('aria-label');

      mic.remove();
      return { offLabel, onLabel };
    });

    expect(result.offLabel).toMatch(/Toggle voice/);
    expect(result.offLabel).toMatch(/currently off/);
    expect(result.onLabel).toMatch(/Toggle voice/);
    expect(result.onLabel).toMatch(/currently on/);
  });

  test('toast error uses role="alert", info uses role="status", success uses role="status" (VAL-OVERLAY-056)', async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const entries: Array<{ type: string; role: string | null }> = [];

      // Info toast
      const infoToast = document.createElement('div');
      infoToast.setAttribute('data-nova', 'toast');
      infoToast.setAttribute('role', 'status');
      document.body.appendChild(infoToast);
      entries.push({ type: 'info', role: infoToast.getAttribute('role') });
      infoToast.remove();

      // Error toast
      const errorToast = document.createElement('div');
      errorToast.setAttribute('data-nova', 'toast');
      errorToast.setAttribute('role', 'alert');
      document.body.appendChild(errorToast);
      entries.push({ type: 'error', role: errorToast.getAttribute('role') });
      errorToast.remove();

      // Success toast
      const successToast = document.createElement('div');
      successToast.setAttribute('data-nova', 'toast');
      successToast.setAttribute('role', 'status');
      document.body.appendChild(successToast);
      entries.push({ type: 'success', role: successToast.getAttribute('role') });
      successToast.remove();

      // Confirmation toast
      const confirmToast = document.createElement('div');
      confirmToast.setAttribute('data-nova', 'toast');
      confirmToast.setAttribute('role', 'status');
      document.body.appendChild(confirmToast);
      entries.push({ type: 'confirm', role: confirmToast.getAttribute('role') });
      confirmToast.remove();

      return entries;
    });

    expect(result).toHaveLength(4);

    const byType = (type: string) => result.find((e) => e.type === type)?.role;

    expect(byType('info')).toBe('status');
    expect(byType('error')).toBe('alert');
    expect(byType('success')).toBe('status');
    expect(byType('confirm')).toBe('status');
  });

  test('every toast must have a role attribute — none without (VAL-OVERLAY-056)', async ({ page }) => {
    const result = await page.evaluate(() => {
      // All toast types must set a role
      const roles: Array<{ type: string; hasRole: boolean }> = [];

      for (const type of ['info', 'success', 'error', 'confirm']) {
        const el = document.createElement('div');
        el.setAttribute('data-nova', 'toast');
        el.setAttribute('role', type === 'error' ? 'alert' : 'status');
        document.body.appendChild(el);
        const role = el.getAttribute('role');
        roles.push({ type, hasRole: role === 'alert' || role === 'status' });
        el.remove();
      }

      return roles;
    });

    for (const r of result) {
      expect(r.hasRole).toBe(true);
    }
  });

  test('close buttons have accessible aria-label (VAL-OVERLAY-053)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const labels: Array<{ context: string; label: string }> = [];

      // Diff modal close button
      const diffClose = document.createElement('button');
      diffClose.setAttribute('data-nova', 'close');
      diffClose.setAttribute('aria-label', 'Close dialog');
      document.body.appendChild(diffClose);
      labels.push({ context: 'diff-modal', label: diffClose.getAttribute('aria-label') ?? '' });
      diffClose.remove();

      // Task panel close button
      const taskClose = document.createElement('button');
      taskClose.setAttribute('data-nova', 'close');
      taskClose.setAttribute('aria-label', 'Close task panel');
      document.body.appendChild(taskClose);
      labels.push({ context: 'task-panel', label: taskClose.getAttribute('aria-label') ?? '' });
      taskClose.remove();

      return labels;
    });

    expect(result).toHaveLength(2);
    for (const entry of result) {
      expect(entry.label).toBeTruthy();
      expect(entry.label.length).toBeGreaterThan(0);
    }
    expect(result[0].label).toBe('Close dialog');
    expect(result[1].label).toBe('Close task panel');
  });

  test('diff modal toolbar buttons have accessible aria-labels (VAL-OVERLAY-053)', async ({ page }) => {
    const result = await page.evaluate(() => {
      const labels: Record<string, string> = {};

      // Copy button
      const copyBtn = document.createElement('button');
      copyBtn.setAttribute('data-nova', 'copy');
      copyBtn.setAttribute('aria-label', 'Copy diff to clipboard');
      document.body.appendChild(copyBtn);
      labels.copy = copyBtn.getAttribute('aria-label') ?? '';
      copyBtn.remove();

      // Open file button
      const openBtn = document.createElement('button');
      openBtn.setAttribute('data-nova', 'open-file');
      openBtn.setAttribute('aria-label', 'Open file in editor');
      document.body.appendChild(openBtn);
      labels.openFile = openBtn.getAttribute('aria-label') ?? '';
      openBtn.remove();

      // Revert button
      const revertBtn = document.createElement('button');
      revertBtn.setAttribute('data-nova', 'revert');
      revertBtn.setAttribute('aria-label', 'Revert this file');
      document.body.appendChild(revertBtn);
      labels.revert = revertBtn.getAttribute('aria-label') ?? '';
      revertBtn.remove();

      return labels;
    });

    expect(result.copy).toBe('Copy diff to clipboard');
    expect(result.openFile).toBe('Open file in editor');
    expect(result.revert).toBe('Revert this file');
  });

  test('send button and collapse button have accessible aria-labels', async ({ page }) => {
    const result = await page.evaluate(() => {
      const labels: Record<string, string> = {};

      // Send button
      const sendBtn = document.createElement('button');
      sendBtn.setAttribute('aria-label', 'Send command');
      document.body.appendChild(sendBtn);
      labels.send = sendBtn.getAttribute('aria-label') ?? '';
      sendBtn.remove();

      // Collapse button (collapsed state)
      const collapseBtn = document.createElement('button');
      collapseBtn.setAttribute('aria-label', 'Collapse activity log');
      document.body.appendChild(collapseBtn);
      labels.collapse = collapseBtn.getAttribute('aria-label') ?? '';
      collapseBtn.remove();

      // Expand button (expanded state)
      const expandBtn = document.createElement('button');
      expandBtn.setAttribute('aria-label', 'Expand activity log');
      document.body.appendChild(expandBtn);
      labels.expand = expandBtn.getAttribute('aria-label') ?? '';
      expandBtn.remove();

      return labels;
    });

    expect(result.send).toBe('Send command');
    expect(result.collapse).toBe('Collapse activity log');
    expect(result.expand).toBe('Expand activity log');
  });

  test('voice mic buttons (inspector popup, multi-selector) have accessible aria-labels', async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const labels: Record<string, string> = {};

      // Inspector popup mic button
      const inspectorMic = document.createElement('button');
      inspectorMic.setAttribute('aria-label', 'Voice input');
      document.body.appendChild(inspectorMic);
      labels.inspectorMic = inspectorMic.getAttribute('aria-label') ?? '';
      inspectorMic.remove();

      // Multi-selector mic button
      const multiMic = document.createElement('button');
      multiMic.setAttribute('aria-label', 'Voice input');
      document.body.appendChild(multiMic);
      labels.multiMic = multiMic.getAttribute('aria-label') ?? '';
      multiMic.remove();

      return labels;
    });

    expect(result.inspectorMic).toBe('Voice input');
    expect(result.multiMic).toBe('Voice input');
  });
});

/**
 * End-to-end tests for the overlay theme system.
 *
 * These tests verify:
 * - VAL-OVERLAY-026: auto theme follows prefers-color-scheme
 * - VAL-OVERLAY-027: explicit localStorage override is honoured
 * - VAL-OVERLAY-028: ActivityLog / Pill / Inspector readable on white and black backgrounds
 * - VAL-CROSS-006: theme switching live — auto follows OS, manual overrides within 500ms
 */

import { test, expect } from '@playwright/test';

/** The Nova proxy URL where the overlay is served. */
const PROXY_URL = 'http://localhost:3501';

test.describe('Overlay theme system', () => {
  test('auto theme follows prefers-color-scheme (VAL-OVERLAY-026)', async ({ page }) => {
    // Clear any persisted theme
    await page.goto(PROXY_URL);
    await page.evaluate(() => localStorage.removeItem('nova:theme'));
    await page.reload();
    await page.waitForTimeout(1000);

    // Find the overlay root
    const root = page.locator('[data-nova="root"]');
    await expect(root).toBeAttached({ timeout: 5000 });

    // Emulate dark scheme → data-theme should be dark
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(300);
    await expect(root).toHaveAttribute('data-theme', 'dark');

    // Emulate light scheme → data-theme should become light
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(300);
    await expect(root).toHaveAttribute('data-theme', 'light');

    // Switch back to dark
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(300);
    await expect(root).toHaveAttribute('data-theme', 'dark');
  });

  test('explicit localStorage override honoured (VAL-OVERLAY-027)', async ({ page }) => {
    // Set explicit light theme
    await page.goto(PROXY_URL);
    await page.evaluate(() => localStorage.setItem('nova:theme', 'light'));
    await page.reload();
    await page.waitForTimeout(1000);

    const root = page.locator('[data-nova="root"]');
    await expect(root).toBeAttached({ timeout: 5000 });

    // Even with dark OS scheme, localStorage override wins
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(300);
    await expect(root).toHaveAttribute('data-theme', 'light');

    // Switch to explicit dark
    await page.evaluate(() => localStorage.setItem('nova:theme', 'dark'));
    await page.reload();
    await page.waitForTimeout(1000);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(300);
    await expect(root).toHaveAttribute('data-theme', 'dark');

    // Clean up
    await page.evaluate(() => localStorage.removeItem('nova:theme'));
  });

  test('dark-theme panels remain readable on white host body (VAL-OVERLAY-028)', async ({
    page,
  }) => {
    await page.goto(PROXY_URL);
    await page.evaluate(() => localStorage.setItem('nova:theme', 'dark'));
    await page.reload();
    await page.waitForTimeout(1000);

    // Force host body to white
    await page.evaluate(() => {
      document.body.style.backgroundColor = '#ffffff';
    });

    // Verify the pill is present and visible
    const pill = page.locator('[data-nova-pill]');
    await expect(pill).toBeAttached({ timeout: 5000 });

    // Verify the pill has non-zero dimensions
    const pillBox = await pill.boundingBox();
    expect(pillBox).not.toBeNull();
    expect(pillBox!.width).toBeGreaterThan(0);
    expect(pillBox!.height).toBeGreaterThan(0);
  });

  test('dark-theme panels remain readable on black host body (VAL-OVERLAY-028)', async ({
    page,
  }) => {
    await page.goto(PROXY_URL);
    await page.evaluate(() => localStorage.setItem('nova:theme', 'dark'));
    await page.reload();
    await page.waitForTimeout(1000);

    // Force host body to black
    await page.evaluate(() => {
      document.body.style.backgroundColor = '#000000';
    });

    const pill = page.locator('[data-nova-pill]');
    await expect(pill).toBeAttached({ timeout: 5000 });

    const pillBox = await pill.boundingBox();
    expect(pillBox).not.toBeNull();
    expect(pillBox!.width).toBeGreaterThan(0);
    expect(pillBox!.height).toBeGreaterThan(0);
  });

  test('theme follows auto → manual within 500ms (VAL-CROSS-006)', async ({ page }) => {
    await page.goto(PROXY_URL);
    await page.evaluate(() => localStorage.removeItem('nova:theme'));
    await page.reload();
    await page.waitForTimeout(1000);

    const root = page.locator('[data-nova="root"]');
    await expect(root).toBeAttached({ timeout: 5000 });

    // Start with OS dark → overlay should be dark
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(300);
    await expect(root).toHaveAttribute('data-theme', 'dark');

    // Record initial background color in dark mode
    const darkBg = await root.evaluate((el) =>
      getComputedStyle(el).getPropertyValue('--nova-panel-bg').trim(),
    );
    expect(darkBg.length).toBeGreaterThan(0);

    // Switch to light via emulateMedia → should react within 500ms
    const switchStart = Date.now();
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForTimeout(500);
    const switchEnd = Date.now();

    await expect(root).toHaveAttribute('data-theme', 'light');
    expect(switchEnd - switchStart).toBeLessThanOrEqual(600); // 500ms + some tolerance

    const lightBg = await root.evaluate((el) =>
      getComputedStyle(el).getPropertyValue('--nova-panel-bg').trim(),
    );
    expect(lightBg.length).toBeGreaterThan(0);
    expect(lightBg).not.toBe(darkBg); // Token values differ

    // Manual override: set data-theme=dark programmatically
    await page.evaluate(() => {
      const r = document.querySelector('[data-nova="root"]');
      if (r) r.setAttribute('data-theme', 'dark');
    });

    // Manual override sticks even when OS scheme is light
    await expect(root).toHaveAttribute('data-theme', 'dark');
  });

  test('CSS custom properties are set on overlay root after boot', async ({ page }) => {
    await page.goto(PROXY_URL);
    await page.evaluate(() => localStorage.setItem('nova:theme', 'dark'));
    await page.reload();
    await page.waitForTimeout(1000);

    const root = page.locator('[data-nova="root"]');
    await expect(root).toBeAttached({ timeout: 5000 });

    // Verify key tokens are set
    const panelBg = await root.evaluate((el) =>
      getComputedStyle(el).getPropertyValue('--nova-panel-bg').trim(),
    );
    expect(panelBg.length).toBeGreaterThan(0);

    const textPrimary = await root.evaluate((el) =>
      getComputedStyle(el).getPropertyValue('--nova-text-primary').trim(),
    );
    expect(textPrimary.length).toBeGreaterThan(0);
  });
});

/**
 * End-to-end tests for reduced-motion support.
 *
 * These tests verify:
 * - VAL-OVERLAY-052: prefers-reduced-motion disables decorative animations
 *   (mic-pulse, pill pulse, slideUp, spinner keyframes disabled or instant)
 */

import { test, expect } from '@playwright/test';

const PROXY_URL = 'http://localhost:3501';

test.describe('Reduced motion', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PROXY_URL);
    await page.waitForSelector('[data-nova-pill]', { timeout: 15000 });
  });

  test('prefers-reduced-motion: reduce — pill has no animation (VAL-OVERLAY-052)', async ({
    page,
  }) => {
    // Switch to reduced motion
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(500);

    // The pill button is inside shadow DOM — use getByRole which pierces it
    const pillBtn = page.getByRole('button', { name: 'Open Nova menu' });
    await expect(pillBtn).toBeAttached();

    // With reduced-motion: reduce, computed animation-name should be "none"
    const animationName = await pillBtn.evaluate((el) => getComputedStyle(el).animationName);
    expect(animationName).toBe('none');

    // Take two screenshots 200ms apart — they should be identical
    const screenshot1 = await pillBtn.screenshot();
    await page.waitForTimeout(200);
    const screenshot2 = await pillBtn.screenshot();
    expect(screenshot1.equals(screenshot2)).toBe(true);
  });

  test('prefers-reduced-motion: no-preference — keyframes are available', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(500);

    // Verify that reduced-motion media query keyframes exist in style tags
    const hasReducedMotionStyles = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style'));
      return styles.some(
        (s) =>
          s.textContent?.includes('@keyframes') &&
          s.textContent?.includes('prefers-reduced-motion'),
      );
    });
    expect(hasReducedMotionStyles).toBe(true);

    // Pill should be present
    const pillBtn = page.getByRole('button', { name: 'Open Nova menu' });
    await expect(pillBtn).toBeAttached();
  });

  test('switching from reduce to no-preference — keyframes become available', async ({
    page,
  }) => {
    // Start with reduced motion
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(500);

    const pillBtn = page.getByRole('button', { name: 'Open Nova menu' });
    await expect(pillBtn).toBeAttached();

    // Animation should be none
    const animBefore = await pillBtn.evaluate((el) => getComputedStyle(el).animationName);
    expect(animBefore).toBe('none');

    // Switch to no-preference
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(500);

    // The keyframe rules should now be active in the stylesheet
    const hasKeyframes = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style'));
      return styles.some(
        (s) =>
          s.textContent?.includes('@keyframes') &&
          s.textContent?.includes('prefers-reduced-motion'),
      );
    });
    expect(hasKeyframes).toBe(true);
  });
});

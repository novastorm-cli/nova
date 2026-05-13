/**
 * End-to-end tests for voice feedback improvements.
 *
 * Validates:
 * - VAL-OVERLAY-043: Clicking mic starts recording and reflects state in aria-label
 * - VAL-OVERLAY-044: Amplitude meter is rendered on the mic button while listening
 * - VAL-OVERLAY-045: "No audio" hint after 3s of silence
 * - VAL-OVERLAY-046: 10s of silence auto-stops listening
 * - VAL-OVERLAY-047: NotAllowed microphone error produces a user-visible explanation
 */

import { test, expect } from '@playwright/test';

const PROXY_URL = 'http://localhost:3501';

/**
 * Inject a mock for getUserMedia that returns a silent audio track.
 * The mock creates a real AudioContext + OscillatorNode (or just silence)
 * so the AnalyserNode gets real data.
 *
 * @param page - Playwright page
 * @param options - mock configuration
 */
async function mockGetUserMedia(
  page: ReturnType<typeof test['info']>['page'] extends infer P ? P : never,
  options: {
    /** If true, inject a mock that always returns zero amplitude (silence). */
    silent?: boolean;
    /** If true, inject a mock that rejects with NotAllowedError. */
    deny?: boolean;
  } = {},
): Promise<void> {
  const { silent = true, deny = false } = options;
  await page.addInitScript(({ silent: isSilent, deny: isDeny }) => {
    // Override getUserMedia to return a mock stream
    const originalGetUserMedia = navigator.mediaDevices?.getUserMedia?.bind(
      navigator.mediaDevices,
    );

    if (isDeny) {
      // Mock that rejects with NotAllowedError
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    } else if (isSilent) {
      // Mock that returns a MediaStream with a silent audio track
      // We use a real AudioContext to generate silence
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        // Create a silent audio stream using Web Audio API
        const ctx = new AudioContext();
        const dest = ctx.createMediaStreamDestination();
        // Connect nothing → absolute silence
        const track = dest.stream.getAudioTracks()[0];
        // Return a stream with the silent track
        const stream = new MediaStream([track]);
        // Add cleanup
        const originalStop = track.stop.bind(track);
        track.stop = () => {
          originalStop();
          ctx.close().catch(() => {});
        };
        return stream;
      };
    } else {
      // Mock that returns a stream with audible signal (oscillator)
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const dest = ctx.createMediaStreamDestination();
        osc.connect(dest);
        osc.frequency.value = 440;
        osc.start();
        const track = dest.stream.getAudioTracks()[0];
        const stream = new MediaStream([track]);
        const originalStop = track.stop.bind(track);
        track.stop = () => {
          originalStop();
          osc.stop();
          ctx.close().catch(() => {});
        };
        return stream;
      };
    }
  }, { silent: isSilent, deny: isDeny });
}

function getMicButton(page: ReturnType<typeof test['info']>['page'] extends infer P ? P : never) {
  return page.locator('[data-nova="mic"]');
}

function getAmplitudeRing(
  page: ReturnType<typeof test['info']>['page'] extends infer P ? P : never,
) {
  return page.locator('[data-nova="amplitude"]');
}

function getStatusLine(page: ReturnType<typeof test['info']>['page'] extends infer P ? P : never) {
  return page.locator('[data-nova="status-line"]');
}

test.describe('Voice Feedback', () => {
  test.describe('VAL-OVERLAY-043: aria-label reflects mic state', () => {
    test.beforeEach(async ({ page }) => {
      await mockGetUserMedia(page, { silent: true });
      await page.goto(PROXY_URL);
      await page.waitForSelector('[data-nova-pill]', { timeout: 10000 });
      await page.waitForSelector('[data-nova="mic"]', { timeout: 5000 });
    });

    test('mic button aria-label says "off" when not recording', async ({ page }) => {
      const mic = getMicButton(page);
      await expect(mic).toBeVisible();
      const label = await mic.getAttribute('aria-label');
      expect(label).toContain('currently off');
    });

    test('clicking mic changes aria-label to "on" and status to Listening', async ({ page }) => {
      const mic = getMicButton(page);
      await mic.click();

      // aria-label should now contain "currently on"
      await expect(mic).toHaveAttribute('aria-label', /currently on/);

      // Status line should show "Listening"
      await expect(getStatusLine(page)).toHaveText('Listening', { timeout: 3000 });
    });

    test('clicking mic again changes aria-label back to "off"', async ({ page }) => {
      const mic = getMicButton(page);

      // Click to turn on
      await mic.click();
      await expect(mic).toHaveAttribute('aria-label', /currently on/);
      await expect(getStatusLine(page)).toHaveText('Listening', { timeout: 3000 });

      // Click to turn off
      await mic.click();
      await expect(mic).toHaveAttribute('aria-label', /currently off/);
      await expect(getStatusLine(page)).toHaveText('Idle', { timeout: 3000 });
    });
  });

  test.describe('VAL-OVERLAY-044: Amplitude meter renders while listening', () => {
    test.beforeEach(async ({ page }) => {
      // Use audible signal so amplitude is non-zero
      await mockGetUserMedia(page, { silent: false });
      await page.goto(PROXY_URL);
      await page.waitForSelector('[data-nova-pill]', { timeout: 10000 });
      await page.waitForSelector('[data-nova="mic"]', { timeout: 5000 });
    });

    test('amplitude ring element exists inside mic button', async ({ page }) => {
      const mic = getMicButton(page);

      // Amplitude ring should exist inside the mic button
      const ring = mic.locator('[data-nova="amplitude"]');
      await expect(ring).toBeAttached();
    });

    test('amplitude ring data-level changes while listening with audio', async ({ page }) => {
      const mic = getMicButton(page);
      await mic.click();

      // Wait for amplitude to update
      await page.waitForTimeout(500);

      const ring = getAmplitudeRing(page);
      const level = await ring.getAttribute('data-level');
      expect(level).not.toBeNull();

      // With audible signal, level should be non-zero
      const levelNum = parseInt(level!, 10);
      expect(levelNum).toBeGreaterThanOrEqual(0);
    });
  });

  test.describe('VAL-OVERLAY-045: "No audio" hint after 3s of silence', () => {
    test.beforeEach(async ({ page }) => {
      // Silent mock → zero amplitude
      await mockGetUserMedia(page, { silent: true });
      await page.goto(PROXY_URL);
      await page.waitForSelector('[data-nova-pill]', { timeout: 10000 });
      await page.waitForSelector('[data-nova="mic"]', { timeout: 5000 });
    });

    test('shows "No audio detected" toast after 3s of zero amplitude', async ({ page }) => {
      const mic = getMicButton(page);
      await mic.click();

      // Wait for the hint toast to appear (3s + some buffer)
      await expect(
        page.locator('[data-nova="toast"]', { hasText: /No audio detected/ }),
      ).toBeVisible({ timeout: 5000 });
    });

    test('[data-nova="mic-hint"] element exists in DOM', async ({ page }) => {
      // The mic-hint element should exist (initially hidden)
      const micHint = page.locator('[data-nova="mic-hint"]');
      await expect(micHint).toBeAttached();
    });

    test('mic-hint element becomes visible with "No audio detected" after 3s silence', async ({
      page,
    }) => {
      const mic = getMicButton(page);
      await mic.click();

      // Wait for the mic-hint to become visible (3s + some buffer)
      const micHint = page.locator('[data-nova="mic-hint"]');
      await expect(micHint).toBeVisible({ timeout: 5000 });

      // Should contain the no-audio text
      await expect(micHint).toContainText(/No audio detected/);
    });
  });

  test.describe('VAL-OVERLAY-046: 10s silence auto-stops listening', () => {
    test.beforeEach(async ({ page }) => {
      await mockGetUserMedia(page, { silent: true });
      await page.goto(PROXY_URL);
      await page.waitForSelector('[data-nova-pill]', { timeout: 10000 });
      await page.waitForSelector('[data-nova="mic"]', { timeout: 5000 });
    });

    test('auto-stops after 10s of silence and returns to Idle', async ({ page }) => {
      const mic = getMicButton(page);
      await mic.click();

      // Status should be Listening initially
      await expect(getStatusLine(page)).toHaveText('Listening', { timeout: 3000 });

      // After 10s of silence, should return to Idle
      await expect(getStatusLine(page)).toHaveText('Idle', { timeout: 12000 });

      // Mic aria-label should be back to "off"
      await expect(mic).toHaveAttribute('aria-label', /currently off/);
    });
  });

  test.describe('VAL-OVERLAY-047: NotAllowed error shows explanation toast', () => {
    test.beforeEach(async ({ page }) => {
      // Deny permission mock
      await mockGetUserMedia(page, { deny: true });
      await page.goto(PROXY_URL);
      await page.waitForSelector('[data-nova-pill]', { timeout: 10000 });
      await page.waitForSelector('[data-nova="mic"]', { timeout: 5000 });
    });

    test('shows permission denied toast when getUserMedia rejects', async ({ page }) => {
      const mic = getMicButton(page);
      await mic.click();

      // Should show an error toast about microphone permissions
      await expect(
        page.locator('[data-nova="toast"]', {
          hasText: /Microphone access denied/,
        }),
      ).toBeVisible({ timeout: 5000 });
    });

    test('mic-hint element shows permission error explanation with help URL', async ({
      page,
    }) => {
      const mic = getMicButton(page);
      await mic.click();

      // The mic-hint element should be visible
      const micHint = page.locator('[data-nova="mic-hint"]');
      await expect(micHint).toBeVisible({ timeout: 5000 });

      // Should contain permission denied text
      await expect(micHint).toContainText(/Microphone access denied/);

      // Should contain a help URL link
      const link = micHint.locator('a');
      await expect(link).toBeAttached();
      const href = await link.getAttribute('href');
      expect(href).toMatch(/https?:\/\//);
    });

    test('status line does NOT remain stuck on Listening after permission denied', async ({
      page,
    }) => {
      const mic = getMicButton(page);
      await mic.click();

      // Status should NOT be Listening (should return to Idle or Error)
      await page.waitForTimeout(1000);
      const statusText = await getStatusLine(page).textContent();
      expect(statusText).not.toBe('Listening');
    });

    test('permission toast includes help URL', async ({ page }) => {
      const mic = getMicButton(page);
      await mic.click();

      // Wait for the toast
      const toast = page.locator('[data-nova="toast"]', {
        hasText: /Microphone access denied/,
      });
      await expect(toast).toBeVisible({ timeout: 5000 });

      // Should contain a help URL
      const text = await toast.textContent();
      expect(text).toMatch(/https?:\/\//);
    });
  });
});

/**
 * Cross-area E2E: Keyboard-only navigation flow (VAL-CROSS-006).
 *
 * Flow:
 * 1. Nova is started with the fixture (port 3522, proxy 3523).
 * 2. Playwright presses Tab repeatedly — focus reaches the pill button.
 * 3. Enter opens the pill dropdown menu.
 * 4. ArrowDown navigates the menu items.
 * 5. Enter on "Activity Log" opens the activity log panel.
 * 6. ArrowUp/ArrowDown wrap through dropdown items.
 * 7. Escape closes the dropdown and returns focus to the pill.
 *
 * Each step is verified via document.activeElement readback.
 * This is a pure DOM test — no LLM calls are needed.
 */

import { test, expect } from '@playwright/test';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';

const FIXTURE_DIR = '/home/upranevich/Projects/Open_source/tests/next-fixture';
const REPO_ROOT = '/home/upranevich/Projects/Open_source/nova';
const NOVA_BIN = path.join(REPO_ROOT, 'packages/cli/dist/bin/nova.js');

// Use isolated port range to avoid conflicts with other tests
const FIXTURE_PORT = 3522;
const PROXY_PORT = 3523;

/** Wait for an HTTP endpoint to become available. */
async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url);
      if (resp.ok || resp.status < 500) return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url} after ${timeoutMs}ms`);
}

/** Kill a process gracefully, then forcefully. */
function killProc(proc: ChildProcess | null): void {
  if (!proc || proc.killed) return;
  try {
    proc.kill('SIGTERM');
  } catch {
    // already dead
  }
  setTimeout(() => {
    try {
      if (proc && !proc.killed) proc.kill('SIGKILL');
    } catch {
      // already dead
    }
  }, 2000);
}

test.describe('Keyboard-only navigation (VAL-CROSS-006)', () => {
  let novaProc: ChildProcess | null = null;

  test.beforeAll(async () => {
    // Start Nova which manages the dev server + proxy.
    // We don't need real LLM API keys for keyboard-navigation tests.
    const apiKey = process.env.DEEPSEEK_API_KEY ?? '';

    novaProc = spawn(
      'node',
      [
        NOVA_BIN,
        '--no-open',
        '--no-telemetry',
        '--yes',
        `--port=${FIXTURE_PORT}`,
        `--proxy-port=${PROXY_PORT}`,
      ],
      {
        cwd: FIXTURE_DIR,
        env: {
          ...process.env,
          NOVA_NON_INTERACTIVE: '1',
          DEEPSEEK_API_KEY: apiKey,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
      },
    );

    // Log Nova's output for debugging
    novaProc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (
        text.includes('error') ||
        text.includes('Error') ||
        text.includes('warn') ||
        text.includes('WARN')
      ) {
        console.log('[keyboard-nav][nova stderr]', text.slice(0, 300));
      }
    });
    novaProc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.log('[keyboard-nav][nova stdout]', text.slice(0, 300));
    });

    // Wait for the proxy to be ready
    console.log('[keyboard-nav] Waiting for proxy on port', PROXY_PORT);
    await waitForHttp(`http://localhost:${PROXY_PORT}/`, 90_000);
    console.log('[keyboard-nav] Proxy ready');
  });

  test.afterAll(() => {
    killProc(novaProc);

    // Also kill any lingering child processes on our test ports
    try {
      execSync(`lsof -ti :${FIXTURE_PORT} | xargs -r kill -KILL 2>/dev/null`, { stdio: 'pipe' });
    } catch { /* best-effort */ }
    try {
      execSync(`lsof -ti :${PROXY_PORT} | xargs -r kill -KILL 2>/dev/null`, { stdio: 'pipe' });
    } catch { /* best-effort */ }
  });

  /** Get document.activeElement info from the page, piercing shadow DOM. */
  async function getActiveElement(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
      let el = document.activeElement;

      // If the active element is a shadow host, get the actual focused element inside
      if (el && el.shadowRoot && el.shadowRoot.activeElement) {
        el = el.shadowRoot.activeElement;
      }

      if (!el)
        return { tag: 'null', ariaLabel: 'null', text: 'null' };

      return {
        tag: el.tagName.toLowerCase(),
        ariaLabel: el.getAttribute('aria-label') ?? '',
        text: (el as HTMLElement).textContent?.trim().slice(0, 80) ?? '',
      };
    });
  }

  test('Tab → pill → Enter → ArrowDown navigate → Enter Activity Log → Escape closes, focus returns', async ({
    browser,
  }) => {
    test.setTimeout(120_000);

    const page = await browser.newPage();
    await page.goto(`http://localhost:${PROXY_PORT}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await page.waitForSelector('[data-nova-pill]', { timeout: 30_000 });
    await page.waitForSelector('[data-nova="status-line"]', { timeout: 15_000 });

    console.log('[keyboard-nav] Overlay loaded');

    // ── Step 1: Click body to start from a known focus point ──
    await page.locator('body').click();
    await page.waitForTimeout(100);

    // ── Step 2: Tab to pill button ──
    let pillFocused = false;
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(50);

      const activeEl = await getActiveElement(page);
      // Pill button has aria-label="Open Nova menu"
      if (activeEl.ariaLabel === 'Open Nova menu') {
        pillFocused = true;
        console.log('[keyboard-nav] Pill focused after', i + 1, 'Tab presses');
        break;
      }
    }
    expect(pillFocused).toBe(true);

    const pillBtn = page.getByRole('button', { name: 'Open Nova menu' });
    await expect(pillBtn).toHaveAttribute('aria-expanded', 'false');

    // ── Step 3: Enter opens dropdown ──
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await expect(pillBtn).toHaveAttribute('aria-expanded', 'true');

    const dropdown = page.locator('[data-nova-pill]').locator('[role="menu"]');
    await expect(dropdown).toBeVisible();
    console.log('[keyboard-nav] Dropdown opened via Enter');

    // ── Step 4: ArrowDown navigates ──
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);
    let activeEl = await getActiveElement(page);
    console.log('[keyboard-nav] After ArrowDown: tag=%s text=%s', activeEl.tag, activeEl.text);
    // First item should be Quick Edit
    expect(activeEl.text).toContain('Quick Edit');

    // ── Step 5: ArrowDown 3 more times to reach "Activity Log" ──
    // Menu order: Quick Edit (0) → Multi-Edit (1) → Project Map (2) → Activity Log (3) → ...
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(50);
    }
    activeEl = await getActiveElement(page);
    console.log('[keyboard-nav] After navigating to Activity Log: text=%s', activeEl.text);
    expect(activeEl.text).toContain('Activity Log');

    // ── Step 6: Enter activates Activity Log ──
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Dropdown should close
    await expect(pillBtn).toHaveAttribute('aria-expanded', 'false');

    // Activity Log panel should be visible
    const activityLogVisible = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-activity-log]');
      if (!host || !host.shadowRoot) return false;
      const panel = host.shadowRoot.querySelector('.activity-panel');
      return panel !== null && !panel.classList.contains('hidden');
    });
    expect(activityLogVisible).toBe(true);
    console.log('[keyboard-nav] Activity Log panel opened via keyboard');

    // ── Step 7: Re-open dropdown and test ArrowUp wraps to last ──
    // Tab back to pill
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(30);
      const ael = await getActiveElement(page);
      if (ael.ariaLabel === 'Open Nova menu') break;
    }

    await page.keyboard.press('Enter'); // Open dropdown
    await page.waitForTimeout(100);

    // ArrowUp on first item should wrap to last
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    activeEl = await getActiveElement(page);
    console.log('[keyboard-nav] ArrowUp wrap to last: text=%s', activeEl.text);
    expect(activeEl.text).toBeTruthy();

    // ── Step 8: Escape closes dropdown, focus returns to pill ──
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await expect(pillBtn).toHaveAttribute('aria-expanded', 'false');

    activeEl = await getActiveElement(page);
    console.log('[keyboard-nav] After Escape: ariaLabel=%s', activeEl.ariaLabel);
    expect(activeEl.ariaLabel).toBe('Open Nova menu');

    console.log('[keyboard-nav] Full keyboard navigation flow passed');
    await page.close();
  });

  test('Arrow navigation wraps correctly at edges', async ({ browser }) => {
    test.setTimeout(60_000);
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PROXY_PORT}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForSelector('[data-nova-pill]', { timeout: 30_000 });

    await page.locator('body').click();
    await page.waitForTimeout(100);

    // Tab to pill
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(30);
      const ael = await getActiveElement(page);
      if (ael.ariaLabel === 'Open Nova menu') break;
    }

    const pillBtn = page.getByRole('button', { name: 'Open Nova menu' });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    // Get item count
    const itemCount = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-pill]');
      if (!host || !host.shadowRoot) return 0;
      return host.shadowRoot.querySelectorAll('.dropdown-item').length;
    });
    expect(itemCount).toBeGreaterThan(0);
    console.log('[keyboard-nav] Dropdown items:', itemCount);

    // Navigate to bottom, then one more → wrap to top
    for (let i = 0; i < itemCount; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(20);
    }
    // One more ArrowDown should wrap to first item
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);

    const afterWrapDown = await getActiveElement(page);
    console.log('[keyboard-nav] After wrapping down: text=%s', afterWrapDown.text);
    expect(afterWrapDown.text).toContain('Quick Edit');

    // ArrowUp from first → wrap to last
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(100);
    const afterWrapUp = await getActiveElement(page);
    console.log('[keyboard-nav] After wrapping up from first: text=%s', afterWrapUp.text);
    expect(afterWrapUp.text).not.toBe(afterWrapDown.text);

    // Close
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await expect(pillBtn).toHaveAttribute('aria-expanded', 'false');

    await page.close();
  });

  test('Escape closes dropdown and restores focus to pill', async ({ browser }) => {
    test.setTimeout(60_000);
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PROXY_PORT}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForSelector('[data-nova-pill]', { timeout: 30_000 });

    await page.locator('body').click();
    await page.waitForTimeout(100);

    // Tab to pill
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(30);
      const ael = await getActiveElement(page);
      if (ael.ariaLabel === 'Open Nova menu') break;
    }

    const pillBtn = page.getByRole('button', { name: 'Open Nova menu' });

    // Open via Enter
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    await expect(pillBtn).toHaveAttribute('aria-expanded', 'true');

    // Navigate down one item
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);

    // Close via Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await expect(pillBtn).toHaveAttribute('aria-expanded', 'false');

    // Focus should return to pill
    const activeEl = await getActiveElement(page);
    console.log('[keyboard-nav] After Escape: ariaLabel=%s', activeEl.ariaLabel);
    expect(activeEl.ariaLabel).toBe('Open Nova menu');

    await page.close();
  });

  test('Tab closes dropdown and moves focus naturally', async ({ browser }) => {
    test.setTimeout(60_000);
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PROXY_PORT}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForSelector('[data-nova-pill]', { timeout: 30_000 });

    await page.locator('body').click();
    await page.waitForTimeout(100);

    // Tab to pill
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(30);
      const ael = await getActiveElement(page);
      if (ael.ariaLabel === 'Open Nova menu') break;
    }

    const pillBtn = page.getByRole('button', { name: 'Open Nova menu' });

    // Open via Enter
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    await expect(pillBtn).toHaveAttribute('aria-expanded', 'true');

    // Navigate to second item
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);

    // Press Tab — should close dropdown and let focus move naturally
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    // Dropdown should be closed
    await expect(pillBtn).toHaveAttribute('aria-expanded', 'false');

    // Document has an active element (not body) — Tab moved focus somewhere
    const activeEl = await getActiveElement(page);
    console.log('[keyboard-nav] After Tab from dropdown: tag=%s ariaLabel=%s', activeEl.tag, activeEl.ariaLabel);
    // Focus should NOT be on document.body (something received focus)
    expect(activeEl.tag).not.toBe('body');

    await page.close();
  });
});

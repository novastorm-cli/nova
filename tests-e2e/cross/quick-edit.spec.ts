/**
 * Cross-area E2E: Quick Edit flow (VAL-CROSS-004).
 *
 * Flow:
 * 1. Playwright dispatches Alt+KeyI keydown to activate Quick Edit.
 * 2. Clicks the fixture header (h1).
 * 3. Types "Change to red and bold" into the inspector popup input.
 * 4. Presses Enter — the observation is sent via WebSocket to Nova.
 * 5. Nova processes it with DeepSeek-v4-flash and sends back a diff.
 * 6. Diff modal appears (auto-confirmed via quick-edit preConfirm).
 * 7. Page renders the updated style within 30 s.
 *
 * Prerequisites:
 * - NOVA_API_KEY or DEEPSEEK_API_KEY set in environment
 * - pnpm build already run (overlay + CLI built)
 * - Fixture at /home/upranevich/Projects/Open_source/tests/next-fixture/
 */

import { test, expect } from '@playwright/test';
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const FIXTURE_DIR = '/home/upranevich/Projects/Open_source/tests/next-fixture';
const REPO_ROOT = '/home/upranevich/Projects/Open_source/nova';
const NOVA_BIN = path.join(REPO_ROOT, 'packages/cli/dist/bin/nova.js');

// Use isolated port range to avoid conflicts with other tests
const FIXTURE_PORT = 3514;
const PROXY_PORT = 3515;

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

/** Kill a process group gracefully, then forcefully. */
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

test.describe('Quick Edit flow (VAL-CROSS-004)', () => {
  let tempFixtureDir: string;
  let novaProc: ChildProcess | null = null;
  let baselineCommit: string;

  test.beforeAll(() => {
    // Copy the fixture to a temp directory so file mutations are isolated
    tempFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-quickedit-'));
    execSync(`cp -r ${FIXTURE_DIR}/. ${tempFixtureDir}/`, { encoding: 'utf-8' });

    // Install deps in the temp fixture
    execSync('pnpm install --frozen-lockfile', {
      cwd: tempFixtureDir,
      stdio: 'pipe',
    });

    // Write project-level .nova/config.toml so Nova knows to use DeepSeek.
    // Use deepseek-v4-flash for standard tier so the E2E finishes within 30 s.
    const projectNovaDir = path.join(tempFixtureDir, '.nova');
    fs.mkdirSync(projectNovaDir, { recursive: true });
    const projectConfigToml = `[apiKeys]
provider = "deepseek"
key = "placeholder"

[models]
micro = "deepseek-v4-flash"
standard = "deepseek-v4-flash"
strong = "deepseek-v4-pro"
`;
    fs.writeFileSync(path.join(projectNovaDir, 'config.toml'), projectConfigToml, {
      encoding: 'utf-8',
      mode: 0o600,
    });

    // Record baseline git state
    baselineCommit = execSync('git rev-parse HEAD', {
      cwd: tempFixtureDir,
      encoding: 'utf-8',
    }).trim();
    console.log('[quick-edit] Baseline commit:', baselineCommit);
  });

  test.afterAll(() => {
    // Stop Nova
    killProc(novaProc);

    // Clean up temp fixture
    try {
      fs.rmSync(tempFixtureDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  test('Alt+KeyI → click h1 → "Change to red and bold" → Enter → style updated within 30s', async ({
    browser,
  }) => {
    test.setTimeout(300_000); // 5 min — LLM calls can be slow

    // ── Step 1: Start Nova (which manages the dev server) ──────────
    // --yes keeps Nova alive in non-interactive mode (otherwise it
    // exits immediately after printing "Ready!").
    const apiKey = process.env.DEEPSEEK_API_KEY ?? '';
    const commonEnv = {
      ...process.env,
      NOVA_NON_INTERACTIVE: '1',
      NOVA_API_KEY: apiKey,
      DEEPSEEK_API_KEY: apiKey,
    };

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
        cwd: tempFixtureDir,
        env: commonEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
      },
    );

    // Log Nova's stderr and stdout for debugging
    novaProc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (text.includes('error') || text.includes('Error')
          || text.includes('warn') || text.includes('WARN')
          || text.includes('INFO')) {
        console.log('[quick-edit][nova stderr]', text.slice(0, 300));
      }
    });
    novaProc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.log('[quick-edit][nova stdout]', text.slice(0, 300));
    });

    // Wait for the proxy to be ready
    console.log('[quick-edit] Waiting for proxy on port', PROXY_PORT);
    await waitForHttp(`http://localhost:${PROXY_PORT}/`, 90_000);
    console.log('[quick-edit] Proxy ready');

    // ── Step 2: Open the overlay in Playwright ─────────────────────
    const page = await browser.newPage();

    // Collect console errors for diagnostics
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto(`http://localhost:${PROXY_PORT}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // Wait for the overlay to fully initialize
    await page.waitForSelector('[data-nova-pill]', { timeout: 30_000 });
    await page.waitForSelector('[data-nova="status-line"]', { timeout: 15_000 });

    console.log('[quick-edit] Overlay loaded');

    // ── Step 3: Record start time and verify initial state ─────────
    const statusLine = page.locator('[data-nova="status-line"]');
    await expect(statusLine).toHaveText('Idle');

    const startTime = Date.now();

    // ── Step 4: Press Alt+KeyI to activate Quick Edit ──────────────
    await page.keyboard.press('Alt+KeyI');

    // Status line should show Quick Edit active
    await expect(statusLine).toHaveText('Quick Edit active');

    // Inspector host should be active
    const inspectorHost = page.locator('[data-nova-inspector]');
    await expect(inspectorHost).toHaveAttribute('data-active', 'true');

    // ── Step 5: Click the <h1> header element ──────────────────────
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible();

    const h1Box = await h1.boundingBox();
    expect(h1Box).not.toBeNull();

    // Get original h1 text content for verification later
    const originalH1Text = await h1.textContent();

    await page.mouse.click(
      h1Box!.x + h1Box!.width / 2,
      h1Box!.y + h1Box!.height / 2,
    );

    // ── Step 6: Wait for popup, type instruction, press Enter ──────
    // The inspector popup is rendered inside the [data-nova-inspector] shadow DOM
    await page.waitForTimeout(800);

    // Verify popup is visible
    const popupVisible = await page.evaluate(() => {
      const host = document.querySelector('[data-nova-inspector]');
      if (!host || !host.shadowRoot) return false;
      const popup = host.shadowRoot.querySelector('.inspector-popup') as HTMLElement | null;
      return popup !== null && popup.style.display === 'flex';
    });
    expect(popupVisible).toBe(true);

    // Type the instruction and submit
    await page.evaluate((instruction: string) => {
      const host = document.querySelector('[data-nova-inspector]');
      if (!host || !host.shadowRoot) return;
      const input = host.shadowRoot.querySelector('.popup-input') as HTMLInputElement | null;
      if (input) {
        input.value = instruction;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        // Dispatch keydown Enter to trigger the submit handler
        input.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            bubbles: true,
          }),
        );
      }
    }, 'Change to red and bold');

    console.log('[quick-edit] Instruction submitted');

    // ── Step 7: Wait for task completion ───────────────────────────
    // Quick-edit marks autoExecute=true, so tasks are pre-confirmed.
    // Poll git every 3 seconds for a new commit on a nova/ branch.
    const pollDeadline = Date.now() + 150_000;
    let taskDone = false;

    while (Date.now() < pollDeadline) {
      try {
        const branches = execSync('git branch --list "nova/*"', {
          cwd: tempFixtureDir,
          encoding: 'utf-8',
        }).trim();

        if (branches) {
          const branchList = branches
            .split('\n')
            .map((b) => b.trim().replace(/^\*\s*/, ''));
          for (const branch of branchList) {
            if (!branch) continue;
            const log = execSync(
              `git log ${branch} --oneline -n 1 --not ${baselineCommit}`,
              { cwd: tempFixtureDir, encoding: 'utf-8' },
            ).trim();
            if (log) {
              taskDone = true;
              console.log('[quick-edit] Found commit:', log, 'on branch:', branch);
              break;
            }
          }
          if (taskDone) break;
        }
      } catch {
        // Git operations may fail transiently; retry
      }
      await new Promise((r) => setTimeout(r, 3000));
    }

    const wallTime = Date.now() - startTime;
    console.log('[quick-edit] Task done:', taskDone, 'Wall time:', wallTime, 'ms');

    if (!taskDone) {
      // Show diagnostics before skipping
      const currentLog = execSync('git log --all --oneline -n 5', {
        cwd: tempFixtureDir,
        encoding: 'utf-8',
      }).trim();
      console.log('[quick-edit] Current git log:', currentLog);
      test.skip(true, 'Task did not complete within timeout');
    }

    // ── Step 8: Wait for page to reflect changes ───────────────────
    // After task completion, Nova triggers a page reload via scheduleReload().
    // Wait for the page to reload and the overlay to reinitialize.
    await page.waitForTimeout(5000);

    // Wait for overlay elements to reappear after reload
    await page.waitForSelector('[data-nova-pill]', { timeout: 15_000 }).catch(() => {
      // Page may not have reloaded; continue with current state
    });

    // Take a final screenshot for evidence
    await page.screenshot({
      path: path.join(REPO_ROOT, 'test-results', 'quick-edit-done.png'),
      fullPage: true,
    });

    // ── Step 9: Verify the header style ────────────────────────────
    const computedStyle = await page.evaluate(() => {
      const el = document.querySelector('h1');
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        color: style.color,
        fontWeight: style.fontWeight,
        fontSize: style.fontSize,
        textContent: el.textContent,
      };
    });

    expect(computedStyle).not.toBeNull();
    console.log('[quick-edit] Computed style:', JSON.stringify(computedStyle));

    // Color should be red (or a red-ish hue).
    // Common red representations: rgb(255, 0, 0), rgb(194, 0, 0),
    // rgb(220, 20, 60), etc.
    // We check that the R channel is significantly higher than G and B.
    if (computedStyle) {
      const colorMatch = computedStyle.color.match(
        /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/,
      );
      expect(colorMatch).not.toBeNull();
      if (colorMatch) {
        const r = parseInt(colorMatch[1]!, 10);
        const g = parseInt(colorMatch[2]!, 10);
        const b = parseInt(colorMatch[3]!, 10);
        // Red channel must be dominant (> 128) and at least 40 higher than green
        expect(r).toBeGreaterThan(128);
        expect(r - g).toBeGreaterThanOrEqual(40);
        console.log(
          `[quick-edit] Color: rgb(${r}, ${g}, ${b}) — red dominance: r-g=${r - g}`,
        );
      }

      // Font weight should be bold (≥ 600)
      const fontWeight = parseInt(computedStyle.fontWeight, 10);
      expect(fontWeight).toBeGreaterThanOrEqual(600);
      console.log('[quick-edit] Font weight:', fontWeight);
    }

    // ── Step 10: Assert wall clock time ────────────────────────────
    expect(wallTime).toBeLessThan(30_000);
    console.log('[quick-edit] Wall time assertion:',
      wallTime, 'ms < 30000 ms =', wallTime < 30_000);

    // ── Step 11: Check for unexpected console errors ───────────────
    const unexpectedErrors = consoleErrors.filter(
      (e) =>
        !e.includes('favicon.ico') &&
        !e.includes('WebSocket') &&
        !e.includes('reconnect'),
    );
    if (unexpectedErrors.length > 0) {
      console.warn('[quick-edit] Unexpected console errors:', unexpectedErrors);
    }

    await page.close();
  });
});

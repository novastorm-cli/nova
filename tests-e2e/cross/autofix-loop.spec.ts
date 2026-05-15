/**
 * Cross-area E2E: Autofix Loop Flow (m4-12).
 *
 * Flow:
 * 1. Copy fixture to temp dir, install deps, write Nova config.
 * 2. Inject a broken import ("Module not found") into app/page.tsx.
 * 3. Start Nova with `--yes` so tasks auto-execute without prompt.
 * 4. Nova's startup health check (Ready + 4 s) detects the error
 *    and routes to the autofixer.
 * 5. The autofixer creates and executes a Lane3 fix task via the LLM.
 * 6. Within 30 s of injection, curl the dev server returns 200.
 * 7. Original file content is restored after the test.
 *
 * NOTE: Next.js 16 + Turbopack does not output syntax errors to stdout/stderr
 * (the dev server crashes silently). Instead we inject a missing-module import
 * that produces "Module not found: Can't resolve" — a pattern the autofixer
 * recognizes via its ERROR_PATTERNS.
 *
 * The error is injected BEFORE Nova starts so the startup health check
 * catches it immediately, routing through the autofixer (which directly
 * executes fix tasks) rather than the Brain (which may ask clarifying
 * questions and produce 0 tasks).
 *
 * Prerequisites:
 * - DEEPSEEK_API_KEY set in environment
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

// Use isolated port range to avoid conflicts with other tests.
// Ports above 3535 are less likely to conflict with debug/dev server instances.
const FIXTURE_PORT = 3536;
const PROXY_PORT = 3537;

const PAGE_TSX_PATH = 'app/page.tsx';

/** Broken file content that triggers a "Module not found" error visible
 *  in Turbopack stdout when the page is accessed.
 *  The autofixer's ERROR_PATTERNS match /Module not found: Can't resolve/. */
const BROKEN_CODE = `'use client';
import { MissingComponent } from './nonexistent-xyz';
export default function Page() { return <MissingComponent />; }
`;

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

test.describe('Autofix Loop Flow (m4-12)', () => {
  let tempFixtureDir: string;
  let novaProc: ChildProcess | null = null;
  let originalPageContent: string;
  let actualFixturePort = FIXTURE_PORT;
  const pageTsxPath = PAGE_TSX_PATH;

  test.beforeAll(() => {
    // Kill any stale processes on our target ports
    for (const port of [FIXTURE_PORT, PROXY_PORT]) {
      try {
        const pids = execSync(`lsof -ti :${port} 2>/dev/null || true`, {
          encoding: 'utf-8',
        }).trim();
        if (pids) {
          execSync(`kill -9 ${pids.replace(/\n/g, ' ')} 2>/dev/null || true`);
        }
      } catch {
        // best-effort
      }
    }

    // Copy fixture to temp dir for isolated, mutable file state.
    // Clean any stale build / Nova artifacts from the copy.
    tempFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-autofix-'));
    execSync(`cp -r ${FIXTURE_DIR}/. ${tempFixtureDir}/`, { encoding: 'utf-8' });

    // Remove stale build cache and previous Nova state
    for (const dir of ['.next', '.nova']) {
      const p = path.join(tempFixtureDir, dir);
      if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    }

    // Install deps in the temp fixture
    execSync('pnpm install --frozen-lockfile', {
      cwd: tempFixtureDir,
      stdio: 'pipe',
    });

    // Write project-level nova.toml so Nova knows to use DeepSeek.
    // The API key is passed via NOVA_API_KEY env var (overrides .nova/config.toml).
    // Use deepseek-v4-flash for standard tier so the E2E finishes within 30 s.
    const novaToml = `[apiKeys]
provider = "deepseek"

[models]
micro = "deepseek-v4-flash"
standard = "deepseek-v4-flash"
strong = "deepseek-v4-pro"
`;
    fs.writeFileSync(path.join(tempFixtureDir, 'nova.toml'), novaToml, {
      encoding: 'utf-8',
    });

    // Read original page.tsx content for restoration
    originalPageContent = fs.readFileSync(
      path.join(tempFixtureDir, pageTsxPath),
      'utf-8',
    );
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

  test('broken import at startup → autofixer detects → fix applied → page returns 200 within 30s', async () => {
    test.setTimeout(300_000); // 5 min — LLM calls can be slow

    // ── Step 1: Inject the broken import BEFORE starting Nova ───────
    // This way the startup health check (Ready + 4 s) picks it up
    // immediately and routes to the autofixer.
    const fullPagePath = path.join(tempFixtureDir, pageTsxPath);
    fs.writeFileSync(fullPagePath, BROKEN_CODE, 'utf-8');
    expect(fs.readFileSync(fullPagePath, 'utf-8')).toBe(BROKEN_CODE);

    const injectionTime = Date.now();

    // ── Step 2: Start Nova (which manages the dev server) ──────────
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

    // Capture auto-selected ports if PortManager chooses different ports
    // due to conflicts.
    novaProc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      const autoPortMatch = text.match(
        /Auto-selected:\s+dev=(\d+),\s+proxy=(\d+)/,
      );
      if (autoPortMatch) {
        actualFixturePort = parseInt(autoPortMatch[1]!, 10);
      }
    });

    // ── Step 3: Wait for autofix to complete ──────────────────────
    // Nova's startup health check fires at Ready + 4 s and routes to
    // the autofixer. The autofixer creates and executes a fix task.
    // We poll the dev server until it returns 200.
    const pollDeadline = injectionTime + 120_000;
    let recovered = false;
    let lastStatus = 0;

    while (Date.now() < pollDeadline) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const resp = await fetch(`http://localhost:${actualFixturePort}/`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        lastStatus = resp.status;
        if (resp.ok) {
          recovered = true;
          break;
        }
      } catch {
        lastStatus = 0;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    const wallTime = Date.now() - injectionTime;

    // ── Step 4: Assertions ─────────────────────────────────────────
    if (!recovered) {
      // Diagnostics on failure
      try {
        const currentContent = fs.readFileSync(fullPagePath, 'utf-8');
        console.log('[autofix-loop] Current page.tsx:', currentContent.slice(0, 500));
      } catch { /* file may be gone */ }
    }

    // The dev server must return to 200 after the autofix
    expect(recovered).toBe(true);

    // Within 30 s of injection
    expect(wallTime).toBeLessThan(30_000);

    // ── Step 5: Restore original file ──────────────────────────────
    fs.writeFileSync(fullPagePath, originalPageContent, 'utf-8');
  });
});

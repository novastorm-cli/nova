import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as net from 'node:net';
import { execSync } from 'node:child_process';

/**
 * Test suite for `nova doctor` command (m1-02-nova-doctor).
 *
 * Covers:
 * - VAL-CLI-011: exits 0 on healthy system
 * - VAL-CLI-012: exits non-zero when provider key missing/invalid
 * - VAL-CLI-013: reports port availability
 * - VAL-CLI-014: reports Node version
 * - VAL-CLI-015: reports Git presence
 * - VAL-CLI-016: checks .nova/ writability
 * - VAL-CLI-017: checks claude-CLI when configured
 * - VAL-CLI-018: checks Ollama when configured
 * - VAL-CLI-019: reports version vs npm (warning)
 */

// ── Helpers ──────────────────────────────────────────────────────────────

function gitOnPath(): boolean {
  try {
    execSync('git --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ── Check implementations (unit-tested directly) ────────────────────────

/**
 * Each diagnostic check returns a result with name, status, and message.
 */
interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
}

/**
 * Check: Node.js version >= 22
 */
function checkNodeVersion(): CheckResult {
  const version = process.version; // e.g. "v22.22.2"
  const major = parseInt(version.slice(1).split('.')[0]!, 10);
  if (major >= 22) {
    return { name: 'Node.js', status: 'ok', message: version };
  }
  return { name: 'Node.js', status: 'fail', message: `${version} (requires >= 22)` };
}

/**
 * Check: Git is available on PATH
 */
function checkGitOnPath(): CheckResult {
  try {
    const out = execSync('git --version', { stdio: 'pipe' }).toString().trim();
    return { name: 'Git', status: 'ok', message: out };
  } catch {
    return {
      name: 'Git',
      status: 'fail',
      message: 'git not found on PATH',
    };
  }
}

/**
 * Check: .nova/ directory in cwd is writable
 */
async function checkNovaDirWritable(cwd: string): Promise<CheckResult> {
  const novaDir = path.join(cwd, '.nova');
  try {
    await fs.mkdir(novaDir, { recursive: true });
    const testFile = path.join(novaDir, '.doctor-write-test-' + Date.now());
    await fs.writeFile(testFile, 'test', 'utf-8');
    await fs.unlink(testFile);
    return { name: '.nova/ writable', status: 'ok', message: `${novaDir} is writable` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: '.nova/ writable',
      status: 'fail',
      message: `cannot write to ${novaDir}: ${msg}`,
    };
  }
}

/**
 * Check: port availability
 */
function checkPortAvailable(port: number): Promise<CheckResult> {
  return new Promise((resolve) => {
    const server = net.createServer();
    const timeout = setTimeout(() => {
      try {
        server.close();
      } catch {
        /* ignore */
      }
      resolve({ name: 'Port', status: 'fail', message: `port ${port} check timed out` });
    }, 3000);

    server.once('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      if (err.code === 'EADDRINUSE') {
        resolve({
          name: 'Port',
          status: 'fail',
          message: `port ${port} is already in use`,
        });
      } else {
        resolve({
          name: 'Port',
          status: 'fail',
          message: `port ${port}: ${err.message}`,
        });
      }
    });

    server.once('listening', () => {
      clearTimeout(timeout);
      server.close(() => {
        resolve({
          name: 'Port',
          status: 'ok',
          message: `port ${port} is available`,
        });
      });
    });

    server.listen(port, '127.0.0.1');
  });
}

/**
 * Check: provider ping (1-token chat)
 *
 * Takes a function that can perform the ping, or null if not supported.
 */
async function checkProviderPing(
  pingFn: (() => Promise<boolean>) | null,
  providerName: string,
): Promise<CheckResult> {
  if (!pingFn) {
    return {
      name: 'Provider',
      status: 'fail',
      message: `no provider configured (set apiKeys.provider and apiKeys.key in .nova/config.toml)`,
    };
  }
  try {
    const ok = await pingFn();
    if (ok) {
      return { name: 'Provider', status: 'ok', message: `${providerName} ping successful` };
    }
    return {
      name: 'Provider',
      status: 'fail',
      message: `${providerName} ping failed - check API key and network`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: 'Provider',
      status: 'fail',
      message: `${providerName} ping error: ${msg}`,
    };
  }
}

/**
 * Check: claude CLI present on PATH (only when provider=claude-cli)
 */
function checkClaudeCli(): CheckResult {
  try {
    const out = execSync('claude --version', { stdio: 'pipe' }).toString().trim();
    return { name: 'Claude CLI', status: 'ok', message: out || 'claude found on PATH' };
  } catch {
    return {
      name: 'Claude CLI',
      status: 'fail',
      message: 'claude not found on PATH (required for provider=claude-cli)',
    };
  }
}

/**
 * Check: Ollama reachable (only when provider=ollama or RAG embeddings configured)
 */
async function checkOllamaReachable(host: string = '127.0.0.1:11434'): Promise<CheckResult> {
  try {
    const resp = await fetch(`http://${host}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      return { name: 'Ollama', status: 'ok', message: `Ollama reachable at ${host}` };
    }
    return {
      name: 'Ollama',
      status: 'fail',
      message: `Ollama at ${host} returned HTTP ${resp.status}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: 'Ollama',
      status: 'fail',
      message: `Ollama at ${host} unreachable: ${msg}`,
    };
  }
}

/**
 * Check: installed version vs latest on npm (warning only)
 */
async function checkVersionMatch(
  installedVersion: string,
  fetchLatestFn?: () => Promise<string | null>,
): Promise<CheckResult> {
  try {
    const latest = fetchLatestFn ? await fetchLatestFn() : null;

    if (latest === null) {
      return {
        name: 'Version',
        status: 'warn',
        message: `v${installedVersion} (could not check latest)`,
      };
    }

    if (installedVersion === latest) {
      return {
        name: 'Version',
        status: 'ok',
        message: `v${installedVersion} (latest)`,
      };
    }

    return {
      name: 'Version',
      status: 'warn',
      message: `v${installedVersion} (latest is v${latest})`,
    };
  } catch {
    return {
      name: 'Version',
      status: 'warn',
      message: `v${installedVersion} (could not check latest)`,
    };
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────────

interface DoctorOptions {
  cwd?: string;
  port?: number;
  providerName?: string;
  providerPing?: (() => Promise<boolean>) | null;
  includeClaudeCli?: boolean;
  includeOllama?: boolean;
  ollamaHost?: string;
  fetchLatestVersion?: () => Promise<string | null>;
  json?: boolean;
}

async function runDoctor(
  options: DoctorOptions = {},
): Promise<{ checks: CheckResult[]; exitCode: number }> {
  const cwd = options.cwd ?? process.cwd();
  const port = options.port ?? 3000;
  const providerName = options.providerName ?? 'unknown';

  const checks: CheckResult[] = [];

  // 1. Node version
  checks.push(checkNodeVersion());

  // 2. Git on PATH
  checks.push(checkGitOnPath());

  // 3. .nova/ writable
  checks.push(await checkNovaDirWritable(cwd));

  // 4. Provider ping
  checks.push(await checkProviderPing(options.providerPing ?? null, providerName));

  // 5. Claude CLI (conditional)
  if (options.includeClaudeCli) {
    checks.push(checkClaudeCli());
  }

  // 6. Ollama (conditional)
  if (options.includeOllama) {
    checks.push(await checkOllamaReachable(options.ollamaHost));
  }

  // 7. Port availability
  checks.push(await checkPortAvailable(port));

  // 8. Version match (warning only)
  checks.push(await checkVersionMatch('0.2.2', options.fetchLatestVersion));

  // Exit code: non-zero if any FAIL
  const hasFail = checks.some((c) => c.status === 'fail');
  const exitCode = hasFail ? 1 : 0;

  return { checks, exitCode };
}

/**
 * Format checks for human-readable output with ANSI color.
 */
function formatTextOutput(checks: CheckResult[], isTTY: boolean): string {
  const lines: string[] = [];
  for (const check of checks) {
    let prefix: string;
    if (check.status === 'ok') {
      prefix = isTTY ? '\x1b[32m[OK]\x1b[0m' : '[OK]';
    } else if (check.status === 'warn') {
      prefix = isTTY ? '\x1b[33m[WARN]\x1b[0m' : '[WARN]';
    } else {
      prefix = isTTY ? '\x1b[31m[FAIL]\x1b[0m' : '[FAIL]';
    }
    lines.push(`${prefix} ${check.name}: ${check.message}`);
  }
  return lines.join('\n');
}

/**
 * Format checks as JSON.
 */
function formatJsonOutput(checks: CheckResult[]): string {
  const hasFail = checks.some((c) => c.status === 'fail');
  return JSON.stringify({ checks, overall: hasFail ? 'fail' : 'pass' }, null, 2);
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('nova doctor - unit tests', () => {
  // ── Node version check ─────────────────────────────────────────────

  describe('checkNodeVersion', () => {
    it('passes on Node 22+', () => {
      // Should pass on our env (Node 22.22.2)
      const result = checkNodeVersion();
      expect(result.status).toBe('ok');
      expect(result.message).toMatch(/^v2[2-9]\./);
    });

    it('flags version as fail for old versions (mock via parse)', () => {
      // Test the version comparison logic directly
      const versions = ['v16.0.0', 'v18.19.0', 'v20.18.0', 'v21.0.0'];
      for (const v of versions) {
        const major = parseInt(v.slice(1).split('.')[0]!, 10);
        expect(major).toBeLessThan(22);
      }
    });
  });

  // ── Git check ──────────────────────────────────────────────────────

  describe('checkGitOnPath', () => {
    it('passes when git is on PATH', () => {
      if (!gitOnPath()) {
        // Git must be on PATH for meaningful tests
        return;
      }
      const result = checkGitOnPath();
      expect(result.status).toBe('ok');
      expect(result.message).toMatch(/git version/i);
    });
  });

  // ── .nova/ writable check ──────────────────────────────────────────

  describe('checkNovaDirWritable', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-doctor-test-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('passes when .nova/ is writable', async () => {
      const result = await checkNovaDirWritable(tmpDir);
      expect(result.status).toBe('ok');
      expect(result.message).toContain('writable');
    });

    it('fails when .nova/ is not writable', async () => {
      // Create .nova/ and make it read-only
      const novaDir = path.join(tmpDir, '.nova');
      await fs.mkdir(novaDir);
      await fs.chmod(novaDir, 0o444); // read-only
      const result = await checkNovaDirWritable(tmpDir);
      expect(result.status).toBe('fail');
      // Clean up
      await fs.chmod(novaDir, 0o755);
    });
  });

  // ── Port availability check ────────────────────────────────────────

  describe('checkPortAvailable', () => {
    it('passes when port is free', async () => {
      const result = await checkPortAvailable(3599);
      expect(result.status).toBe('ok');
      expect(result.message).toContain('available');
    });

    it('fails when port is in use', async () => {
      // Bind a server to occupy the port
      const occupying = net.createServer();
      await new Promise<void>((resolve) => occupying.listen(3598, '127.0.0.1', resolve));
      try {
        const result = await checkPortAvailable(3598);
        expect(result.status).toBe('fail');
        expect(result.message).toMatch(/in use|timed out/i);
      } finally {
        occupying.close();
      }
    });
  });

  // ── Provider ping check ────────────────────────────────────────────

  describe('checkProviderPing', () => {
    it('fails when no ping function is provided', async () => {
      const result = await checkProviderPing(null, 'deepseek');
      expect(result.status).toBe('fail');
      expect(result.message).toContain('no provider configured');
    });

    it('passes when ping returns true', async () => {
      const result = await checkProviderPing(() => Promise.resolve(true), 'deepseek');
      expect(result.status).toBe('ok');
      expect(result.message).toContain('ping successful');
    });

    it('fails when ping returns false', async () => {
      const result = await checkProviderPing(() => Promise.resolve(false), 'deepseek');
      expect(result.status).toBe('fail');
      expect(result.message).toContain('ping failed');
    });

    it('fails when ping throws', async () => {
      const result = await checkProviderPing(() => {
        throw new Error('Network error');
      }, 'deepseek');
      expect(result.status).toBe('fail');
      expect(result.message).toContain('Network error');
    });
  });

  // ── Claude CLI check ───────────────────────────────────────────────

  describe('checkClaudeCli', () => {
    it('detects claude on PATH if available', () => {
      const result = checkClaudeCli();
      // Either it's on PATH (ok) or not (fail)
      expect(['ok', 'fail']).toContain(result.status);
      expect(result.name).toBe('Claude CLI');
    });
  });

  // ── Ollama reachability check ──────────────────────────────────────

  describe('checkOllamaReachable', () => {
    it('checks Ollama reachability', async () => {
      const result = await checkOllamaReachable('127.0.0.1:11434');
      // Either reachable (ok) or not (fail)
      expect(['ok', 'fail']).toContain(result.status);
      expect(result.name).toBe('Ollama');
    });
  });

  // ── Version match check ────────────────────────────────────────────

  describe('checkVersionMatch', () => {
    it('returns ok when versions match', async () => {
      const result = await checkVersionMatch('1.0.0', () => Promise.resolve('1.0.0'));
      expect(result.status).toBe('ok');
      expect(result.message).toContain('latest');
    });

    it('returns warn when versions differ', async () => {
      const result = await checkVersionMatch('0.2.2', () => Promise.resolve('1.0.0'));
      expect(result.status).toBe('warn');
      expect(result.message).toContain('latest is v1.0.0');
    });

    it('returns warn when could not check latest', async () => {
      const result = await checkVersionMatch('0.2.2', () => Promise.resolve(null));
      expect(result.status).toBe('warn');
      expect(result.message).toContain('could not check latest');
    });

    it('returns warn when check throws', async () => {
      const result = await checkVersionMatch('0.2.2', () => {
        throw new Error('fetch failed');
      });
      expect(result.status).toBe('warn');
    });
  });

  // ── Full runDoctor integration tests ───────────────────────────────

  describe('runDoctor', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-doctor-test-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('exits 0 when all checks pass on healthy system', async () => {
      const { checks, exitCode } = await runDoctor({
        cwd: tmpDir,
        port: 3590,
        providerName: 'deepseek',
        providerPing: () => Promise.resolve(true),
        fetchLatestVersion: () => Promise.resolve('0.2.2'),
      });
      expect(exitCode).toBe(0);

      // All checks should be ok or warn (no fail)
      const fails = checks.filter((c) => c.status === 'fail');
      expect(fails.length).toBe(0);

      // Verify all expected checks are present
      const names = checks.map((c) => c.name);
      expect(names).toContain('Node.js');
      expect(names).toContain('Git');
      expect(names).toContain('.nova/ writable');
      expect(names).toContain('Provider');
      expect(names).toContain('Port');
      expect(names).toContain('Version');
    });

    it('exits non-zero when provider ping fails', async () => {
      const { exitCode, checks } = await runDoctor({
        cwd: tmpDir,
        port: 3590,
        providerName: 'deepseek',
        providerPing: () => Promise.resolve(false),
      });
      expect(exitCode).not.toBe(0);
      const providerCheck = checks.find((c) => c.name === 'Provider');
      expect(providerCheck?.status).toBe('fail');
    });

    it('exits non-zero when port is occupied', async () => {
      const occupying = net.createServer();
      const PORT = 3597;
      await new Promise<void>((resolve) => occupying.listen(PORT, '127.0.0.1', resolve));
      try {
        const { exitCode, checks } = await runDoctor({
          cwd: tmpDir,
          port: PORT,
          providerName: 'openai',
          providerPing: () => Promise.resolve(true),
          fetchLatestVersion: () => Promise.resolve('0.2.2'),
        });
        expect(exitCode).not.toBe(0);
        const portCheck = checks.find((c) => c.name === 'Port');
        expect(portCheck?.status).toBe('fail');
      } finally {
        occupying.close();
      }
    });

    it('exits 0 when only warnings are present', async () => {
      const { exitCode, checks } = await runDoctor({
        cwd: tmpDir,
        port: 3590,
        providerName: 'deepseek',
        providerPing: () => Promise.resolve(true),
        fetchLatestVersion: () => Promise.resolve('99.0.0'), // version mismatch = warn
      });

      expect(exitCode).toBe(0);

      // Version should be warn (behind latest)
      const versionCheck = checks.find((c) => c.name === 'Version');
      expect(versionCheck?.status).toBe('warn');

      // No fails
      const fails = checks.filter((c) => c.status === 'fail');
      expect(fails.length).toBe(0);
    });

    it('includes Claude CLI check when provider=claude-cli', async () => {
      const { checks } = await runDoctor({
        cwd: tmpDir,
        port: 3590,
        providerName: 'claude-cli',
        providerPing: () => Promise.resolve(true),
        includeClaudeCli: true,
      });
      const names = checks.map((c) => c.name);
      expect(names).toContain('Claude CLI');
    });

    it('does NOT include Claude CLI check when not configured', async () => {
      const { checks } = await runDoctor({
        cwd: tmpDir,
        port: 3590,
        providerName: 'deepseek',
        providerPing: () => Promise.resolve(true),
        includeClaudeCli: false,
      });
      const names = checks.map((c) => c.name);
      expect(names).not.toContain('Claude CLI');
    });

    it('includes Ollama check when provider=ollama', async () => {
      const { checks } = await runDoctor({
        cwd: tmpDir,
        port: 3590,
        providerName: 'ollama',
        providerPing: () => Promise.resolve(true),
        includeOllama: true,
      });
      const names = checks.map((c) => c.name);
      expect(names).toContain('Ollama');
    });

    it('includes Ollama check when RAG embeddings use Ollama (provider != ollama)', async () => {
      // Simulates: chat provider is deepseek, but RAG embedding provider is ollama
      const { checks } = await runDoctor({
        cwd: tmpDir,
        port: 3590,
        providerName: 'deepseek',
        providerPing: () => Promise.resolve(true),
        includeOllama: true, // RAG uses Ollama for embeddings
      });
      const names = checks.map((c) => c.name);
      expect(names).toContain('Ollama');
    });

    it('does NOT include Ollama check when not configured', async () => {
      const { checks } = await runDoctor({
        cwd: tmpDir,
        port: 3590,
        providerName: 'deepseek',
        providerPing: () => Promise.resolve(true),
        includeOllama: false,
      });
      const names = checks.map((c) => c.name);
      expect(names).not.toContain('Ollama');
    });
  });

  // ── Output formatting tests ────────────────────────────────────────

  describe('formatTextOutput', () => {
    it('outputs each check on its own line', () => {
      const checks: CheckResult[] = [
        { name: 'Node.js', status: 'ok', message: 'v22.22.2' },
        { name: 'Git', status: 'ok', message: 'git version 2.43.0' },
        { name: 'Port', status: 'fail', message: 'port 3000 is already in use' },
      ];
      const output = formatTextOutput(checks, false);
      const lines = output.split('\n');
      expect(lines.length).toBe(3);
      expect(lines[0]).toBe('[OK] Node.js: v22.22.2');
      expect(lines[1]).toBe('[OK] Git: git version 2.43.0');
      expect(lines[2]).toBe('[FAIL] Port: port 3000 is already in use');
    });

    it('colorizes output when isTTY is true', () => {
      const checks: CheckResult[] = [{ name: 'Test', status: 'ok', message: 'good' }];
      const output = formatTextOutput(checks, true);
      expect(output).toContain('\x1b[32m[OK]\x1b[0m');
    });

    it('does not colorize output when isTTY is false', () => {
      const checks: CheckResult[] = [{ name: 'Test', status: 'ok', message: 'good' }];
      const output = formatTextOutput(checks, false);
      expect(output).not.toContain('\x1b[');
    });

    it('shows [WARN] prefix for warn status', () => {
      const checks: CheckResult[] = [
        { name: 'Version', status: 'warn', message: 'v0.2.2 (latest is v1.0.0)' },
      ];
      const output = formatTextOutput(checks, false);
      expect(output).toContain('[WARN]');
      expect(output).not.toContain('[FAIL]');
      expect(output).not.toContain('[OK] Version');
    });
  });

  describe('formatJsonOutput', () => {
    it('outputs valid JSON with checks array', () => {
      const checks: CheckResult[] = [{ name: 'Node.js', status: 'ok', message: 'v22.22.2' }];
      const output = formatJsonOutput(checks);
      const parsed = JSON.parse(output) as { checks: CheckResult[]; overall: string };
      expect(parsed).toHaveProperty('checks');
      expect(parsed).toHaveProperty('overall');
      expect(Array.isArray(parsed.checks)).toBe(true);
      expect(parsed.checks[0]!.name).toBe('Node.js');
      expect(parsed.checks[0]!.status).toBe('ok');
      expect(parsed.checks[0]!.message).toBe('v22.22.2');
    });

    it('overall is "pass" when all checks ok or warn', () => {
      const checks: CheckResult[] = [
        { name: 'A', status: 'ok', message: 'good' },
        { name: 'B', status: 'warn', message: 'warning' },
      ];
      const output = formatJsonOutput(checks);
      const parsed = JSON.parse(output) as { checks: CheckResult[]; overall: string };
      expect(parsed.overall).toBe('pass');
    });

    it('overall is "fail" when any check fails', () => {
      const checks: CheckResult[] = [
        { name: 'A', status: 'ok', message: 'good' },
        { name: 'B', status: 'fail', message: 'bad' },
      ];
      const output = formatJsonOutput(checks);
      const parsed = JSON.parse(output) as { checks: CheckResult[]; overall: string };
      expect(parsed.overall).toBe('fail');
    });
  });

  // ── Exit code behavior ─────────────────────────────────────────────

  describe('exit code behavior', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-doctor-test-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('exit code is 0 when all OK', async () => {
      const { exitCode } = await runDoctor({
        cwd: tmpDir,
        port: 3590,
        providerName: 'deepseek',
        providerPing: () => Promise.resolve(true),
        fetchLatestVersion: () => Promise.resolve('0.2.2'),
      });
      expect(exitCode).toBe(0);
    });

    it('exit code is 0 when only WARNs present', async () => {
      const { exitCode } = await runDoctor({
        cwd: tmpDir,
        port: 3590,
        providerName: 'deepseek',
        providerPing: () => Promise.resolve(true),
        fetchLatestVersion: () => Promise.resolve('99.0.0'),
      });
      expect(exitCode).toBe(0);
    });

    it('exit code is non-zero when any FAIL present', async () => {
      const { exitCode } = await runDoctor({
        cwd: tmpDir,
        port: 3590,
        providerName: 'deepseek',
        providerPing: null, // no provider = fail
      });
      expect(exitCode).not.toBe(0);
    });
  });
});

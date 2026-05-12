import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as net from 'node:net';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { ConfigReader } from '../config.js';
import { ProviderFactory } from '@novastorm-ai/core';
import type { NovaConfig } from '@novastorm-ai/core';

// ── Types ────────────────────────────────────────────────────────────────

export interface CheckResult {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
}

export interface DoctorOutput {
  checks: CheckResult[];
  overall: 'pass' | 'fail';
}

export interface DoctorOptions {
  cwd?: string;
  json?: boolean;
}

// ── Individual checks ────────────────────────────────────────────────────

function checkNodeVersion(): CheckResult {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);
  if (major >= 22) {
    return { name: 'Node.js', status: 'ok', message: version };
  }
  return { name: 'Node.js', status: 'fail', message: `${version} (requires >= 22)` };
}

function checkGitOnPath(): CheckResult {
  try {
    const out = execSync('git --version', { stdio: 'pipe' }).toString().trim();
    return { name: 'Git', status: 'ok', message: out };
  } catch {
    return { name: 'Git', status: 'fail', message: 'git not found on PATH' };
  }
}

async function checkNovaDirWritable(cwd: string): Promise<CheckResult> {
  const novaDir = path.join(cwd, '.nova');
  try {
    await fs.mkdir(novaDir, { recursive: true });
    const testFile = path.join(novaDir, '.doctor-write-test');
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

async function checkPortAvailable(port: number): Promise<CheckResult> {
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

async function checkProviderPing(config: NovaConfig): Promise<CheckResult> {
  const provider = config.apiKeys.provider;

  // For local providers, skip the ping
  if (provider === 'ollama' || provider === 'claude-cli') {
    try {
      const factory = new ProviderFactory();
      const client = factory.create(provider);
      // Do a 1-token chat to verify the provider works
      const response = await client.chat([{ role: 'user', content: 'say ok' }], { maxTokens: 1 });
      if (response && response.length > 0) {
        return { name: 'Provider', status: 'ok', message: `${provider} ping successful` };
      }
      return {
        name: 'Provider',
        status: 'fail',
        message: `${provider} returned empty response`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        name: 'Provider',
        status: 'fail',
        message: `${provider} ping error: ${msg}`,
      };
    }
  }

  // For remote providers, check if API key is available
  const apiKey = config.apiKeys.key;
  if (!apiKey) {
    return {
      name: 'Provider',
      status: 'fail',
      message: `no API key configured for ${provider} (set apiKeys.key in .nova/config.toml or NOVA_API_KEY env var)`,
    };
  }

  try {
    const factory = new ProviderFactory();
    const client = factory.create(provider, apiKey);
    // Do a 1-token chat
    const response = await client.chat([{ role: 'user', content: 'say ok' }], { maxTokens: 1 });
    if (response && response.length > 0) {
      return { name: 'Provider', status: 'ok', message: `${provider} ping successful` };
    }
    return {
      name: 'Provider',
      status: 'fail',
      message: `${provider} returned empty response - check API key`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: 'Provider',
      status: 'fail',
      message: `${provider} ping error: ${msg}`,
    };
  }
}

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

async function checkOllamaReachable(host: string): Promise<CheckResult> {
  try {
    const resp = await fetch(`http://${host}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
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

async function checkVersionMatch(installedVersion: string): Promise<CheckResult> {
  try {
    const resp = await fetch(`https://registry.npmjs.org/@novastorm-ai/cli/latest`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      return {
        name: 'Version',
        status: 'warn',
        message: `v${installedVersion} (could not check latest - HTTP ${resp.status})`,
      };
    }
    const data = (await resp.json()) as { version?: string };
    const latest = data.version;
    if (!latest) {
      return {
        name: 'Version',
        status: 'warn',
        message: `v${installedVersion} (could not determine latest)`,
      };
    }
    if (installedVersion === latest) {
      return { name: 'Version', status: 'ok', message: `v${installedVersion} (latest)` };
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

export async function runDoctor(opts: DoctorOptions = {}): Promise<DoctorOutput> {
  const cwd = opts.cwd ?? process.cwd();

  // Read config
  const configReader = new ConfigReader();
  let config: NovaConfig | null = null;
  let configError: string | null = null;
  try {
    config = await configReader.read(cwd);
  } catch (err: unknown) {
    configError = err instanceof Error ? err.message : String(err);
    // Use defaults if config can't be read
  }

  const checks: CheckResult[] = [];

  // 1. Node version
  checks.push(checkNodeVersion());

  // 2. Git on PATH
  checks.push(checkGitOnPath());

  // 3. .nova/ writable
  checks.push(await checkNovaDirWritable(cwd));

  // 4. Provider ping
  if (config && !configError) {
    checks.push(await checkProviderPing(config));
  } else {
    checks.push({
      name: 'Provider',
      status: 'fail',
      message: configError
        ? `config error: ${configError}`
        : 'no configuration found (run nova setup first)',
    });
  }

  // 5. Claude CLI (conditional on provider)
  if (config?.apiKeys?.provider === 'claude-cli') {
    checks.push(checkClaudeCli());
  }

  // 6. Ollama (conditional on provider=ollama OR embeddings configured)
  if (config?.apiKeys?.provider === 'ollama') {
    checks.push(await checkOllamaReachable('127.0.0.1:11434'));
  }

  // 7. Port availability (default from config or 3000)
  const port = config?.project?.port ?? 3000;
  checks.push(await checkPortAvailable(port));

  // 8. Version match (warning only)
  const pkgJsonPath = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '..',
    'package.json',
  );
  let installedVersion = '0.0.0';
  try {
    const pkg = JSON.parse(await fs.readFile(pkgJsonPath, 'utf-8')) as { version: string };
    installedVersion = pkg.version;
  } catch {
    // Use a fallback
  }
  checks.push(await checkVersionMatch(installedVersion));

  const hasFail = checks.some((c) => c.status === 'fail');
  return { checks, overall: hasFail ? 'fail' : 'pass' };
}

// ── Output formatting ────────────────────────────────────────────────────

export function formatTextOutput(checks: CheckResult[], isTTY: boolean): string {
  const lines: string[] = [];
  for (const check of checks) {
    let prefix: string;
    if (check.status === 'ok') {
      prefix = isTTY ? `${chalk.green('[OK]')}` : '[OK]';
    } else if (check.status === 'warn') {
      prefix = isTTY ? `${chalk.yellow('[WARN]')}` : '[WARN]';
    } else {
      prefix = isTTY ? `${chalk.red('[FAIL]')}` : '[FAIL]';
    }
    const msg =
      isTTY && check.status === 'warn'
        ? chalk.yellow(check.message)
        : isTTY && check.status === 'fail'
          ? chalk.red(check.message)
          : check.message;
    lines.push(`${prefix} ${check.name}: ${msg}`);
  }
  return lines.join('\n');
}

export function formatJsonOutput(checks: CheckResult[]): string {
  const hasFail = checks.some((c) => c.status === 'fail');
  return JSON.stringify({ checks, overall: hasFail ? 'fail' : 'pass' }, null, 2);
}

// ── CLI command handler ──────────────────────────────────────────────────

export async function doctorCommand(opts: DoctorOptions = {}): Promise<void> {
  const output = await runDoctor(opts);

  if (opts.json) {
    console.log(formatJsonOutput(output.checks));
  } else {
    const isTTY = process.stdout.isTTY === true;
    console.log(formatTextOutput(output.checks, isTTY));
  }

  // Exit code: non-zero if any FAIL
  if (output.overall === 'fail') {
    process.exitCode = 1;
  }
}

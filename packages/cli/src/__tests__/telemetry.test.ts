import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { getMachineId, resolveTelemetryEnabled, saveTelemetryConsent } from '../telemetry.js';
import type { StartOptions } from '../index.js';

// ── Mocks ────────────────────────────────────────────────────────────────

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
}));

// ── Helpers ──────────────────────────────────────────────────────────────

/** Create a clean temp directory with an isolated HOME. */
async function tempHome(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-telemetry-test-'));
  const homeDir = path.join(tmpDir, 'home');
  await fs.mkdir(homeDir, { recursive: true });
  return homeDir;
}

function defaultOptions(overrides: Partial<StartOptions> = {}): StartOptions {
  return {
    noOpen: false,
    yes: false,
    port: undefined,
    proxyPort: undefined,
    noTelemetry: false,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('getMachineId', () => {
  let origHome: string | undefined;
  let testHome: string;

  beforeEach(async () => {
    origHome = process.env['HOME'];
    testHome = await tempHome();
    process.env['HOME'] = testHome;
  });

  afterEach(async () => {
    process.env['HOME'] = origHome;
    try {
      await fs.rm(testHome, { recursive: true, force: true });
    } catch {
      // Directory may already be cleaned up — safe to ignore
    }
  });

  it('creates a v4 UUID install-id on first call', async () => {
    const id = await getMachineId();

    const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(id).toMatch(uuidV4Pattern);
  });

  it('writes install-id to ~/.nova/install-id', async () => {
    const id = await getMachineId();

    const installIdPath = path.join(testHome, '.nova', 'install-id');
    const content = (await fs.readFile(installIdPath, 'utf-8')).trim();
    expect(content).toBe(id);
  });

  it('returns the same install-id across calls', async () => {
    const first = await getMachineId();
    const second = await getMachineId();
    expect(first).toBe(second);
  });

  it('returns existing install-id when already present', async () => {
    // Pre-create install-id manually
    const novaDir = path.join(testHome, '.nova');
    await fs.mkdir(novaDir, { recursive: true });
    const existingId = '550e8400-e29b-41d4-a716-446655440000';
    await fs.writeFile(path.join(novaDir, 'install-id'), existingId + '\n', 'utf-8');

    const id = await getMachineId();
    expect(id).toBe(existingId);
  });
});

describe('resolveTelemetryEnabled', () => {
  let origHome: string | undefined;
  let origNonInteractive: string | undefined;
  let origTelemetry: string | undefined;
  let testHome: string;

  beforeEach(async () => {
    origHome = process.env['HOME'];
    origNonInteractive = process.env['NOVA_NON_INTERACTIVE'];
    origTelemetry = process.env['NOVA_TELEMETRY'];
    testHome = await tempHome();
    process.env['HOME'] = testHome;
    delete process.env['NOVA_NON_INTERACTIVE'];
    delete process.env['NOVA_TELEMETRY'];
    vi.clearAllMocks();
  });

  afterEach(async () => {
    process.env['HOME'] = origHome;
    if (origNonInteractive === undefined) {
      delete process.env['NOVA_NON_INTERACTIVE'];
    } else {
      process.env['NOVA_NON_INTERACTIVE'] = origNonInteractive;
    }
    if (origTelemetry === undefined) {
      delete process.env['NOVA_TELEMETRY'];
    } else {
      process.env['NOVA_TELEMETRY'] = origTelemetry;
    }
    try {
      await fs.rm(testHome, { recursive: true, force: true });
    } catch {
      // Directory may already be cleaned up — safe to ignore
    }
  });

  // ── Hard disables ─────────────────────────────────────────────────

  it('returns false when --no-telemetry flag is set', async () => {
    const result = await resolveTelemetryEnabled(defaultOptions({ noTelemetry: true }), true);
    expect(result).toBe(false);
  });

  it('returns false when NOVA_TELEMETRY=false', async () => {
    process.env['NOVA_TELEMETRY'] = 'false';
    const result = await resolveTelemetryEnabled(defaultOptions(), true);
    expect(result).toBe(false);
  });

  it('--no-telemetry takes precedence over everything', async () => {
    process.env['NOVA_TELEMETRY'] = 'true';
    // Pre-set user consent to enabled
    await saveTelemetryConsent(true);

    const result = await resolveTelemetryEnabled(defaultOptions({ noTelemetry: true }), true);
    expect(result).toBe(false);
  });

  // ── User-level config ─────────────────────────────────────────────

  it('returns false when user config has telemetry.enabled = false', async () => {
    await saveTelemetryConsent(false);

    const result = await resolveTelemetryEnabled(defaultOptions(), true);
    expect(result).toBe(false);
  });

  it('returns true when user config has telemetry.enabled = true', async () => {
    await saveTelemetryConsent(true);

    const result = await resolveTelemetryEnabled(defaultOptions(), true);
    expect(result).toBe(true);
  });

  // ── First-run opt-in prompt ───────────────────────────────────────

  it('prompts on first run with no prior consent (default no)', async () => {
    const prompts = await import('@inquirer/prompts');
    vi.mocked(prompts.confirm).mockResolvedValue(false);

    const result = await resolveTelemetryEnabled(defaultOptions(), true);

    expect(prompts.confirm).toHaveBeenCalledWith(expect.objectContaining({ default: false }));
    expect(result).toBe(false);
  });

  it('prompts on first run and honors yes answer', async () => {
    const prompts = await import('@inquirer/prompts');
    vi.mocked(prompts.confirm).mockResolvedValue(true);

    const result = await resolveTelemetryEnabled(defaultOptions(), true);

    expect(prompts.confirm).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('saves consent after prompt', async () => {
    const prompts = await import('@inquirer/prompts');
    vi.mocked(prompts.confirm).mockResolvedValue(false);

    await resolveTelemetryEnabled(defaultOptions(), true);

    // Second call should not prompt again — consent is saved
    vi.mocked(prompts.confirm).mockResolvedValue(true);

    const result2 = await resolveTelemetryEnabled(defaultOptions(), true);
    expect(result2).toBe(false); // respects saved consent
    expect(prompts.confirm).toHaveBeenCalledTimes(1);
  });

  it('does NOT prompt when prior consent exists', async () => {
    await saveTelemetryConsent(false);
    const prompts = await import('@inquirer/prompts');

    const result = await resolveTelemetryEnabled(defaultOptions(), true);

    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  // ── Non-interactive mode ──────────────────────────────────────────

  it('defaults to disabled in non-interactive mode without prior consent', async () => {
    const result = await resolveTelemetryEnabled(defaultOptions({ yes: true }), true);
    expect(result).toBe(false);
  });

  it('saves disable consent in non-interactive mode', async () => {
    await resolveTelemetryEnabled(defaultOptions({ yes: true }), true);

    // Now consent should exist as disabled
    const prompts = await import('@inquirer/prompts');
    const result = await resolveTelemetryEnabled(defaultOptions(), true);
    expect(prompts.confirm).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  // ── Project-level config ──────────────────────────────────────────

  it('returns false when project config has telemetry disabled and no prior consent', async () => {
    const prompts = await import('@inquirer/prompts');
    vi.mocked(prompts.confirm).mockResolvedValue(true);

    const result = await resolveTelemetryEnabled(
      defaultOptions(),
      false, // project-level disabled
    );
    expect(result).toBe(false);
    // Should not prompt if project-level already disabled
    expect(prompts.confirm).not.toHaveBeenCalled();
  });
});

describe('saveTelemetryConsent', () => {
  let origHome: string | undefined;
  let testHome: string;

  beforeEach(async () => {
    origHome = process.env['HOME'];
    testHome = await tempHome();
    process.env['HOME'] = testHome;
  });

  afterEach(async () => {
    process.env['HOME'] = origHome;
    try {
      await fs.rm(testHome, { recursive: true, force: true });
    } catch {
      // Directory may already be cleaned up — safe to ignore
    }
  });

  it('writes enabled = true to user config', async () => {
    await saveTelemetryConsent(true);

    const configPath = path.join(testHome, '.nova', 'config.toml');
    const content = await fs.readFile(configPath, 'utf-8');
    expect(content).toContain('[telemetry]');
    expect(content).toContain('enabled = true');
  });

  it('writes enabled = false to user config', async () => {
    await saveTelemetryConsent(false);

    const configPath = path.join(testHome, '.nova', 'config.toml');
    const content = await fs.readFile(configPath, 'utf-8');
    expect(content).toContain('[telemetry]');
    expect(content).toContain('enabled = false');
  });

  it('preserves other sections in user config', async () => {
    const userNovaDir = path.join(testHome, '.nova');
    await fs.mkdir(userNovaDir, { recursive: true });
    // Pre-create config with another section
    const existing = '[apiKeys]\nprovider = "deepseek"\n' + '[telemetry]\nenabled = true\n';
    await fs.writeFile(path.join(userNovaDir, 'config.toml'), existing, 'utf-8');

    await saveTelemetryConsent(false);

    const configPath = path.join(testHome, '.nova', 'config.toml');
    const content = await fs.readFile(configPath, 'utf-8');
    expect(content).toContain('deepseek');
    expect(content).toContain('enabled = false');
  });
});

describe('code-level assertions', () => {
  it('os.networkInterfaces is NOT used in telemetry helper', async () => {
    const sourcePath = path.join(__dirname, '..', 'telemetry.ts');
    const content = await fs.readFile(sourcePath, 'utf-8');
    expect(content).not.toMatch(/networkInterfaces/);
  });
});

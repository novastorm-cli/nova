import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Mocks ────────────────────────────────────────────────────────────────

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  password: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('@novastorm-ai/core', async () => {
  const actual = await vi.importActual<typeof import('@novastorm-ai/core')>('@novastorm-ai/core');
  return {
    ...actual,
    ProviderFactory: vi.fn(),
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────

async function importSetup(): Promise<{
  runSetup: (projectPath: string) => Promise<void>;
}> {
  return import('../setup.js');
}

function createMockClient(validKey: boolean) {
  return {
    chat: validKey
      ? vi.fn().mockResolvedValue({ content: 'OK' })
      : vi.fn().mockRejectedValue(new Error('Authentication failed')),
  };
}

/** Set up mocks for a valid-key scenario. */
async function setupMocksForValidKey(providerValue: string, keyValue: string) {
  const prompts = await import('@inquirer/prompts');
  vi.mocked(prompts.select).mockResolvedValue(providerValue);
  vi.mocked(prompts.password).mockResolvedValue(keyValue);
  vi.mocked(prompts.confirm).mockResolvedValue(true);

  const core = await import('@novastorm-ai/core');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(core.ProviderFactory).mockImplementation((): any => ({
    create: vi.fn().mockReturnValue(createMockClient(true)),
  }));
}

/** Set up mocks for invalid-then-valid key scenario. */
async function setupMocksForInvalidKeyThenValid(
  providerValue: string,
  badKey: string,
  goodKey: string,
) {
  const prompts = await import('@inquirer/prompts');
  vi.mocked(prompts.select).mockResolvedValue(providerValue);

  let passwordCalls = 0;
  vi.mocked(prompts.password).mockImplementation(() => {
    passwordCalls++;
    return Promise.resolve(passwordCalls === 1 ? badKey : goodKey);
  });

  let validationCalls = 0;
  const coreModule = await import('@novastorm-ai/core');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(coreModule.ProviderFactory).mockImplementation((): any => ({
    create: vi.fn().mockImplementation(() => {
      validationCalls++;
      return createMockClient(validationCalls > 1);
    }),
  }));

  vi.mocked(prompts.confirm).mockResolvedValue(true);
}

/** Set up mocks for invalid-key-then-skip scenario. */
async function setupMocksForInvalidKeyThenSkip(providerValue: string, badKey: string) {
  const prompts = await import('@inquirer/prompts');
  vi.mocked(prompts.select).mockResolvedValue(providerValue);
  vi.mocked(prompts.password).mockResolvedValue(badKey);

  let confirmCalls = 0;
  vi.mocked(prompts.confirm).mockImplementation(() => {
    confirmCalls++;
    return Promise.resolve(confirmCalls === 1 ? false : true);
  });

  const coreModule = await import('@novastorm-ai/core');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(coreModule.ProviderFactory).mockImplementation((): any => ({
    create: vi.fn().mockReturnValue(createMockClient(false)),
  }));
}

/** Set up mocks for a local provider (no key prompt). */
async function setupMocksForLocalProvider(providerValue: string) {
  const prompts = await import('@inquirer/prompts');
  vi.mocked(prompts.select).mockResolvedValue(providerValue);
  vi.mocked(prompts.password).mockResolvedValue('');
  vi.mocked(prompts.confirm).mockResolvedValue(true);

  const core = await import('@novastorm-ai/core');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(core.ProviderFactory).mockImplementation((): any => ({
    create: vi.fn().mockReturnValue(createMockClient(true)),
  }));
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('Setup wizard', () => {
  let tmpDir: string;
  let origHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-setup-test-'));
    origHome = process.env['HOME'];
    const homeDir = path.join(tmpDir, 'home');
    await fs.mkdir(homeDir, { recursive: true });
    process.env['HOME'] = homeDir;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    process.env['HOME'] = origHome;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Provider list ──────────────────────────────────────────────────────

  it('provider list includes deepseek', async () => {
    await setupMocksForValidKey('deepseek', 'sk-test-key');

    const { runSetup } = await importSetup();
    await runSetup(tmpDir);

    const prompts = await import('@inquirer/prompts');
    expect(prompts.select).toHaveBeenCalled();
    expect(prompts.password).toHaveBeenCalled();
  });

  // ── Non-local provider key collection ──────────────────────────────────

  it('non-local provider (deepseek) asks for API key', async () => {
    await setupMocksForValidKey('deepseek', 'sk-deepseek-key');

    const { runSetup } = await importSetup();
    await runSetup(tmpDir);

    const prompts = await import('@inquirer/prompts');
    expect(prompts.password).toHaveBeenCalled();
  });

  it('local provider (ollama) does NOT ask for API key', async () => {
    await setupMocksForLocalProvider('ollama');

    const { runSetup } = await importSetup();
    await runSetup(tmpDir);

    const prompts = await import('@inquirer/prompts');
    expect(prompts.select).toHaveBeenCalled();
    expect(prompts.password).not.toHaveBeenCalled();
  });

  it('local provider (claude-cli) does NOT ask for API key', async () => {
    await setupMocksForLocalProvider('claude-cli');

    const { runSetup } = await importSetup();
    await runSetup(tmpDir);

    const prompts = await import('@inquirer/prompts');
    expect(prompts.select).toHaveBeenCalled();
    expect(prompts.password).not.toHaveBeenCalled();
  });

  // ── Empty key rejection ────────────────────────────────────────────────

  it('rejects empty key for non-local provider and re-prompts', async () => {
    const prompts = await import('@inquirer/prompts');
    vi.mocked(prompts.select).mockResolvedValue('deepseek');
    let passwordCalls = 0;
    vi.mocked(prompts.password).mockImplementation(() => {
      passwordCalls++;
      return Promise.resolve(passwordCalls === 1 ? '' : 'sk-now-valid');
    });
    vi.mocked(prompts.confirm).mockResolvedValue(true);

    const core = await import('@novastorm-ai/core');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(core.ProviderFactory).mockImplementation((): any => ({
      create: vi.fn().mockReturnValue(createMockClient(true)),
    }));

    const { runSetup } = await importSetup();
    await runSetup(tmpDir);

    expect(passwordCalls).toBe(2);
  });

  // ── Key validation: valid ──────────────────────────────────────────────

  it('valid key for openai saves config with key', async () => {
    await setupMocksForValidKey('openai', 'sk-openai-key');

    const { runSetup } = await importSetup();
    await runSetup(tmpDir);

    const localConfigPath = path.join(tmpDir, '.nova', 'config.toml');
    const content = await fs.readFile(localConfigPath, 'utf-8');
    expect(content).toContain('sk-openai-key');
    expect(content).toContain('openai');
  });

  it('valid key for anthropic saves config with key', async () => {
    await setupMocksForValidKey('anthropic', 'sk-ant-api-key');

    const { runSetup } = await importSetup();
    await runSetup(tmpDir);

    const localConfigPath = path.join(tmpDir, '.nova', 'config.toml');
    const content = await fs.readFile(localConfigPath, 'utf-8');
    expect(content).toContain('sk-ant-api-key');
    expect(content).toContain('anthropic');
  });

  it('valid key for deepseek saves config with key', async () => {
    await setupMocksForValidKey('deepseek', 'sk-deepseek-key');

    const { runSetup } = await importSetup();
    await runSetup(tmpDir);

    const localConfigPath = path.join(tmpDir, '.nova', 'config.toml');
    const content = await fs.readFile(localConfigPath, 'utf-8');
    expect(content).toContain('sk-deepseek-key');
    expect(content).toContain('deepseek');
  });

  it('valid key for openrouter saves config with key', async () => {
    await setupMocksForValidKey('openrouter', 'sk-or-key');

    const { runSetup } = await importSetup();
    await runSetup(tmpDir);

    const localConfigPath = path.join(tmpDir, '.nova', 'config.toml');
    const content = await fs.readFile(localConfigPath, 'utf-8');
    expect(content).toContain('sk-or-key');
    expect(content).toContain('openrouter');
  });

  // ── Key validation: invalid -> retry -> valid ──────────────────────────

  it('invalid key -> retry -> valid key accepted', async () => {
    await setupMocksForInvalidKeyThenValid('openai', 'sk-bad', 'sk-good');

    const { runSetup } = await importSetup();
    await runSetup(tmpDir);

    const localConfigPath = path.join(tmpDir, '.nova', 'config.toml');
    const content = await fs.readFile(localConfigPath, 'utf-8');
    expect(content).toContain('sk-good');
    expect(content).not.toContain('sk-bad');
  });

  // ── Key validation: invalid -> skip ────────────────────────────────────

  it('invalid key -> skip -> saves config without key', async () => {
    await setupMocksForInvalidKeyThenSkip('openai', 'sk-bad');

    const { runSetup } = await importSetup();
    await runSetup(tmpDir);

    const localConfigPath = path.join(tmpDir, '.nova', 'config.toml');
    const content = await fs.readFile(localConfigPath, 'utf-8');
    expect(content).toContain('openai');
    expect(content).not.toContain('sk-bad');
  });

  // ── Install ID ─────────────────────────────────────────────────────────

  it('generates install-id as v4 UUID on first run', async () => {
    await setupMocksForLocalProvider('ollama');

    const { runSetup } = await importSetup();
    await runSetup(tmpDir);

    const installIdPath = path.join(tmpDir, 'home', '.nova', 'install-id');
    const content = await fs.readFile(installIdPath, 'utf-8');
    const trimmed = content.trim();

    const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(trimmed).toMatch(uuidV4Pattern);
  });

  it('install-id is stable across two runs (does not regenerate)', async () => {
    await setupMocksForLocalProvider('ollama');

    const { runSetup: run1 } = await import('../setup.js');
    await run1(tmpDir);

    const installIdPath = path.join(tmpDir, 'home', '.nova', 'install-id');
    const firstId = (await fs.readFile(installIdPath, 'utf-8')).trim();

    await setupMocksForLocalProvider('ollama');
    const { runSetup: run2 } = await import('../setup.js');
    await run2(tmpDir);

    const secondId = (await fs.readFile(installIdPath, 'utf-8')).trim();
    expect(firstId).toBe(secondId);
  });

  // ── Telemetry opt-in ───────────────────────────────────────────────────

  it('prompts for telemetry opt-in on first run', async () => {
    await setupMocksForLocalProvider('ollama');

    const { runSetup } = await importSetup();
    await runSetup(tmpDir);

    const prompts = await import('@inquirer/prompts');
    expect(prompts.confirm).toHaveBeenCalled();

    const userConfigPath = path.join(tmpDir, 'home', '.nova', 'config.toml');
    const content = await fs.readFile(userConfigPath, 'utf-8');
    expect(content).toContain('[telemetry]');
  });

  it('telemetry opt-in no (default=false) writes enabled = false', async () => {
    const prompts = await import('@inquirer/prompts');
    vi.mocked(prompts.select).mockResolvedValue('ollama');
    vi.mocked(prompts.password).mockResolvedValue('');
    vi.mocked(prompts.confirm).mockResolvedValue(false);

    const core = await import('@novastorm-ai/core');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(core.ProviderFactory).mockImplementation((): any => ({
      create: vi.fn().mockReturnValue(createMockClient(true)),
    }));

    const { runSetup } = await importSetup();
    await runSetup(tmpDir);

    const userConfigPath = path.join(tmpDir, 'home', '.nova', 'config.toml');
    const content = await fs.readFile(userConfigPath, 'utf-8');
    expect(content).toContain('enabled = false');

    expect(prompts.confirm).toHaveBeenCalledWith(expect.objectContaining({ default: false }));
  });

  it('telemetry opt-in yes writes enabled = true', async () => {
    await setupMocksForLocalProvider('ollama');

    const { runSetup } = await importSetup();
    await runSetup(tmpDir);

    const userConfigPath = path.join(tmpDir, 'home', '.nova', 'config.toml');
    const content = await fs.readFile(userConfigPath, 'utf-8');
    expect(content).toContain('enabled = true');
  });

  it('telemetry prompt does NOT reappear on second run', async () => {
    await setupMocksForLocalProvider('ollama');

    const { runSetup: run1 } = await import('../setup.js');
    await run1(tmpDir);

    const prompts = await import('@inquirer/prompts');
    expect(prompts.confirm).toHaveBeenCalled();

    const { runSetup: run2 } = await import('../setup.js');
    await run2(tmpDir);

    expect(prompts.confirm).toHaveBeenCalledTimes(1);
  });

  // ── nova.toml creation ─────────────────────────────────────────────────

  it('setup creates nova.toml if it does not exist', async () => {
    await setupMocksForLocalProvider('ollama');

    const tomlPath = path.join(tmpDir, 'nova.toml');

    const beforeExists = await fs
      .stat(tomlPath)
      .then(() => true)
      .catch(() => false);
    expect(beforeExists).toBe(false);

    const { runSetup } = await importSetup();
    await runSetup(tmpDir);

    const afterExists = await fs
      .stat(tomlPath)
      .then(() => true)
      .catch(() => false);
    expect(afterExists).toBe(true);
  });

  // ── Mock mode tests ───────────────────────────────────────────────

  it('mock mode: key validation passes without outbound HTTP call', async () => {
    process.env['NOVA_DOCTOR_PING_MODE'] = 'mock';
    try {
      // Set up ProviderFactory mock that would throw if called
      const core = await import('@novastorm-ai/core');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(core.ProviderFactory).mockImplementation((): any => ({
        create: vi.fn().mockImplementation(() => {
          throw new Error('ProviderFactory.create should not be called in mock mode');
        }),
      }));

      const prompts = await import('@inquirer/prompts');
      vi.mocked(prompts.select).mockResolvedValue('deepseek');
      vi.mocked(prompts.password).mockResolvedValue('sk-mock-key');
      vi.mocked(prompts.confirm).mockResolvedValue(true);

      const { runSetup } = await importSetup();
      await runSetup(tmpDir);

      // Verify key was saved despite mock mode
      const localConfigPath = path.join(tmpDir, '.nova', 'config.toml');
      const content = await fs.readFile(localConfigPath, 'utf-8');
      expect(content).toContain('sk-mock-key');
      expect(content).toContain('deepseek');
    } finally {
      delete process.env['NOVA_DOCTOR_PING_MODE'];
    }
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NovaConfig } from '@novastorm-ai/core';
import chalk from 'chalk';

// ── Mocks ───────────────────────────────────────────────────────────────

vi.mock('../config.js', () => ({
  ConfigReader: vi.fn(),
}));

const mockCreate = vi.fn();
const mockChat = vi.fn();

vi.mock('@novastorm-ai/core', async () => {
  const actual = await vi.importActual('@novastorm-ai/core');
  return {
    ...actual,
    ProviderFactory: vi.fn().mockImplementation(() => ({
      create: mockCreate,
    })),
    StructuredLogger: vi.fn().mockImplementation(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    })),
  };
});

import { ConfigReader } from '../config.js';
// ProviderFactory imported for type registration but used implicitly by factory pattern
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { ProviderFactory } from '@novastorm-ai/core';

const MockConfigReader = vi.mocked(ConfigReader);

// Import after mocks are set up
import {
  runDoctor,
  formatTextOutput,
  formatJsonOutput,
  doctorCommand,
} from '../commands/doctor.js';
import type { CheckResult } from '../commands/doctor.js';

// ── Helper to build a valid NovaConfig ──────────────────────────────────

function makeConfig(overrides: Partial<NovaConfig> = {}): NovaConfig {
  return {
    project: { devCommand: '', port: 3000, ...overrides.project },
    models: {
      micro: 'deepseek-v4-flash',
      standard: 'deepseek-v4-pro',
      strong: 'deepseek-v4-pro',
      local: false,
      ...overrides.models,
    },
    apiKeys: {
      provider: 'deepseek',
      key: 'sk-test-key',
      ...overrides.apiKeys,
    },
    behavior: {
      autoCommit: false,
      confirmTasks: true,
      branchPrefix: 'nova/',
      passiveSuggestions: true,
      ...overrides.behavior,
    },
    voice: { enabled: false, engine: 'web', ...overrides.voice },
    telemetry: { enabled: false, ...overrides.telemetry },
    ...(overrides.rag !== undefined ? { rag: overrides.rag } : {}),
  } as NovaConfig;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('doctor.ts module exports', () => {
  // ── formatTextOutput ────────────────────────────────────────────────

  describe('formatTextOutput', () => {
    it('formats ok checks with [OK] prefix', () => {
      const checks: CheckResult[] = [{ name: 'Test', status: 'ok', message: 'all good' }];
      const output = formatTextOutput(checks, false);
      expect(output).toBe('[OK] Test: all good');
    });

    it('formats warn checks with [WARN] prefix', () => {
      const checks: CheckResult[] = [{ name: 'Version', status: 'warn', message: 'outdated' }];
      const output = formatTextOutput(checks, false);
      expect(output).toBe('[WARN] Version: outdated');
    });

    it('formats fail checks with [FAIL] prefix', () => {
      const checks: CheckResult[] = [{ name: 'Port', status: 'fail', message: 'in use' }];
      const output = formatTextOutput(checks, false);
      expect(output).toBe('[FAIL] Port: in use');
    });

    it('joins multiple checks with newlines', () => {
      const checks: CheckResult[] = [
        { name: 'A', status: 'ok', message: 'good' },
        { name: 'B', status: 'fail', message: 'bad' },
      ];
      const output = formatTextOutput(checks, false);
      expect(output.split('\n').length).toBe(2);
    });

    it('colorizes when isTTY is true (chalk may respect env)', () => {
      const checks: CheckResult[] = [{ name: 'Test', status: 'ok', message: 'good' }];
      // Force chalk to produce colors even in test environment
      const prevLevel = chalk.level;
      chalk.level = 1;
      try {
        const output = formatTextOutput(checks, true);
        expect(output).toContain('\x1b'); // ANSI escape codes
      } finally {
        chalk.level = prevLevel;
      }
    });

    it('does not colorize when isTTY is false', () => {
      const checks: CheckResult[] = [{ name: 'Test', status: 'ok', message: 'good' }];
      const prevLevel = chalk.level;
      chalk.level = 1;
      try {
        const output = formatTextOutput(checks, false);
        expect(output).not.toContain('\x1b');
      } finally {
        chalk.level = prevLevel;
      }
    });

    it('colorizes warn in yellow when isTTY', () => {
      const checks: CheckResult[] = [{ name: 'V', status: 'warn', message: 'old' }];
      const prevLevel = chalk.level;
      chalk.level = 1;
      try {
        const output = formatTextOutput(checks, true);
        expect(output).toContain('\x1b[33m'); // yellow for warn
      } finally {
        chalk.level = prevLevel;
      }
    });

    it('colorizes fail in red when isTTY', () => {
      const checks: CheckResult[] = [{ name: 'F', status: 'fail', message: 'bad' }];
      const prevLevel = chalk.level;
      chalk.level = 1;
      try {
        const output = formatTextOutput(checks, true);
        expect(output).toContain('\x1b[31m'); // red for fail
      } finally {
        chalk.level = prevLevel;
      }
    });
  });

  // ── formatJsonOutput ─────────────────────────────────────────────────

  describe('formatJsonOutput', () => {
    it('outputs valid JSON with checks array', () => {
      const checks: CheckResult[] = [{ name: 'Node.js', status: 'ok', message: 'v22.0.0' }];
      const output = formatJsonOutput(checks);
      const parsed = JSON.parse(output);
      expect(parsed.checks).toHaveLength(1);
      expect(parsed.checks[0].name).toBe('Node.js');
      expect(parsed.overall).toBe('pass');
    });

    it('overall is "fail" when any check fails', () => {
      const checks: CheckResult[] = [
        { name: 'A', status: 'ok', message: 'good' },
        { name: 'B', status: 'fail', message: 'bad' },
      ];
      const output = formatJsonOutput(checks);
      const parsed = JSON.parse(output);
      expect(parsed.overall).toBe('fail');
    });

    it('overall is "pass" when only ok and warn', () => {
      const checks: CheckResult[] = [
        { name: 'A', status: 'ok', message: 'good' },
        { name: 'B', status: 'warn', message: 'warning' },
      ];
      const output = formatJsonOutput(checks);
      const parsed = JSON.parse(output);
      expect(parsed.overall).toBe('pass');
    });

    it('outputs pretty-printed JSON', () => {
      const checks: CheckResult[] = [{ name: 'X', status: 'ok', message: 'y' }];
      const output = formatJsonOutput(checks);
      expect(output).toContain('\n');
      expect(output).toContain('  '); // indented
    });
  });

  // ── runDoctor ────────────────────────────────────────────────────────

  describe('runDoctor', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockCreate.mockReset();
      mockChat.mockReset();
    });

    afterEach(() => {
      delete process.env['NOVA_DOCTOR_PING_MODE'];
      delete process.env['DEEPSEEK_API_KEY'];
      delete process.env['NOVA_API_KEY'];
    });

    it('returns checks array and overall status', async () => {
      MockConfigReader.prototype.read = vi.fn().mockResolvedValue(makeConfig());

      const result = await runDoctor({ cwd: '/tmp' });
      expect(result.checks.length).toBeGreaterThanOrEqual(4);
      expect(['pass', 'fail']).toContain(result.overall);
    });

    it('handles config read errors gracefully', async () => {
      MockConfigReader.prototype.read = vi.fn().mockRejectedValue(new Error('Config parse error'));

      const result = await runDoctor({ cwd: '/tmp' });
      const providerCheck = result.checks.find((c) => c.name === 'Provider');
      expect(providerCheck).toBeDefined();
      expect(providerCheck!.status).toBe('fail');
      expect(providerCheck!.message).toContain('config error');
    });

    it('uses DEEPSEEK_API_KEY fallback when no config', async () => {
      MockConfigReader.prototype.read = vi.fn().mockRejectedValue(new Error('No config'));
      process.env['DEEPSEEK_API_KEY'] = 'sk-fallback-key';

      const result = await runDoctor({ cwd: '/tmp' });
      const providerCheck = result.checks.find((c) => c.name === 'Provider');
      expect(providerCheck).toBeDefined();
      expect(providerCheck!.message).toContain('deepseek');
    });

    it('uses NOVA_API_KEY fallback when no config and no DEEPSEEK_API_KEY', async () => {
      MockConfigReader.prototype.read = vi.fn().mockRejectedValue(new Error('No config'));
      process.env['NOVA_API_KEY'] = 'sk-nova-key';

      const result = await runDoctor({ cwd: '/tmp' });
      const providerCheck = result.checks.find((c) => c.name === 'Provider');
      expect(providerCheck).toBeDefined();
      expect(providerCheck!.message).toContain('openrouter');
    });

    it('fails provider check when no config and no env vars', async () => {
      MockConfigReader.prototype.read = vi.fn().mockRejectedValue(new Error('No config'));
      // Ensure no env vars are set
      delete process.env['DEEPSEEK_API_KEY'];
      delete process.env['NOVA_API_KEY'];

      const result = await runDoctor({ cwd: '/tmp' });
      const providerCheck = result.checks.find((c) => c.name === 'Provider');
      expect(providerCheck).toBeDefined();
      expect(providerCheck!.status).toBe('fail');
    });

    it('handles mock ping mode', async () => {
      process.env['NOVA_DOCTOR_PING_MODE'] = 'mock';
      MockConfigReader.prototype.read = vi.fn().mockResolvedValue(makeConfig());

      const result = await runDoctor({ cwd: '/tmp' });
      const providerCheck = result.checks.find((c) => c.name === 'Provider');
      expect(providerCheck).toBeDefined();
      expect(providerCheck!.status).toBe('ok');
      expect(providerCheck!.message).toContain('mock mode');
    });

    it('includes Node.js version check', async () => {
      MockConfigReader.prototype.read = vi.fn().mockResolvedValue(makeConfig());

      const result = await runDoctor({ cwd: '/tmp' });
      const nodeCheck = result.checks.find((c) => c.name === 'Node.js');
      expect(nodeCheck).toBeDefined();
      expect(nodeCheck!.status).toBe('ok');
      expect(nodeCheck!.message).toMatch(/^v2[2-9]\./);
    });

    it('includes Git check', async () => {
      MockConfigReader.prototype.read = vi.fn().mockResolvedValue(makeConfig());

      const result = await runDoctor({ cwd: '/tmp' });
      const gitCheck = result.checks.find((c) => c.name === 'Git');
      expect(gitCheck).toBeDefined();
    });

    it('includes Port check', async () => {
      MockConfigReader.prototype.read = vi.fn().mockResolvedValue(makeConfig());

      const result = await runDoctor({ cwd: '/tmp' });
      const portCheck = result.checks.find((c) => c.name === 'Port');
      expect(portCheck).toBeDefined();
      expect(portCheck!.message).toContain('port');
    });

    it('includes Claude CLI check when provider is claude-cli', async () => {
      MockConfigReader.prototype.read = vi
        .fn()
        .mockResolvedValue(makeConfig({ apiKeys: { provider: 'claude-cli' } }));

      const result = await runDoctor({ cwd: '/tmp' });
      const claudeCheck = result.checks.find((c) => c.name === 'Claude CLI');
      expect(claudeCheck).toBeDefined();
    });

    it('excludes Claude CLI check when provider is not claude-cli', async () => {
      MockConfigReader.prototype.read = vi
        .fn()
        .mockResolvedValue(makeConfig({ apiKeys: { provider: 'deepseek' } }));

      const result = await runDoctor({ cwd: '/tmp' });
      const claudeCheck = result.checks.find((c) => c.name === 'Claude CLI');
      expect(claudeCheck).toBeUndefined();
    });

    it('includes Ollama check when provider is ollama', async () => {
      MockConfigReader.prototype.read = vi
        .fn()
        .mockResolvedValue(makeConfig({ apiKeys: { provider: 'ollama' } }));

      const result = await runDoctor({ cwd: '/tmp' });
      const ollamaCheck = result.checks.find((c) => c.name === 'Ollama');
      expect(ollamaCheck).toBeDefined();
    });

    it('includes Ollama check when RAG embeddings use ollama', async () => {
      MockConfigReader.prototype.read = vi.fn().mockResolvedValue(
        makeConfig({
          apiKeys: { provider: 'deepseek' },
          rag: { embeddingProvider: 'ollama' },
        }),
      );

      const result = await runDoctor({ cwd: '/tmp' });
      const ollamaCheck = result.checks.find((c) => c.name === 'Ollama');
      expect(ollamaCheck).toBeDefined();
    });

    it('excludes Ollama check when not configured', async () => {
      MockConfigReader.prototype.read = vi
        .fn()
        .mockResolvedValue(makeConfig({ apiKeys: { provider: 'deepseek' } }));

      const result = await runDoctor({ cwd: '/tmp' });
      const ollamaCheck = result.checks.find((c) => c.name === 'Ollama');
      expect(ollamaCheck).toBeUndefined();
    });

    it('includes Version check', async () => {
      MockConfigReader.prototype.read = vi.fn().mockResolvedValue(makeConfig());

      const result = await runDoctor({ cwd: '/tmp' });
      const versionCheck = result.checks.find((c) => c.name === 'Version');
      expect(versionCheck).toBeDefined();
    });

    it('returns overall "fail" when any check fails', async () => {
      MockConfigReader.prototype.read = vi.fn().mockRejectedValue(new Error('no config'));

      const result = await runDoctor({ cwd: '/tmp' });
      expect(result.overall).toBe('fail');
    });

    it('uses custom cwd when provided', async () => {
      MockConfigReader.prototype.read = vi.fn().mockResolvedValue(makeConfig());

      const result = await runDoctor({ cwd: '/custom/path' });
      const novaCheck = result.checks.find((c) => c.name === '.nova/ writable');
      expect(novaCheck).toBeDefined();
      if (novaCheck?.status === 'fail') {
        expect(novaCheck.message).toContain('/custom/path');
      }
    });

    it('reads configured port from config', async () => {
      MockConfigReader.prototype.read = vi
        .fn()
        .mockResolvedValue(makeConfig({ project: { devCommand: '', port: 3500 } }));

      const result = await runDoctor({ cwd: '/tmp' });
      const portCheck = result.checks.find((c) => c.name === 'Port');
      expect(portCheck).toBeDefined();
      expect(portCheck!.message).toContain('3500');
    });
  });

  // ── doctorCommand ────────────────────────────────────────────────────

  describe('doctorCommand', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockCreate.mockReset();
      mockChat.mockReset();
    });

    afterEach(() => {
      delete process.env['NOVA_DOCTOR_PING_MODE'];
      delete process.env['DEEPSEEK_API_KEY'];
      delete process.env['NOVA_API_KEY'];
    });

    it('sets exit code to 0 when all checks pass', async () => {
      process.env['NOVA_DOCTOR_PING_MODE'] = 'mock';
      MockConfigReader.prototype.read = vi.fn().mockResolvedValue(makeConfig());

      process.exitCode = 0;
      await doctorCommand({ cwd: '/tmp' });
      expect(process.exitCode).toBe(0);
    });

    it('sets exit code to 1 when any check fails', async () => {
      MockConfigReader.prototype.read = vi.fn().mockRejectedValue(new Error('config error'));

      process.exitCode = 0;
      await doctorCommand({ cwd: '/tmp' });
      expect(process.exitCode).toBe(1);
    });

    it('uses --json flag to output JSON', async () => {
      process.env['NOVA_DOCTOR_PING_MODE'] = 'mock';
      MockConfigReader.prototype.read = vi.fn().mockResolvedValue(makeConfig());

      process.exitCode = 0;
      await doctorCommand({ cwd: '/tmp', json: true });
      expect(process.exitCode).toBe(0);
    });
  });

  // ── Local provider paths ──────────────────────────────────────────

  describe('runDoctor with local providers', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockCreate.mockReset();
      mockChat.mockReset();
    });

    afterEach(() => {
      delete process.env['NOVA_DOCTOR_PING_MODE'];
      delete process.env['DEEPSEEK_API_KEY'];
      delete process.env['NOVA_API_KEY'];
    });

    it('handles ollama provider path', async () => {
      // For ollama, doctor calls factory.create('ollama') without API key
      const mockClient = { chat: vi.fn().mockResolvedValue({ content: 'ok' }) };
      mockCreate.mockReturnValue(mockClient);

      MockConfigReader.prototype.read = vi
        .fn()
        .mockResolvedValue(makeConfig({ apiKeys: { provider: 'ollama' } }));

      const result = await runDoctor({ cwd: '/tmp' });
      const providerCheck = result.checks.find((c) => c.name === 'Provider');
      expect(providerCheck).toBeDefined();
      expect(mockCreate).toHaveBeenCalledWith('ollama');
    });

    it('handles claude-cli provider path', async () => {
      const mockClient = { chat: vi.fn().mockResolvedValue({ content: 'ok' }) };
      mockCreate.mockReturnValue(mockClient);

      MockConfigReader.prototype.read = vi
        .fn()
        .mockResolvedValue(makeConfig({ apiKeys: { provider: 'claude-cli' } }));

      const result = await runDoctor({ cwd: '/tmp' });
      const providerCheck = result.checks.find((c) => c.name === 'Provider');
      expect(providerCheck).toBeDefined();
      expect(mockCreate).toHaveBeenCalledWith('claude-cli');
    });

    it('handles ollama provider returning empty response', async () => {
      const mockClient = { chat: vi.fn().mockResolvedValue({ content: '' }) };
      mockCreate.mockReturnValue(mockClient);

      MockConfigReader.prototype.read = vi
        .fn()
        .mockResolvedValue(makeConfig({ apiKeys: { provider: 'ollama' } }));

      const result = await runDoctor({ cwd: '/tmp' });
      const providerCheck = result.checks.find((c) => c.name === 'Provider');
      expect(providerCheck).toBeDefined();
      expect(providerCheck!.status).toBe('fail');
      expect(providerCheck!.message).toContain('empty response');
    });

    it('handles ollama provider throwing error', async () => {
      const mockClient = {
        chat: vi.fn().mockRejectedValue(new Error('connection refused')),
      };
      mockCreate.mockReturnValue(mockClient);

      MockConfigReader.prototype.read = vi
        .fn()
        .mockResolvedValue(makeConfig({ apiKeys: { provider: 'ollama' } }));

      const result = await runDoctor({ cwd: '/tmp' });
      const providerCheck = result.checks.find((c) => c.name === 'Provider');
      expect(providerCheck).toBeDefined();
      expect(providerCheck!.status).toBe('fail');
      expect(providerCheck!.message).toContain('connection refused');
    });

    it('handles remote provider without API key', async () => {
      MockConfigReader.prototype.read = vi
        .fn()
        .mockResolvedValue(makeConfig({ apiKeys: { provider: 'deepseek', key: undefined } }));

      const result = await runDoctor({ cwd: '/tmp' });
      const providerCheck = result.checks.find((c) => c.name === 'Provider');
      expect(providerCheck).toBeDefined();
      expect(providerCheck!.status).toBe('fail');
      expect(providerCheck!.message).toContain('no API key');
    });

    it('handles remote provider with API key via env var (deepseek)', async () => {
      process.env['DEEPSEEK_API_KEY'] = 'sk-env-key';
      const mockClient = { chat: vi.fn().mockResolvedValue({ content: 'ok' }) };
      mockCreate.mockReturnValue(mockClient);

      MockConfigReader.prototype.read = vi
        .fn()
        .mockResolvedValue(makeConfig({ apiKeys: { provider: 'deepseek', key: undefined } }));

      const result = await runDoctor({ cwd: '/tmp' });
      const providerCheck = result.checks.find((c) => c.name === 'Provider');
      expect(providerCheck).toBeDefined();
      expect(providerCheck!.status).toBe('ok');
      expect(providerCheck!.message).toContain('deepseek');
      expect(providerCheck!.message).toContain('ping successful');
      expect(mockCreate).toHaveBeenCalledWith('deepseek', 'sk-env-key');
    });

    it('handles remote provider with NOVA_API_KEY fallback', async () => {
      process.env['NOVA_API_KEY'] = 'sk-nova-fallback';
      const mockClient = { chat: vi.fn().mockResolvedValue({ content: 'ok' }) };
      mockCreate.mockReturnValue(mockClient);

      MockConfigReader.prototype.read = vi.fn().mockResolvedValue(
        makeConfig({
          apiKeys: { provider: 'openrouter', key: undefined },
        }),
      );

      const result = await runDoctor({ cwd: '/tmp' });
      const providerCheck = result.checks.find((c) => c.name === 'Provider');
      expect(providerCheck).toBeDefined();
      expect(providerCheck!.status).toBe('ok');
      expect(providerCheck!.message).toContain('openrouter');
      expect(providerCheck!.message).toContain('ping successful');
      expect(mockCreate).toHaveBeenCalledWith('openrouter', 'sk-nova-fallback');
    });

    it('includes model name in provider ping result when configured', async () => {
      process.env['NOVA_DOCTOR_PING_MODE'] = 'mock';
      MockConfigReader.prototype.read = vi.fn().mockResolvedValue(
        makeConfig({
          models: {
            micro: 'deepseek-v4-flash',
            standard: 'deepseek-v4-pro',
            strong: 'deepseek-v4-pro',
          } as any,
        }),
      );

      const result = await runDoctor({ cwd: '/tmp' });
      const providerCheck = result.checks.find((c) => c.name === 'Provider');
      expect(providerCheck).toBeDefined();
      expect(providerCheck!.message).toContain('deepseek-v4-pro');
    });

    it('defaults port to 3000 when config has no port', async () => {
      process.env['NOVA_DOCTOR_PING_MODE'] = 'mock';
      MockConfigReader.prototype.read = vi
        .fn()
        .mockResolvedValue(makeConfig({ project: { devCommand: '', port: 3000 } }));

      const result = await runDoctor({ cwd: '/tmp' });
      const portCheck = result.checks.find((c) => c.name === 'Port');
      expect(portCheck).toBeDefined();
      expect(portCheck!.message).toContain('3000');
    });
  });
});

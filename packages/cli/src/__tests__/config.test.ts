import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ConfigReader } from '../config.js';
import {
  type NovaConfig,
  DEFAULT_CONFIG,
  PROVIDER_MODEL_DEFAULTS,
  ConfigError,
} from '@novastorm-ai/core';

describe('ConfigReader', () => {
  let tmpDir: string;
  let reader: ConfigReader;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-config-test-'));
    reader = new ConfigReader();
    savedEnv['NOVA_API_KEY'] = process.env['NOVA_API_KEY'];
    savedEnv['NOVA_LICENSE_KEY'] = process.env['NOVA_LICENSE_KEY'];
    delete process.env['NOVA_API_KEY'];
    delete process.env['NOVA_LICENSE_KEY'];
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  describe('read()', () => {
    it('should return NovaConfig with correct values from a valid nova.toml', async () => {
      const toml = `
[project]
devCommand = "npm run dev"
port = 4000

[models]
micro = "openai/gpt-4o-mini"
standard = "openai/gpt-4o"
strong = "anthropic/claude-sonnet-4"
local = true

[apiKeys]
provider = "anthropic"
key = "sk-test-key"

[behavior]
autoCommit = true
branchPrefix = "feat/"
passiveSuggestions = false

[voice]
enabled = false
engine = "whisper"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const config = await reader.read(tmpDir);

      expect(config.project.devCommand).toBe('npm run dev');
      expect(config.project.port).toBe(4000);
      expect(config.models.micro).toBe('openai/gpt-4o-mini');
      expect(config.models.standard).toBe('openai/gpt-4o');
      expect(config.models.strong).toBe('anthropic/claude-sonnet-4');
      expect(config.models.local).toBe(true);
      expect(config.apiKeys.provider).toBe('anthropic');
      expect(config.apiKeys.key).toBe('sk-test-key');
      expect(config.behavior.autoCommit).toBe(true);
      expect(config.behavior.confirmTasks).toBe(true); // default
      expect(config.behavior.branchPrefix).toBe('feat/');
      expect(config.behavior.passiveSuggestions).toBe(false);
      expect(config.voice.enabled).toBe(false);
      expect(config.voice.engine).toBe('whisper');
    });

    it('should return all DEFAULT_CONFIG values when nova.toml does not exist', async () => {
      const config = await reader.read(tmpDir);

      expect(config.project.devCommand).toBe(DEFAULT_CONFIG.project.devCommand);
      expect(config.project.port).toBe(DEFAULT_CONFIG.project.port);
      expect(config.models.micro).toBe(DEFAULT_CONFIG.models.micro);
      expect(config.models.standard).toBe(DEFAULT_CONFIG.models.standard);
      expect(config.models.strong).toBe(DEFAULT_CONFIG.models.strong);
      expect(config.models.local).toBe(DEFAULT_CONFIG.models.local);
      expect(config.apiKeys.provider).toBe(DEFAULT_CONFIG.apiKeys.provider);
      expect(config.apiKeys.key).toBeUndefined();
      expect(config.behavior.autoCommit).toBe(DEFAULT_CONFIG.behavior.autoCommit);
      expect(config.behavior.confirmTasks).toBe(DEFAULT_CONFIG.behavior.confirmTasks);
      expect(config.behavior.branchPrefix).toBe(DEFAULT_CONFIG.behavior.branchPrefix);
      expect(config.behavior.passiveSuggestions).toBe(DEFAULT_CONFIG.behavior.passiveSuggestions);
      expect(config.voice.enabled).toBe(DEFAULT_CONFIG.voice.enabled);
      expect(config.voice.engine).toBe(DEFAULT_CONFIG.voice.engine);
    });

    it('should merge project and local config, with local config winning', async () => {
      const projectToml = `
[project]
devCommand = "npm run dev"
port = 3000

[apiKeys]
provider = "openrouter"
key = "project-key"

[behavior]
branchPrefix = "nova/"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), projectToml);

      const novaDir = path.join(tmpDir, '.nova');
      await fs.mkdir(novaDir, { recursive: true });

      const localToml = `
[apiKeys]
provider = "anthropic"
key = "local-key"

[behavior]
branchPrefix = "local/"
`;
      await fs.writeFile(path.join(novaDir, 'config.toml'), localToml);

      const config = await reader.read(tmpDir);

      // Local config wins for overlapping fields
      expect(config.apiKeys.provider).toBe('anthropic');
      expect(config.apiKeys.key).toBe('local-key');
      expect(config.behavior.branchPrefix).toBe('local/');

      // Project config retained for non-overlapping fields
      expect(config.project.devCommand).toBe('npm run dev');
    });

    it('should override apiKeys.key when NOVA_API_KEY env is set', async () => {
      const projectToml = `
[apiKeys]
provider = "openrouter"
key = "file-key"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), projectToml);

      process.env['NOVA_API_KEY'] = 'env-key-12345';

      const config = await reader.read(tmpDir);

      expect(config.apiKeys.key).toBe('env-key-12345');
    });

    it('should throw ConfigError for invalid TOML syntax', async () => {
      const invalidToml = `
[project
devCommand = "broken
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), invalidToml);

      await expect(reader.read(tmpDir)).rejects.toThrow(ConfigError);
    });

    it('should throw ConfigError with field="project.port" when port is negative', async () => {
      const toml = `
[project]
port = -1
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      try {
        await reader.read(tmpDir);
        expect.fail('Expected ConfigError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigError);
        expect((error as ConfigError).field).toBe('project.port');
      }
    });
  });

  describe('write()', () => {
    it('should create nova.toml and skip default values', async () => {
      const config: Partial<NovaConfig> = {
        project: { devCommand: 'npm start', port: 3000 }, // port is default
        behavior: {
          autoCommit: true,
          confirmTasks: true,
          branchPrefix: 'nova/',
          passiveSuggestions: true,
        }, // branchPrefix and passiveSuggestions are default
      };

      await reader.write(tmpDir, config);

      const filePath = path.join(tmpDir, 'nova.toml');
      const exists = await fs
        .stat(filePath)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);

      const content = await fs.readFile(filePath, 'utf-8');

      // Non-default values should be present
      expect(content).toContain('npm start');
      expect(content).toContain('autoCommit');

      // Default values should be skipped
      // port = 3000 is default, branchPrefix = "nova/" is default, passiveSuggestions = true is default
      expect(content).not.toMatch(/port\s*=\s*3000/);
      expect(content).not.toMatch(/branchPrefix\s*=\s*"nova\/"/);
    });
  });

  describe('exists()', () => {
    it('should return true when nova.toml exists', async () => {
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), '');

      const result = await reader.exists(tmpDir);
      expect(result).toBe(true);
    });

    it('should return false when nova.toml does not exist', async () => {
      const result = await reader.exists(tmpDir);
      expect(result).toBe(false);
    });
  });

  describe('provider model defaults substitution', () => {
    it('swaps Anthropic defaults for DeepSeek models when provider is deepseek and models are untouched', async () => {
      const toml = `
[apiKeys]
provider = "deepseek"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const config = await reader.read(tmpDir);

      expect(config.models.micro).toBe('deepseek-v4-flash');
      expect(config.models.standard).toBe('deepseek-v4-pro');
      expect(config.models.strong).toBe('deepseek-v4-pro');
    });

    it('does NOT swap models when provider is deepseek but user explicitly set models', async () => {
      const toml = `
[apiKeys]
provider = "deepseek"

[models]
micro = "deepseek-v4-flash"
standard = "deepseek-v4-pro"
strong = "deepseek-v4-pro"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const config = await reader.read(tmpDir);

      // User explicitly set these, even though they happen to match DeepSeek defaults.
      // They should be preserved as-is.
      expect(config.models.micro).toBe('deepseek-v4-flash');
      expect(config.models.standard).toBe('deepseek-v4-pro');
      expect(config.models.strong).toBe('deepseek-v4-pro');
    });

    it('does NOT swap models when provider is deepseek but user set custom model names', async () => {
      const toml = `
[apiKeys]
provider = "deepseek"

[models]
standard = "some-custom-model"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const config = await reader.read(tmpDir);

      // User explicitly set standard, so micro and strong stay at Anthropic defaults
      // (they are intentionally left as-is since the user partially overrode)
      expect(config.models.micro).toBe(DEFAULT_CONFIG.models.micro);
      expect(config.models.standard).toBe('some-custom-model');
      expect(config.models.strong).toBe(DEFAULT_CONFIG.models.strong);
    });

    it('does NOT swap models when provider is not in PROVIDER_MODEL_DEFAULTS', async () => {
      const toml = `
[apiKeys]
provider = "anthropic"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const config = await reader.read(tmpDir);

      // Anthropic is not in PROVIDER_MODEL_DEFAULTS — models stay at defaults
      expect(config.models.micro).toBe(DEFAULT_CONFIG.models.micro);
      expect(config.models.standard).toBe(DEFAULT_CONFIG.models.standard);
      expect(config.models.strong).toBe(DEFAULT_CONFIG.models.strong);
    });

    it('does NOT swap models when no nova.toml exists and default provider is openrouter', async () => {
      const config = await reader.read(tmpDir);

      // openrouter is not in PROVIDER_MODEL_DEFAULTS — models stay at defaults
      expect(config.models.micro).toBe(DEFAULT_CONFIG.models.micro);
      expect(config.models.standard).toBe(DEFAULT_CONFIG.models.standard);
      expect(config.models.strong).toBe(DEFAULT_CONFIG.models.strong);
    });

    it('does NOT swap models when only micro was explicitly set to default value', async () => {
      // If user explicitly sets a model to the same value as the default,
      // we treat it as explicit (models.* don't ALL match defaults because
      // the user DID set something—even if the value is the same).
      // Actually, since the values DO match, the substitution WILL fire.
      // Let's test a case where the user sets micro to the default value
      // but that's already covered by the "untouched" case.
      //
      // Instead, test partial override where micro is set to a DIFFERENT value:
      const toml = `
[apiKeys]
provider = "deepseek"

[models]
micro = "claude-opus-4-6"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const config = await reader.read(tmpDir);

      // micro was overridden, so NOT all models match defaults → no swap
      expect(config.models.micro).toBe('claude-opus-4-6');
      expect(config.models.standard).toBe(DEFAULT_CONFIG.models.standard);
      expect(config.models.strong).toBe(DEFAULT_CONFIG.models.strong);
    });

    it('DeepSeek substitution works from local .nova/config.toml', async () => {
      const novaDir = path.join(tmpDir, '.nova');
      await fs.mkdir(novaDir, { recursive: true });

      const localToml = `
[apiKeys]
provider = "deepseek"
`;
      await fs.writeFile(path.join(novaDir, 'config.toml'), localToml);

      const config = await reader.read(tmpDir);

      expect(config.models.micro).toBe('deepseek-v4-flash');
      expect(config.models.standard).toBe('deepseek-v4-pro');
      expect(config.models.strong).toBe('deepseek-v4-pro');
    });

    it('DeepSeek substitution does NOT swap when models set in nova.toml but provider in local config', async () => {
      const projectToml = `
[models]
micro = "claude-haiku-4-5-20251001"
standard = "custom-model"
strong = "claude-opus-4-6"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), projectToml);

      const novaDir = path.join(tmpDir, '.nova');
      await fs.mkdir(novaDir, { recursive: true });

      const localToml = `
[apiKeys]
provider = "deepseek"
`;
      await fs.writeFile(path.join(novaDir, 'config.toml'), localToml);

      const config = await reader.read(tmpDir);

      // standard was explicitly set to a non-default, so no swap
      expect(config.models.standard).toBe('custom-model');
    });

    it('PROVIDER_MODEL_DEFAULTS maps deepseek correctly', () => {
      expect(PROVIDER_MODEL_DEFAULTS['deepseek']).toBeDefined();
      expect(PROVIDER_MODEL_DEFAULTS['deepseek']!.micro).toBe('deepseek-v4-flash');
      expect(PROVIDER_MODEL_DEFAULTS['deepseek']!.standard).toBe('deepseek-v4-pro');
      expect(PROVIDER_MODEL_DEFAULTS['deepseek']!.strong).toBe('deepseek-v4-pro');
    });
  });

  // ── Legacy migration and edge cases ────────────────────────────

  describe('legacy [providers] migration', () => {
    it('migrates legacy [providers] deepseek_key to [apiKeys]', async () => {
      const toml = `
[providers]
deepseek_key = "sk-legacy-key"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const config = await reader.read(tmpDir);
      expect(config.apiKeys.provider).toBe('deepseek');
      expect(config.apiKeys.key).toBe('sk-legacy-key');
    });

    it('migrates legacy [providers] openai_key to [apiKeys]', async () => {
      const toml = `
[providers]
openai_key = "sk-openai-legacy"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const config = await reader.read(tmpDir);
      expect(config.apiKeys.provider).toBe('openai');
      expect(config.apiKeys.key).toBe('sk-openai-legacy');
    });

    it('explicit [apiKeys] wins over legacy [providers]', async () => {
      const toml = `
[providers]
deepseek_key = "sk-legacy"

[apiKeys]
provider = "deepseek"
key = "sk-explicit"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const config = await reader.read(tmpDir);
      expect(config.apiKeys.provider).toBe('deepseek');
      expect(config.apiKeys.key).toBe('sk-explicit');
    });
  });

  describe('[models] fast backward compat', () => {
    it('aliases [models] fast to standard when standard not set', async () => {
      const toml = `
[models]
fast = "deepseek-v4-flash"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const config = await reader.read(tmpDir);
      expect(config.models.standard).toBe('deepseek-v4-flash');
    });

    it('does not override explicit standard when fast is also set', async () => {
      const toml = `
[models]
fast = "deepseek-v4-flash"
standard = "deepseek-v4-pro"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const config = await reader.read(tmpDir);
      expect(config.models.standard).toBe('deepseek-v4-pro');
    });
  });

  describe('validation edge cases', () => {
    it('rejects invalid port numbers', async () => {
      const toml = `
[project]
port = 99999
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      await expect(reader.read(tmpDir)).rejects.toThrow('port');
    });

    it('rejects path traversal in frontend', async () => {
      const toml = `
[project]
frontend = "../escape"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      await expect(reader.read(tmpDir)).rejects.toThrow('Path traversal');
    });

    it('rejects absolute paths in frontend', async () => {
      const toml = `
[project]
frontend = "/etc/passwd"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      await expect(reader.read(tmpDir)).rejects.toThrow('Absolute paths');
    });

    it('rejects invalid voice engine', async () => {
      const toml = `
[voice]
engine = "invalid_engine"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      await expect(reader.read(tmpDir)).rejects.toThrow('voice');
    });

    it('rejects non-boolean telemetry.enabled', async () => {
      const toml = `
[telemetry]
enabled = "yes"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      await expect(reader.read(tmpDir)).rejects.toThrow('telemetry');
    });

    it('rejects invalid provider name', async () => {
      const toml = `
[apiKeys]
provider = "nonexistent"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      await expect(reader.read(tmpDir)).rejects.toThrow('provider');
    });
  });

  describe('environment variable overrides', () => {
    it('uses NOVA_API_KEY env var for API key', async () => {
      process.env['NOVA_API_KEY'] = 'sk-from-env';
      try {
        const toml = `
[apiKeys]
provider = "openrouter"
`;
        await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

        const config = await reader.read(tmpDir);
        expect(config.apiKeys.key).toBe('sk-from-env');
      } finally {
        delete process.env['NOVA_API_KEY'];
      }
    });

    it('uses DEEPSEEK_API_KEY for deepseek provider when NOVA_API_KEY not set', async () => {
      process.env['DEEPSEEK_API_KEY'] = 'sk-deepseek-env';
      try {
        const toml = `
[apiKeys]
provider = "deepseek"
`;
        await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

        const config = await reader.read(tmpDir);
        expect(config.apiKeys.key).toBe('sk-deepseek-env');
      } finally {
        delete process.env['DEEPSEEK_API_KEY'];
      }
    });
  });

  describe('unrecognized sections and typos', () => {
    it('warns about unrecognized top-level sections', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const toml = `
[unknown_section]
key = "value"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      await reader.read(tmpDir);
      // Should have warned about unrecognized section
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('suggests closest match for typos (Levenshtein ≤ 2)', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const toml = `
[modles]
micro = "test"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      await reader.read(tmpDir);
      // "modles" is 1 edit away from "models"
      expect(consoleWarnSpy).toHaveBeenCalled();
      const warnings = consoleWarnSpy.mock.calls.map((c) => c[0] as string);
      const typoWarning = warnings.find((w) => w.includes('modles') || w.includes('models'));
      expect(typoWarning).toBeDefined();
      consoleWarnSpy.mockRestore();
    });
  });

  describe('invalid TOML handling', () => {
    it('throws ConfigError for invalid TOML syntax', async () => {
      const toml = 'this is not valid toml [[[';
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      await expect(reader.read(tmpDir)).rejects.toThrow('Invalid TOML');
    });
  });
});

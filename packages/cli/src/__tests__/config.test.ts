import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ConfigReader } from '../config.js';
import { type NovaConfig, DEFAULT_CONFIG, ConfigError } from '@novastorm-ai/core';

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
        behavior: { autoCommit: true, branchPrefix: 'nova/', passiveSuggestions: true }, // branchPrefix and passiveSuggestions are default
      };

      await reader.write(tmpDir, config);

      const filePath = path.join(tmpDir, 'nova.toml');
      const exists = await fs.stat(filePath).then(() => true).catch(() => false);
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
});

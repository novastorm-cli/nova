import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ConfigReader } from '../config.js';

describe('ConfigReader: schema migration and typo detection', () => {
  let tmpDir: string;
  let reader: ConfigReader;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-migration-test-'));
    reader = new ConfigReader();
    savedEnv['NOVA_API_KEY'] = process.env['NOVA_API_KEY'];
    delete process.env['NOVA_API_KEY'];
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

  // ──────────────────────────────────────────────────────────────
  // Legacy [providers] → [apiKeys] migration
  // ──────────────────────────────────────────────────────────────

  describe('legacy [providers] migration', () => {
    it('migrates [providers] deepseek_key to [apiKeys] in project nova.toml', async () => {
      const toml = `
[providers]
deepseek_key = "sk-test-deepseek-key-123"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const warns: string[] = [];
      const logSpy = vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
        warns.push(String(args[0]));
      });

      try {
        const config = await reader.read(tmpDir);
        expect(config.apiKeys.provider).toBe('deepseek');
        expect(config.apiKeys.key).toBe('sk-test-deepseek-key-123');
        expect(warns.some((w) => w.includes('[providers]') && w.includes('migrated'))).toBe(true);
        expect(warns.some((w) => w.includes('[apiKeys]'))).toBe(true);
      } finally {
        logSpy.mockRestore();
      }
    });

    it('migrates [providers] openai_key to [apiKeys] in project nova.toml', async () => {
      const toml = `
[providers]
openai_key = "sk-openai-abc"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const config = await reader.read(tmpDir);
      expect(config.apiKeys.provider).toBe('openai');
      expect(config.apiKeys.key).toBe('sk-openai-abc');
    });

    it('migrates [providers] anthropic_key to [apiKeys]', async () => {
      const toml = `
[providers]
anthropic_key = "sk-ant-api-key"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const config = await reader.read(tmpDir);
      expect(config.apiKeys.provider).toBe('anthropic');
      expect(config.apiKeys.key).toBe('sk-ant-api-key');
    });

    it('migrates [providers] openrouter_key to [apiKeys]', async () => {
      const toml = `
[providers]
openrouter_key = "sk-or-key"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const config = await reader.read(tmpDir);
      expect(config.apiKeys.provider).toBe('openrouter');
      expect(config.apiKeys.key).toBe('sk-or-key');
    });

    it('migrates [providers] ollama_key to [apiKeys]', async () => {
      const toml = `
[providers]
ollama_key = ""
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const config = await reader.read(tmpDir);
      expect(config.apiKeys.provider).toBe('ollama');
      expect(config.apiKeys.key).toBe('');
    });

    it('migrates [providers] from local .nova/config.toml', async () => {
      const novaDir = path.join(tmpDir, '.nova');
      await fs.mkdir(novaDir, { recursive: true });
      const localToml = `
[providers]
deepseek_key = "sk-local-key-999"
`;
      await fs.writeFile(path.join(novaDir, 'config.toml'), localToml);

      const config = await reader.read(tmpDir);
      expect(config.apiKeys.provider).toBe('deepseek');
      expect(config.apiKeys.key).toBe('sk-local-key-999');
    });

    it('local [providers] migration overrides project [apiKeys]', async () => {
      const projectToml = `
[apiKeys]
provider = "openrouter"
key = "sk-original"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), projectToml);

      const novaDir = path.join(tmpDir, '.nova');
      await fs.mkdir(novaDir, { recursive: true });
      const localToml = `
[providers]
deepseek_key = "sk-local-override"
`;
      await fs.writeFile(path.join(novaDir, 'config.toml'), localToml);

      const config = await reader.read(tmpDir);
      // Local [providers] migration wins over project [apiKeys]
      expect(config.apiKeys.provider).toBe('deepseek');
      expect(config.apiKeys.key).toBe('sk-local-override');
    });

    it('[apiKeys] in same file takes precedence over [providers] in same file', async () => {
      const toml = `
[providers]
deepseek_key = "sk-legacy"

[apiKeys]
provider = "anthropic"
key = "sk-modern"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const logSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

      try {
        const config = await reader.read(tmpDir);
        // [apiKeys] should win since it comes after [providers] in merge
        // Wait - actually, the migration of [providers] happens BEFORE the read,
        // so [apiKeys] would overwrite the migrated [providers] value.
        // This is correct behavior: explicit [apiKeys] wins over legacy [providers].
        expect(config.apiKeys.provider).toBe('anthropic');
        expect(config.apiKeys.key).toBe('sk-modern');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('migration warning is printed exactly once per ConfigReader session', async () => {
      const tomlA = `
[providers]
deepseek_key = "sk-a"
`;
      const tomlB = `
[providers]
openai_key = "sk-b"
`;
      // Create two separate project dirs
      const tmpDirB = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-migration-test-2-'));
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), tomlA);
      await fs.writeFile(path.join(tmpDirB, 'nova.toml'), tomlB);

      const warns: string[] = [];
      const logSpy = vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
        warns.push(String(args[0]));
      });

      try {
        await reader.read(tmpDir);
        expect(warns.filter((w) => w.includes('migrated')).length).toBe(1);

        // Second read within same reader: no additional migration warning
        await reader.read(tmpDirB);
        expect(warns.filter((w) => w.includes('migrated')).length).toBe(1);
      } finally {
        logSpy.mockRestore();
        await fs.rm(tmpDirB, { recursive: true, force: true });
      }
    });

    it('ignores [providers] with unknown provider suffix', async () => {
      const toml = `
[providers]
unknown_provider_key = "sk-xxx"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      // Should not crash, just silently ignore unsupported provider
      const config = await reader.read(tmpDir);
      // Default provider should remain
      expect(config.apiKeys.provider).toBe('openrouter');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Typo detection for unrecognized top-level sections
  // ──────────────────────────────────────────────────────────────

  describe('typo detection for unrecognized sections', () => {
    it('warns when [telemtry] is used instead of [telemetry]', async () => {
      const toml = `
[telemtry]
enabled = false
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const warns: string[] = [];
      const logSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warns.push(String(args[0]));
      });

      try {
        await reader.read(tmpDir);
        // Check for a warning about unrecognized section
        const typoWarn = warns.find((w) => w.includes('telemtry') || w.includes('telemetry'));
        expect(typoWarn).toBeDefined();
        expect(typoWarn!.toLowerCase()).toContain('telemetry');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('warns when [beahvior] is used instead of [behavior]', async () => {
      const toml = `
[beahvior]
autoCommit = true
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const warns: string[] = [];
      const logSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warns.push(String(args[0]));
      });

      try {
        await reader.read(tmpDir);
        const typoWarn = warns.find((w) => w.includes('beahvior') || w.includes('behavior'));
        expect(typoWarn).toBeDefined();
        expect(typoWarn!.toLowerCase()).toContain('behavior');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('warns when [models] is used (typo instead of [models])', async () => {
      const toml = `
[modls]
micro = "gpt-4o-mini"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const warns: string[] = [];
      const logSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warns.push(String(args[0]));
      });

      try {
        await reader.read(tmpDir);
        const typoWarn = warns.find((w) => w.includes('modls') || w.includes('models'));
        expect(typoWarn).toBeDefined();
        // Should suggest 'models'
        expect(typoWarn!.toLowerCase()).toContain('models');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('warns about unrecognized section with no close match', async () => {
      const toml = `
[completely_random_section]
foo = "bar"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const warns: string[] = [];
      const logSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warns.push(String(args[0]));
      });

      try {
        await reader.read(tmpDir);
        // Should emit an unrecognized section warning
        const sectionWarn = warns.find(
          (w) => w.includes('completely_random_section') || w.includes('unrecognized'),
        );
        expect(sectionWarn).toBeDefined();
      } finally {
        logSpy.mockRestore();
      }
    });

    it('[apiKeys] used correctly does not trigger typo warning', async () => {
      const toml = `
[apiKeys]
provider = "deepseek"
key = "sk-valid"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const warns: string[] = [];
      const logSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warns.push(String(args[0]));
      });

      try {
        await reader.read(tmpDir);
        // No typo warnings should appear
        const typoWarns = warns.filter((w) => w.includes('Did you mean'));
        expect(typoWarns.length).toBe(0);
      } finally {
        logSpy.mockRestore();
      }
    });

    it('all known sections do not trigger typo warnings', async () => {
      const toml = `
[project]
devCommand = "npm run dev"
port = 3500

[models]
micro = "gpt-4o-mini"
standard = "gpt-4o"
strong = "claude-opus"

[apiKeys]
provider = "anthropic"
key = "sk-test"

[behavior]
autoCommit = false

[voice]
enabled = true
engine = "web"

[telemetry]
enabled = false

[license]
key = "NOVA-XXXX"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const warns: string[] = [];
      const logSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warns.push(String(args[0]));
      });

      try {
        await reader.read(tmpDir);
        const typoWarns = warns.filter(
          (w) => w.includes('Did you mean') || w.includes('unrecognized'),
        );
        expect(typoWarns.length).toBe(0);
      } finally {
        logSpy.mockRestore();
      }
    });

    it('typo in section name [projct] suggests [project]', async () => {
      const toml = `
[projct]
port = 3000
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const warns: string[] = [];
      const logSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warns.push(String(args[0]));
      });

      try {
        await reader.read(tmpDir);
        const typoWarn = warns.find((w) => w.includes('projct') || w.includes('project'));
        expect(typoWarn).toBeDefined();
        expect(typoWarn!.toLowerCase()).toContain('project');
      } finally {
        logSpy.mockRestore();
      }
    });

    it('typo with edit distance > 2 does NOT suggest a match', async () => {
      const toml = `
[abcdefghijkl]
foo = "bar"
`;
      await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

      const warns: string[] = [];
      const logSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
        warns.push(String(args[0]));
      });

      try {
        await reader.read(tmpDir);
        // Should mention unrecognized section but not suggest a match
        const sectionWarn = warns.find(
          (w) => w.includes('abcdefghijkl') || w.includes('unrecognized'),
        );
        expect(sectionWarn).toBeDefined();
        // Should NOT suggest a "Did you mean" match
        const didYouMeanWarn = warns.find((w) => w.includes('Did you mean'));
        expect(didYouMeanWarn).toBeUndefined();
      } finally {
        logSpy.mockRestore();
      }
    });
  });
});

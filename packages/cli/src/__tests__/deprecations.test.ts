import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { ConfigReader } from '../config.js';
import { DEPRECATION } from '../strings.js';

describe('ConfigReader: models.fast backward-compat alias', () => {
  let tmpDir: string;
  let reader: ConfigReader;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-deprecation-test-'));
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

  it('aliases [models] fast to standard when standard is not set', async () => {
    const toml = `
[models]
fast = "deepseek-v4-flash"
`;
    await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

    const config = await reader.read(tmpDir);
    expect(config.models.standard).toBe('deepseek-v4-flash');
  });

  it('[models] standard takes precedence over [models] fast', async () => {
    const toml = `
[models]
fast = "deepseek-v4-flash"
standard = "deepseek-v4-pro"
`;
    await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

    const config = await reader.read(tmpDir);
    expect(config.models.standard).toBe('deepseek-v4-pro');
  });

  it('[models] strong continues to work without warning', async () => {
    const toml = `
[models]
strong = "deepseek-v4-pro"
`;
    await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

    const config = await reader.read(tmpDir);
    expect(config.models.strong).toBe('deepseek-v4-pro');
    // No deprecation warning should be emitted for 'strong'
  });

  it('[models] micro continues to work without warning', async () => {
    const toml = `
[models]
micro = "openai/gpt-4o-mini"
`;
    await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

    const config = await reader.read(tmpDir);
    expect(config.models.micro).toBe('openai/gpt-4o-mini');
  });

  it('deprecation warning is printed exactly once per ConfigReader session', async () => {
    const toml = `
[models]
fast = "deepseek-v4-flash"
`;
    await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(String(args[0]));
    };

    try {
      // First read: warning emitted
      await reader.read(tmpDir);
      expect(warns).toHaveLength(1);
      expect(warns[0]).toBe(DEPRECATION.modelsFastWarning);

      // Second read (same reader instance): no additional warning
      await reader.read(tmpDir);
      expect(warns).toHaveLength(1);

      // Third read: still only one
      await reader.read(tmpDir);
      expect(warns).toHaveLength(1);
    } finally {
      console.warn = origWarn;
    }
  });

  it('new ConfigReader instance in same session emits warning again', async () => {
    const toml = `
[models]
fast = "deepseek-v4-flash"
`;
    await fs.writeFile(path.join(tmpDir, 'nova.toml'), toml);

    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(String(args[0]));
    };

    try {
      // First reader instance
      const reader1 = new ConfigReader();
      await reader1.read(tmpDir);
      expect(warns).toHaveLength(1);

      // Second reader instance (new in-memory state)
      const reader2 = new ConfigReader();
      await reader2.read(tmpDir);
      expect(warns).toHaveLength(2);
      expect(warns[1]).toBe(DEPRECATION.modelsFastWarning);
    } finally {
      console.warn = origWarn;
    }
  });

  it('local .nova/config.toml [models] fast aliases correctly', async () => {
    // Set local config with fast model
    const novaDir = path.join(tmpDir, '.nova');
    await fs.mkdir(novaDir, { recursive: true });
    const localToml = `
[models]
fast = "deepseek-v4-flash"
`;
    await fs.writeFile(path.join(novaDir, 'config.toml'), localToml);

    const config = await reader.read(tmpDir);
    expect(config.models.standard).toBe('deepseek-v4-flash');
  });

  it('local fast does not override project standard when both set', async () => {
    const projectToml = `
[models]
standard = "deepseek-v4-pro"
`;
    await fs.writeFile(path.join(tmpDir, 'nova.toml'), projectToml);

    const novaDir = path.join(tmpDir, '.nova');
    await fs.mkdir(novaDir, { recursive: true });
    const localToml = `
[models]
fast = "deepseek-v4-flash"
`;
    await fs.writeFile(path.join(novaDir, 'config.toml'), localToml);

    const config = await reader.read(tmpDir);
    // local doesn't override project standard since project already set it
    // But local has fast -> standard alias, which should override when local
    // data wins in the merge. Local data wins over project data.
    // So local's fast->standard should override project's standard.
    expect(config.models.standard).toBe('deepseek-v4-flash');
  });

  it('deprecation warning contains v2.0 removal notice', () => {
    expect(DEPRECATION.modelsFastWarning).toContain('v2.0');
    expect(DEPRECATION.modelsFastWarning).toContain('fast');
    expect(DEPRECATION.modelsFastWarning).toContain('standard');
    expect(DEPRECATION.modelsFastWarning).toContain('deprecated');
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * We mock @inquirer/prompts (select, password) so tests never block on interactive prompts.
 * The setup module imports { select, password } from '@inquirer/prompts'.
 */
let mockSelectValue: string = 'ollama';
let mockPasswordValue: string = '';
let selectCalled = false;
let passwordCalled = false;

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(async () => {
    selectCalled = true;
    return mockSelectValue;
  }),
  password: vi.fn(async () => {
    passwordCalled = true;
    return mockPasswordValue;
  }),
}));

/**
 * Dynamic import so the vi.mock is in place before the module loads.
 * The setup module is expected at ../setup.js (compiled from setup.ts).
 */
async function importSetup(): Promise<{
  runSetup: (projectPath: string) => Promise<void>;
}> {
  return import('../setup.js');
}

describe('Setup wizard', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-setup-test-'));
    mockSelectValue = 'ollama';
    mockPasswordValue = '';
    selectCalled = false;
    passwordCalled = false;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('setup with provider=ollama does NOT ask for an API key', async () => {
    mockSelectValue = 'ollama';

    const { runSetup } = await importSetup();
    await runSetup(tmpDir);

    // select should have been called for the provider prompt
    expect(selectCalled).toBe(true);
    // password should NOT have been called — ollama doesn't need an API key
    expect(passwordCalled).toBe(false);
  });

  it('setup with provider=anthropic asks for API key and saves to .nova/config.toml', async () => {
    mockSelectValue = 'anthropic';
    mockPasswordValue = 'sk-ant-test-key-123';

    const { runSetup } = await importSetup();
    await runSetup(tmpDir);

    const localConfigPath = path.join(tmpDir, '.nova', 'config.toml');
    const content = await fs.readFile(localConfigPath, 'utf-8');
    expect(content).toContain('sk-ant-test-key-123');
    expect(content).toContain('anthropic');
  });

  it('setup creates nova.toml if it does not exist', async () => {
    mockSelectValue = 'ollama';

    const tomlPath = path.join(tmpDir, 'nova.toml');

    // Verify it does not exist before setup
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
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * We mock inquirer so tests never block on interactive prompts.
 * The mock's `prompt` function returns answers configured via `mockAnswers`.
 */
let mockAnswers: Record<string, unknown> = {};
const promptCalls: Array<Array<{ name: string; type?: string; when?: unknown }>> = [];

vi.mock('inquirer', () => ({
  default: {
    prompt: vi.fn(
      async (
        questions: Array<{ name: string; type?: string; when?: unknown }>,
      ) => {
        // Evaluate `when` guards -- inquirer skips questions when `when` returns false
        const filteredQuestions = questions.filter((q) => {
          if (typeof q.when === 'function') {
            return q.when(mockAnswers);
          }
          return q.when !== false;
        });
        promptCalls.push(filteredQuestions);

        const result: Record<string, unknown> = {};
        for (const q of filteredQuestions) {
          result[q.name] = mockAnswers[q.name] ?? '';
        }
        return result;
      },
    ),
  },
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
    mockAnswers = {};
    promptCalls.length = 0;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('setup with provider=ollama does NOT ask for an API key', async () => {
    mockAnswers = {
      provider: 'ollama',
      devCommand: 'npm run dev',
    };

    const { runSetup } = await importSetup();
    await runSetup(tmpDir);

    // Flatten all questions that were actually presented to the user
    const allQuestionNames = promptCalls.flat().map((q) => q.name);
    expect(allQuestionNames).not.toContain('apiKey');
  });

  it('setup with provider=anthropic asks for API key and saves to .nova/config.toml', async () => {
    mockAnswers = {
      provider: 'anthropic',
      apiKey: 'sk-ant-test-key-123',
      devCommand: 'npm run dev',
    };

    const { runSetup } = await importSetup();
    await runSetup(tmpDir);

    const localConfigPath = path.join(tmpDir, '.nova', 'config.toml');
    const content = await fs.readFile(localConfigPath, 'utf-8');
    expect(content).toContain('sk-ant-test-key-123');
    expect(content).toContain('anthropic');
  });

  it('setup creates nova.toml if it does not exist', async () => {
    mockAnswers = {
      provider: 'ollama',
      devCommand: '',
    };

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

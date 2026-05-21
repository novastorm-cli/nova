import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentPromptLoader } from '../AgentPromptLoader.js';
import { DEFAULT_AGENT_PROMPTS } from '../agentPrompts.js';

// Mock fs/promises
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';

const mockedReadFile = vi.mocked(readFile);

describe('AgentPromptLoader', () => {
  const loader = new AgentPromptLoader();
  const projectPath = '/projects/test';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns custom prompt from .nova/agents/ when file exists', async () => {
    const customPrompt = 'Custom developer prompt';
    mockedReadFile.mockResolvedValue(customPrompt);

    const result = await loader.load('developer', projectPath);
    expect(result).toBe(customPrompt);
    expect(mockedReadFile).toHaveBeenCalledWith(
      '/projects/test/.nova/agents/developer.md',
      'utf-8',
    );
  });

  it('falls back to default when file does not exist', async () => {
    mockedReadFile.mockRejectedValue(new Error('ENOENT'));

    const result = await loader.load('developer', projectPath);
    expect(result).toBe(DEFAULT_AGENT_PROMPTS['developer']);
  });

  it('falls back to default when file is empty', async () => {
    mockedReadFile.mockResolvedValue('   ');

    const result = await loader.load('developer', projectPath);
    expect(result).toBe(DEFAULT_AGENT_PROMPTS['developer']);
  });

  it('loads all three agent prompts with defaults', async () => {
    mockedReadFile.mockRejectedValue(new Error('ENOENT'));

    for (const agent of ['developer', 'tester', 'director']) {
      const result = await loader.load(agent, projectPath);
      expect(result).toBe(DEFAULT_AGENT_PROMPTS[agent]);
      expect(result.length).toBeGreaterThan(0);
    }
  });

  it('returns empty string for unknown agent name', async () => {
    mockedReadFile.mockRejectedValue(new Error('ENOENT'));
    const result = await loader.load('unknown_agent', projectPath);
    expect(result).toBe('');
  });
});

describe('AgentPromptLoader — orchestrator', () => {
  const loader = new AgentPromptLoader();
  const projectPath = '/projects/test';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns default orchestrator prompt when file does not exist', async () => {
    mockedReadFile.mockRejectedValue(new Error('ENOENT'));

    const result = await loader.load('orchestrator', projectPath);
    expect(result).toBe(DEFAULT_AGENT_PROMPTS['orchestrator']);
    expect(result.length).toBeGreaterThan(0);
    // Must contain task decomposition instructions
    expect(result).toContain('decompose');
    expect(result).toContain('features');
    expect(result).toContain('JSON');
  });

  it('returns custom orchestrator prompt when file exists', async () => {
    const customPrompt = 'Custom orchestrator prompt — you are a task planner';
    mockedReadFile.mockResolvedValue(customPrompt);

    const result = await loader.load('orchestrator', projectPath);
    expect(result).toBe(customPrompt);
    expect(mockedReadFile).toHaveBeenCalledWith(
      '/projects/test/.nova/agents/orchestrator.md',
      'utf-8',
    );
  });

  it('falls back to default when orchestrator file is empty', async () => {
    mockedReadFile.mockResolvedValue('   ');

    const result = await loader.load('orchestrator', projectPath);
    expect(result).toBe(DEFAULT_AGENT_PROMPTS['orchestrator']);
  });
});

describe('AgentPromptLoader — worker', () => {
  const loader = new AgentPromptLoader();
  const projectPath = '/projects/test';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns default worker prompt when file does not exist', async () => {
    mockedReadFile.mockRejectedValue(new Error('ENOENT'));

    const result = await loader.load('worker', projectPath);
    expect(result).toBe(DEFAULT_AGENT_PROMPTS['worker']);
    expect(result.length).toBeGreaterThan(0);
    // Must contain code generation instructions
    expect(result).toContain('FILE');
    expect(result).toContain('DIFF');
    expect(result).toContain('DELETE');
  });

  it('returns custom worker prompt when file exists', async () => {
    const customPrompt = 'Custom worker prompt — you implement features';
    mockedReadFile.mockResolvedValue(customPrompt);

    const result = await loader.load('worker', projectPath);
    expect(result).toBe(customPrompt);
    expect(mockedReadFile).toHaveBeenCalledWith(
      '/projects/test/.nova/agents/worker.md',
      'utf-8',
    );
  });

  it('falls back to default when worker file is empty', async () => {
    mockedReadFile.mockResolvedValue('   ');

    const result = await loader.load('worker', projectPath);
    expect(result).toBe(DEFAULT_AGENT_PROMPTS['worker']);
  });
});

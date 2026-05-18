import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LlmClient } from '../../contracts/ILlmClient.js';
import { ProviderError } from '../../contracts/ILlmClient.js';
import type { Observation, ProjectMap, TaskItem } from '../../models/types.js';
import { BrainError } from '../../contracts/IBrain.js';

// ── Mock LlmClient ────────────────────────────────────────────

function createMockLlmClient(responses: string[]): LlmClient {
  let callIndex = 0;
  return {
    supportsVision: true,
    chat: vi.fn(async () => ({ content: responses[callIndex++] ?? '' })),
    chatWithVision: vi.fn(async () => ({ content: responses[callIndex++] ?? '' })),
    stream: vi.fn(),
  };
}

// ── Mock data ──────────────────────────────────────────────────

function createObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    screenshot: Buffer.from('fake-screenshot-png'),
    currentUrl: '/dashboard',
    transcript: 'Make the header blue',
    timestamp: Date.now(),
    ...overrides,
  };
}

function createProjectMap(overrides: Partial<ProjectMap> = {}): ProjectMap {
  return {
    stack: {
      framework: 'next.js',
      language: 'typescript',
      packageManager: 'npm',
      typescript: true,
    },
    devCommand: 'npm run dev',
    port: 3000,
    routes: [{ path: '/dashboard', filePath: 'app/dashboard/page.tsx', type: 'page' }],
    components: [],
    endpoints: [],
    models: [],
    dependencies: new Map(),
    fileContexts: new Map(),
    compressedContext: 'Project: Next.js dashboard app with TypeScript',
    ...overrides,
  };
}

// ── Valid LLM response ─────────────────────────────────────────

const VALID_TASKS_JSON = JSON.stringify([
  {
    id: 'task-1',
    description: 'Change header background color to blue',
    files: ['app/dashboard/page.tsx'],
    type: 'css',
    lane: 1,
    status: 'pending',
  },
  {
    id: 'task-2',
    description: 'Add search input to dashboard',
    files: ['app/dashboard/page.tsx'],
    type: 'single_file',
    lane: 2,
    status: 'pending',
  },
]);

// ── Tests ──────────────────────────────────────────────────────

const { Brain } = await import('../Brain.js');

describe('Brain', () => {
  let observation: Observation;
  let projectMap: ProjectMap;

  beforeEach(() => {
    observation = createObservation();
    projectMap = createProjectMap();
  });

  // ── analyze() sends screenshot to chatWithVision ───────────

  it('analyze() sends screenshot to chatWithVision', async () => {
    const llm = createMockLlmClient([VALID_TASKS_JSON]);
    const brain = new Brain(llm);

    await brain.analyze(observation, projectMap);

    expect(llm.chatWithVision).toHaveBeenCalledOnce();

    const [messages, images] = (llm.chatWithVision as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
    expect(Array.isArray(images)).toBe(true);
    expect(images).toHaveLength(1);
    expect(Buffer.isBuffer(images[0])).toBe(true);
    expect(images[0]).toBe(observation.screenshot);
  });

  // ── analyze() parses JSON response into TaskItem[] ─────────

  it('analyze() parses JSON response into TaskItem[]', async () => {
    const llm = createMockLlmClient([VALID_TASKS_JSON]);
    const brain = new Brain(llm);

    const tasks: TaskItem[] = await brain.analyze(observation, projectMap);

    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!).toMatchObject({
      description: expect.any(String),
      files: expect.any(Array),
      type: expect.any(String),
      status: expect.any(String),
    });
    expect(tasks[1]!.description).toBe('Add search input to dashboard');
  });

  // ── analyze() assigns lane to each task ────────────────────

  it('analyze() assigns lane to each task', async () => {
    const llm = createMockLlmClient([VALID_TASKS_JSON]);
    const brain = new Brain(llm);

    const tasks = await brain.analyze(observation, projectMap);

    for (const task of tasks) {
      expect(task.lane).toBeDefined();
      expect([1, 2, 3, 4]).toContain(task.lane);
    }
  });

  // ── analyze() with invalid JSON retries then throws BrainError ─

  it('analyze() with invalid JSON retries then throws BrainError after 2 failures', async () => {
    const llm = createMockLlmClient([
      'This is not valid JSON at all',
      '{ also broken json [',
      '{ still broken',
    ]);
    const brain = new Brain(llm);

    await expect(brain.analyze(observation, projectMap)).rejects.toThrow(BrainError);

    // Should have been called at least twice (initial + retry)
    const callCount = (llm.chatWithVision as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  // ── analyze() falls back to text-only chat on NO_VISION_SUPPORT ─

  it('analyze() falls back to text-only chat when vision is not supported', async () => {
    // Provider does not support vision — the pre-check skips chatWithVision entirely
    const llm = {
      supportsVision: false,
      chat: vi.fn(async () => ({ content: VALID_TASKS_JSON })),
      chatWithVision: vi.fn(async () => {
        throw new ProviderError(
          'DeepSeek does not support vision.',
          undefined,
          'deepseek',
          'NO_VISION_SUPPORT',
        );
      }),
      stream: vi.fn(),
    };
    const brain = new Brain(llm);

    const tasks = await brain.analyze(observation, projectMap);

    // Pre-check prevents calling chatWithVision — falls back immediately to text-only
    expect(llm.chatWithVision).not.toHaveBeenCalled();

    // Should have called text-only chat (which succeeded)
    expect(llm.chat).toHaveBeenCalledOnce();

    // Should have parsed tasks successfully
    expect(tasks).toHaveLength(2);
  });

  // ── analyze() without screenshot uses text-only chat directly ─

  it('analyze() without screenshot uses text-only chat directly', async () => {
    // Create an observation without screenshot (delete the property)
    const obsNoScreenshot = { ...createObservation() };
    delete (obsNoScreenshot as Record<string, unknown>).screenshot;
    const llm = createMockLlmClient([VALID_TASKS_JSON]);
    const brain = new Brain(llm);

    await brain.analyze(obsNoScreenshot, projectMap);

    // Should NOT call chatWithVision (no screenshot)
    expect(llm.chatWithVision).not.toHaveBeenCalled();

    // Should call text-only chat
    expect(llm.chat).toHaveBeenCalledOnce();
  });
});

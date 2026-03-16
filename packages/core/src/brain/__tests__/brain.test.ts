import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LlmClient, Observation, ProjectMap, Message, TaskItem } from '../../models/types.js';
import { BrainError } from '../../contracts/IBrain.js';

// ── Mock LlmClient ────────────────────────────────────────────

function createMockLlmClient(responses: string[]): LlmClient {
  let callIndex = 0;
  return {
    chat: vi.fn(async () => responses[callIndex++] ?? ''),
    chatWithVision: vi.fn(async () => responses[callIndex++] ?? ''),
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
    routes: [
      { path: '/dashboard', filePath: 'app/dashboard/page.tsx', type: 'page' },
    ],
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

    const [messages, images] = (llm.chatWithVision as ReturnType<typeof vi.fn>).mock.calls[0];
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
    expect(tasks[0]).toMatchObject({
      description: expect.any(String),
      files: expect.any(Array),
      type: expect.any(String),
      status: expect.any(String),
    });
    expect(tasks[1].description).toBe('Add search input to dashboard');
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
});

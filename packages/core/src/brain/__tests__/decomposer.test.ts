import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LlmClient, ProjectMap, TaskItem } from '../../models/types.js';

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

function createProjectMap(): ProjectMap {
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
    components: [
      {
        name: 'Header',
        filePath: 'components/Header.tsx',
        type: 'component',
        exports: ['Header'],
      },
    ],
    endpoints: [],
    models: [],
    dependencies: new Map(),
    fileContexts: new Map(),
    compressedContext: 'Project: Next.js dashboard app',
  };
}

function createTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'task-1',
    description: 'Fix button styling',
    files: ['components/Button.tsx'],
    type: 'single_file',
    lane: 2,
    status: 'pending',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────

const { TaskDecomposer } = await import('../TaskDecomposer.js');

describe('TaskDecomposer', () => {
  let projectMap: ProjectMap;

  beforeEach(() => {
    projectMap = createProjectMap();
  });

  // ── decompose(lane 2 task) returns [task] unchanged ────────

  it('decompose(lane 2 task) returns [task] unchanged', async () => {
    const task = createTask({ lane: 2, description: 'Fix button hover state' });
    const llm = createMockLlmClient([]);
    const decomposer = new TaskDecomposer(llm);

    const result = await decomposer.decompose(task, projectMap);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(task);
    // LLM should NOT be called for simple tasks
    expect(llm.chat).not.toHaveBeenCalled();
  });

  // ── decompose(lane 3 task) calls LLM, returns subtasks ────

  it('decompose(lane 3 task) calls LLM and returns subtasks with lanes', async () => {
    const task = createTask({
      lane: 3,
      description: 'Add user management page with API endpoint',
      files: ['app/users/page.tsx', 'app/api/users/route.ts'],
      type: 'multi_file',
    });

    const subtasksJson = JSON.stringify([
      {
        id: 'task-1-a',
        description: 'Create user API route handler',
        files: ['app/api/users/route.ts'],
        type: 'single_file',
        lane: 2,
        status: 'pending',
      },
      {
        id: 'task-1-b',
        description: 'Create user management page component',
        files: ['app/users/page.tsx'],
        type: 'single_file',
        lane: 2,
        status: 'pending',
      },
    ]);

    const llm = createMockLlmClient([subtasksJson]);
    const decomposer = new TaskDecomposer(llm);

    const result = await decomposer.decompose(task, projectMap);

    expect(llm.chat).toHaveBeenCalledOnce();
    expect(result.length).toBeGreaterThanOrEqual(2);

    for (const subtask of result) {
      expect(subtask.lane).toBeDefined();
      expect([1, 2, 3, 4]).toContain(subtask.lane);
      expect(subtask.description).toBeTruthy();
      expect(Array.isArray(subtask.files)).toBe(true);
    }
  });
});

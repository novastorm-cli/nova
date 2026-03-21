import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  TaskItem,
  ProjectMap,
  StackInfo,
  ExecutionResult,
  LlmClient,
} from '../../models/types.js';
import type { IGitManager } from '../../contracts/IGitManager.js';
import type { EventBus } from '../../models/events.js';

const { Lane4Executor } = await import('../Lane4Executor.js');
const { BackgroundQueue } = await import('../BackgroundQueue.js');

function createTaskItem(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'task-lane4-1',
    description: 'Refactor authentication module',
    files: ['src/auth.ts'],
    type: 'refactor',
    lane: 4,
    status: 'pending',
    ...overrides,
  };
}

function createProjectMap(): ProjectMap {
  const stack: StackInfo = {
    framework: 'next.js',
    language: 'typescript',
    packageManager: 'npm',
    typescript: true,
  };

  return {
    stack,
    devCommand: 'npm run dev',
    port: 3000,
    routes: [],
    components: [],
    endpoints: [],
    models: [],
    dependencies: new Map(),
    fileContexts: new Map(),
    compressedContext: '',
  };
}

function createMockLlmClient(): LlmClient {
  const mockStream = async function* () {
    yield '=== FILE: src/auth.ts ===\nconsole.log("refactored");\n=== END FILE ===';
  };

  return {
    chat: vi.fn().mockResolvedValue('=== FILE: src/auth.ts ===\nconsole.log("refactored");\n=== END FILE ==='),
    chatWithVision: vi.fn().mockResolvedValue(''),
    stream: vi.fn().mockReturnValue(mockStream()),
  };
}

function createMockGitManager(): IGitManager {
  return {
    createBranch: vi.fn().mockResolvedValue('nova/bg-1234567890'),
    commit: vi.fn().mockResolvedValue('def5678'),
    rollback: vi.fn().mockResolvedValue(undefined),
    getDiff: vi.fn().mockResolvedValue(''),
    getLog: vi.fn().mockResolvedValue([]),
    getCurrentBranch: vi.fn().mockResolvedValue('main'),
    getDevCount: vi.fn().mockResolvedValue(1),
    hasUncommittedChanges: vi.fn().mockResolvedValue(false),
    stash: vi.fn().mockResolvedValue(undefined),
    unstash: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockEventBus(): EventBus {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
}

describe('Lane4Executor', () => {
  let tmpDir: string;
  let queuePath: string;
  let queue: InstanceType<typeof BackgroundQueue>;
  let mockLlm: LlmClient;
  let mockGit: IGitManager;
  let mockEventBus: EventBus;
  let executor: InstanceType<typeof Lane4Executor>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane4-test-'));
    queuePath = path.join(tmpDir, '.nova', 'queue');
    fs.mkdirSync(queuePath, { recursive: true });

    queue = new BackgroundQueue(queuePath);
    mockLlm = createMockLlmClient();
    mockGit = createMockGitManager();
    mockEventBus = createMockEventBus();

    executor = new Lane4Executor(
      tmpDir,
      mockLlm,
      mockGit,
      mockEventBus,
      queue,
      'test-model',
    );
  });

  afterEach(async () => {
    executor.stop();
    // Allow any pending async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 50));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns success immediately (fire-and-forget)', async () => {
    const task = createTaskItem();
    const projectMap = createProjectMap();

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    expect(result.taskId).toBe('task-lane4-1');
  });

  it('enqueues task and emits background_queued event', async () => {
    const task = createTaskItem();
    const projectMap = createProjectMap();

    await executor.execute(task, projectMap);

    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'background_queued',
        data: expect.objectContaining({ taskId: 'task-lane4-1' }),
      }),
    );

    // Task should be in the queue
    const all = await queue.getAll();
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  it('creates a git branch for background work', async () => {
    const task = createTaskItem();
    const projectMap = createProjectMap();

    await executor.execute(task, projectMap);

    // Give the background processing a moment to start
    await new Promise((r) => setTimeout(r, 100));

    expect(mockGit.createBranch).toHaveBeenCalledWith('nova/bg-');
  });

  it('emits background_started with branch name', async () => {
    const task = createTaskItem();
    const projectMap = createProjectMap();

    await executor.execute(task, projectMap);
    await new Promise((r) => setTimeout(r, 200));

    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'background_started',
        data: { taskId: 'task-lane4-1', branch: 'nova/bg-1234567890' },
      }),
    );
  });

  it('emits background_failed on git error', async () => {
    (mockGit.createBranch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Branch creation failed'),
    );

    const task = createTaskItem();
    const projectMap = createProjectMap();

    await executor.execute(task, projectMap);
    await new Promise((r) => setTimeout(r, 200));

    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'background_failed',
        data: expect.objectContaining({
          taskId: 'task-lane4-1',
          error: 'Branch creation failed',
        }),
      }),
    );
  });

  it('start/stop controls polling', () => {
    executor.start();
    // Starting again should be idempotent
    executor.start();
    executor.stop();
    // Stopping again should be safe
    executor.stop();
  });

  it('processQueue processes queued tasks', async () => {
    const task = createTaskItem();
    await queue.enqueue(task);

    await executor.processQueue();

    expect(mockGit.createBranch).toHaveBeenCalledWith('nova/bg-');
  });

  it('processQueue is a no-op when queue is empty', async () => {
    await executor.processQueue();
    expect(mockGit.createBranch).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  TaskItem,
  ProjectMap,
  StackInfo,
  ExecutionResult,
} from '../../models/types.js';
import type { ILane1Executor, ILane2Executor, IExecutorPool } from '../../contracts/IExecutor.js';
import type { EventBus } from '../../models/events.js';

const { ExecutorPool } = await import('../ExecutorPool.js');

function createTaskItem(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'task-pool-1',
    description: 'test task',
    files: ['file.ts'],
    type: 'css',
    lane: 1,
    status: 'pending',
    ...overrides,
  };
}

function createProjectMap(): ProjectMap {
  const stack: StackInfo = {
    framework: 'vite',
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

function createMockLane1Executor(): ILane1Executor {
  return {
    execute: vi.fn().mockResolvedValue({
      success: true,
      taskId: 'task-pool-1',
      diff: '--- a/style.css\n+++ b/style.css\n@@ -1 +1 @@\n-color: red\n+color: blue',
    } satisfies ExecutionResult),
  };
}

function createMockLane2Executor(): ILane2Executor {
  return {
    execute: vi.fn().mockResolvedValue({
      success: true,
      taskId: 'task-pool-2',
      diff: '--- a/file.ts\n+++ b/file.ts',
      commitHash: 'abc1234',
    } satisfies ExecutionResult),
  };
}

function createMockEventBus(): EventBus {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
}

describe('ExecutorPool', () => {
  let mockLane1: ILane1Executor;
  let mockLane2: ILane2Executor;
  let mockEventBus: EventBus;
  let pool: IExecutorPool;

  beforeEach(() => {
    mockLane1 = createMockLane1Executor();
    mockLane2 = createMockLane2Executor();
    mockEventBus = createMockEventBus();
    pool = new ExecutorPool(mockLane1, mockLane2, mockEventBus);
  });

  it('routes a lane 1 task to Lane1Executor', async () => {
    const task = createTaskItem({ lane: 1, type: 'css' });
    const projectMap = createProjectMap();

    const result = await pool.execute(task, projectMap);

    expect(mockLane1.execute).toHaveBeenCalledOnce();
    expect(mockLane1.execute).toHaveBeenCalledWith(task, projectMap);
    expect(mockLane2.execute).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.diff).toBeDefined();
  });

  it('routes a lane 2 task to Lane2Executor', async () => {
    const task = createTaskItem({
      id: 'task-pool-2',
      lane: 2,
      type: 'single_file',
      description: 'Add loading spinner',
    });
    const projectMap = createProjectMap();

    const result = await pool.execute(task, projectMap);

    expect(mockLane2.execute).toHaveBeenCalledOnce();
    expect(mockLane2.execute).toHaveBeenCalledWith(task, projectMap);
    expect(mockLane1.execute).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.commitHash).toBe('abc1234');
  });
});

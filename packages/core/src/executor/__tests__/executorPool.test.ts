import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TaskItem, ProjectMap, StackInfo, ExecutionResult } from '../../models/types.js';
import type { ILane1Executor, ILane2Executor } from '../../contracts/IExecutor.js';
import type { NovaEvent, EventBus } from '../../models/events.js';

const { ExecutorPool } = await import('../ExecutorPool.js');
const { RetryPolicy } = await import('../RetryPolicy.js');

// Use ExecutorPool (the class) for type so we can access getRetryPolicy/getFsm
type ExecutorPoolType = InstanceType<typeof ExecutorPool>;

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
  let pool: ExecutorPoolType;

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

  // ============================================================
  // FSM transition tests
  // ============================================================

  it('emits fsm_transition events during successful task execution', async () => {
    const task = createTaskItem({ lane: 1, type: 'css' });
    const projectMap = createProjectMap();

    await pool.execute(task, projectMap);

    // Verify fsm_transition events were emitted for Planning→Generating and Validating→Committing
    const fsmEvents = (mockEventBus.emit as ReturnType<typeof vi.fn>).mock.calls
      .map((call: unknown[]) => call[0] as NovaEvent)
      .filter((e: NovaEvent) => e.type === 'fsm_transition');

    expect(fsmEvents.length).toBeGreaterThanOrEqual(2);

    // First transition: Planning → Generating
    const firstTransition = fsmEvents.find(
      (e: Extract<NovaEvent, { type: 'fsm_transition' }>) => e.next === 'Generating',
    );
    expect(firstTransition).toBeDefined();
    expect(firstTransition!.task_id).toBe(task.id);
    expect(firstTransition!.prev).toBe('Planning');

    // Last transition: Validating → Committing
    const lastTransition = fsmEvents.find(
      (e: Extract<NovaEvent, { type: 'fsm_transition' }>) => e.next === 'Committing',
    );
    expect(lastTransition).toBeDefined();
    expect(lastTransition!.task_id).toBe(task.id);
    expect(lastTransition!.prev).toBe('Validating');
  });

  it('emits fsm_transition to Failed state on task failure', async () => {
    const failingLane1 = {
      execute: vi.fn().mockResolvedValue({
        success: false,
        taskId: 'task-pool-fail',
        error: 'Something went wrong',
      } satisfies ExecutionResult),
    };

    const failPool = new ExecutorPool(failingLane1, mockLane2, mockEventBus);

    const task = createTaskItem({
      id: 'task-pool-fail',
      lane: 1,
      type: 'css',
    });
    const projectMap = createProjectMap();

    const result = await failPool.execute(task, projectMap);

    expect(result.success).toBe(false);

    // Verify fsm_transition to Failed was emitted
    const fsmEvents = (mockEventBus.emit as ReturnType<typeof vi.fn>).mock.calls
      .map((call: unknown[]) => call[0] as NovaEvent)
      .filter((e: NovaEvent) => e.type === 'fsm_transition');

    const failedTransition = fsmEvents.find(
      (e: Extract<NovaEvent, { type: 'fsm_transition' }>) => e.next === 'Failed',
    );
    expect(failedTransition).toBeDefined();
    expect(failedTransition!.task_id).toBe(task.id);
  });

  // ============================================================
  // task_failed event tests (VAL-ARCH-020)
  // ============================================================

  it('emits task_failed event when a task fails (VAL-ARCH-020)', async () => {
    const failingLane1 = {
      execute: vi.fn().mockResolvedValue({
        success: false,
        taskId: 'task-pool-fail',
        error: 'Something went wrong',
      } satisfies ExecutionResult),
    };

    const failPool = new ExecutorPool(failingLane1, mockLane2, mockEventBus);

    const task = createTaskItem({
      id: 'task-pool-fail',
      lane: 1,
      type: 'css',
    });
    const projectMap = createProjectMap();

    await failPool.execute(task, projectMap);

    // Verify task_failed event was emitted with the correct data
    const taskFailedCalls = (mockEventBus.emit as ReturnType<typeof vi.fn>).mock.calls
      .map((call: unknown[]) => call[0] as NovaEvent)
      .filter((e): e is Extract<NovaEvent, { type: 'task_failed' }> => e.type === 'task_failed');

    expect(taskFailedCalls.length).toBeGreaterThanOrEqual(1);
    const failEvent = taskFailedCalls[0];
    expect(failEvent.data.taskId).toBe('task-pool-fail');
    expect(failEvent.data.error).toBe('Something went wrong');
  });

  it('emits task_failed when executor throws an exception', async () => {
    const throwingLane = {
      execute: vi.fn().mockRejectedValue(new Error('Boom!')),
    };

    const failPool = new ExecutorPool(throwingLane, mockLane2, mockEventBus);

    const task = createTaskItem({
      id: 'task-pool-crash',
      lane: 1,
      type: 'css',
    });
    const projectMap = createProjectMap();

    const result = await failPool.execute(task, projectMap);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Boom!');

    // Verify task_failed event was emitted
    const taskFailedCalls = (mockEventBus.emit as ReturnType<typeof vi.fn>).mock.calls
      .map((call: unknown[]) => call[0] as NovaEvent)
      .filter((e): e is Extract<NovaEvent, { type: 'task_failed' }> => e.type === 'task_failed');

    expect(taskFailedCalls.length).toBeGreaterThanOrEqual(1);
    const failEvent = taskFailedCalls[0];
    expect(failEvent.data.taskId).toBe('task-pool-crash');
  });

  // ============================================================
  // RetryPolicy integration tests
  // ============================================================

  it('exposes the shared RetryPolicy', () => {
    const rp = pool.getRetryPolicy();
    expect(rp).toBeDefined();
    expect(rp).toBeInstanceOf(RetryPolicy);
  });

  it('exposes the ExecutorFSM', () => {
    const fsm = pool.getFsm();
    expect(fsm).toBeDefined();
  });

  it('accepts a custom RetryPolicy', () => {
    const customRp = new RetryPolicy(5);
    const customPool = new ExecutorPool(
      mockLane1,
      mockLane2,
      mockEventBus,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      customRp,
    );
    expect(customPool.getRetryPolicy()).toBe(customRp);
  });
});

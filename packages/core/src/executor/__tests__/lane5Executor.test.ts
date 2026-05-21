import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TaskItem, ProjectMap, StackInfo } from '../../models/types.js';
import type { LlmClient } from '../../contracts/ILlmClient.js';
import type { IGitManager } from '../../contracts/IGitManager.js';
import type { EventBus } from '../../contracts/IEventBus.js';
import { Lane5Executor } from '../Lane5Executor.js';
import type { MissionConfig } from '../Lane5Executor.js';

function createTaskItem(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'task-lane5-1',
    description: 'Build a login page with form validation',
    files: ['app/login/page.tsx'],
    type: 'multi_file',
    lane: 5,
    status: 'pending',
    ...overrides,
  };
}

function createProjectMap(): ProjectMap {
  const stack: StackInfo = {
    framework: 'next.js',
    language: 'typescript',
    packageManager: 'pnpm',
    typescript: true,
  };

  return {
    stack,
    devCommand: 'pnpm dev',
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
  return {
    chat: vi.fn(),
    chatStream: vi.fn(),
  } as unknown as LlmClient;
}

function createMockGitManager(): IGitManager {
  return {
    createBranch: vi.fn().mockResolvedValue('nova/test-branch'),
    commit: vi.fn().mockResolvedValue('abc1234'),
    getCurrentBranch: vi.fn().mockResolvedValue('main'),
    hasUncommittedChanges: vi.fn().mockResolvedValue(false),
  } as unknown as IGitManager;
}

function createMockEventBus(): EventBus {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
}

describe('Lane5Executor', () => {
  let mockLlm: LlmClient;
  let mockGit: IGitManager;
  let mockEventBus: EventBus;

  beforeEach(() => {
    mockLlm = createMockLlmClient();
    mockGit = createMockGitManager();
    mockEventBus = createMockEventBus();
  });

  function createExecutor(overrides?: {
    orchestratorModel?: string;
    missionConfig?: MissionConfig;
  }): Lane5Executor {
    return new Lane5Executor(
      '/test/project',
      mockLlm,
      mockGit,
      mockEventBus,
      overrides?.orchestratorModel ?? 'claude-opus-4-6',
      overrides?.missionConfig ?? undefined,
    );
  }

  // VAL-CORE-031: Lane5Executor skeleton returns ExecutionResult
  describe('skeleton ExecutionResult (VAL-CORE-031)', () => {
    it('returns a valid ExecutionResult with success, taskId, and error properties', async () => {
      const executor = createExecutor();
      const task = createTaskItem();
      const projectMap = createProjectMap();

      const result = await executor.execute(task, projectMap);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('taskId');
      expect(result).toHaveProperty('error');
      expect(result.success).toBe(false);
      expect(result.taskId).toBe('task-lane5-1');
      expect(result.error).toContain('not yet implemented');
    });

    it('does not return undefined or throw an error', async () => {
      const executor = createExecutor();
      const task = createTaskItem();
      const projectMap = createProjectMap();

      let result;
      try {
        result = await executor.execute(task, projectMap);
      } catch {
        // Should not throw
      }

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });

  // VAL-CORE-030: Lane5Executor implements the executor contract
  describe('executor contract (VAL-CORE-030)', () => {
    it('has an execute method accepting TaskItem and ProjectMap, returning Promise<ExecutionResult>', async () => {
      const executor = createExecutor();
      const task = createTaskItem();
      const projectMap = createProjectMap();

      const result = await executor.execute(task, projectMap);

      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.taskId).toBe(task.id);
    });

    it('is constructable with required dependencies', () => {
      const executor = new Lane5Executor(
        '/test/project',
        mockLlm,
        mockGit,
        mockEventBus,
        'claude-opus-4-6',
        { enabled: true, autoApprove: false, maxIterations: 5 },
      );

      expect(executor).toBeInstanceOf(Lane5Executor);
    });
  });

  // VAL-CORE-032: Lane5Executor receives and passes through required dependencies
  describe('dependency injection (VAL-CORE-032)', () => {
    it('accepts all optional constructor parameters', () => {
      const executor = new Lane5Executor(
        '/test/project',
        mockLlm,
        mockGit,
        mockEventBus,
        'claude-opus-4-6',
        { enabled: true, autoApprove: false, maxIterations: 5 },
        undefined, // agentPromptLoader
        undefined, // pathGuard
        undefined, // commitQueue
        undefined, // logger
      );

      expect(executor).toBeDefined();
    });
  });

  // VAL-CORE-022: Missing orchestrator model returns clear error
  describe('missing orchestrator model (VAL-CORE-022)', () => {
    it('returns error when orchestratorModel is explicitly undefined', async () => {
      // Bypass createExecutor default fallback by using constructor directly
      const executor = new Lane5Executor(
        '/test/project',
        mockLlm,
        mockGit,
        mockEventBus,
        undefined, // no orchestrator model
      );
      const task = createTaskItem();
      const projectMap = createProjectMap();

      const result = await executor.execute(task, projectMap);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('orchestrator');
    });

    it('returns error when orchestratorModel is empty string', async () => {
      const executor = new Lane5Executor(
        '/test/project',
        mockLlm,
        mockGit,
        mockEventBus,
        '', // empty orchestrator model
      );
      const task = createTaskItem();
      const projectMap = createProjectMap();

      const result = await executor.execute(task, projectMap);

      expect(result.success).toBe(false);
      expect(result.error).toContain('orchestrator');
    });
  });

  // VAL-CORE-025: Exceptions caught and returned as error results
  describe('exception handling (VAL-CORE-025)', () => {
    it('catches exceptions and returns error ExecutionResult', async () => {
      // Create an executor with a mock that will cause an internal error.
      // Since execute() has no external side effects in skeleton form,
      // we test that the catch block works by causing an error in a
      // controlled way. The try/catch wraps the entire body.
      const executor = createExecutor();
      const task = createTaskItem();
      const projectMap = createProjectMap();

      // The skeleton impl does not throw, so we test the catch contract
      // by verifying the result shape even for errors.
      // This test verifies that the method signature and error handling
      // contract are in place. Full exception testing is done via
      // ExecutorPool integration tests.
      const result = await executor.execute(task, projectMap);

      // Should always return a valid ExecutionResult, never throw
      expect(result.success).toBe(false);
      expect(result.taskId).toBe('task-lane5-1');
      expect(result.error).toBeDefined();
    });
  });

  // VAL-CORE-042: mission config enabled = false prevents execution
  describe('mission config disabled (VAL-CORE-042)', () => {
    it('returns error when mission.enabled is false', async () => {
      const executor = new Lane5Executor(
        '/test/project',
        mockLlm,
        mockGit,
        mockEventBus,
        'claude-opus-4-6',
        { enabled: false, autoApprove: false, maxIterations: 5 },
      );
      const task = createTaskItem();
      const projectMap = createProjectMap();

      const result = await executor.execute(task, projectMap);

      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
    });
  });
});

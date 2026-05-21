import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TaskItem, ProjectMap, StackInfo, ChatResponse, StreamChunk } from '../../models/types.js';
import type { NovaEvent } from '../../models/events.js';
import type { LlmClient } from '../../contracts/ILlmClient.js';
import type { IGitManager } from '../../contracts/IGitManager.js';
import type { EventBus } from '../../contracts/IEventBus.js';
import { Lane5Executor } from '../Lane5Executor.js';
import type { MissionConfig } from '../Lane5Executor.js';

// ── Helpers ───────────────────────────────────────────────────────────

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

function createProjectMap(overrides: Partial<{
  fileContexts?: Record<string, string>;
}> = {}): ProjectMap {
  const stack: StackInfo = {
    framework: 'next.js',
    language: 'typescript',
    packageManager: 'pnpm',
    typescript: true,
  };

  const fileContexts = new Map<string, {
    filePath: string;
    content: string;
    importedTypes: string;
  }>();

  fileContexts.set('package.json', {
    filePath: 'package.json',
    content: JSON.stringify({
      dependencies: { react: '^19.0.0', next: '^15.0.0' },
      devDependencies: { typescript: '^5.0.0' },
    }),
    importedTypes: '',
  });

  if (overrides.fileContexts) {
    for (const [path, content] of Object.entries(overrides.fileContexts)) {
      fileContexts.set(path, { filePath: path, content, importedTypes: '' });
    }
  }

  return {
    stack,
    devCommand: 'pnpm dev',
    port: 3000,
    routes: [],
    components: [],
    endpoints: [],
    models: [],
    dependencies: new Map(),
    fileContexts,
    compressedContext: '',
  };
}

function createBareMockLlm(): LlmClient {
  return {
    supportsVision: true,
    chat: vi.fn(),
    chatWithVision: vi.fn(),
    stream: vi.fn(),
  } as unknown as LlmClient;
}

function createMockGitManager(): IGitManager {
  return {
    createBranch: vi.fn().mockResolvedValue('nova/test-branch'),
    commit: vi.fn().mockResolvedValue('abc1234'),
    getCurrentBranch: vi.fn().mockResolvedValue('nova/test-branch'),
    hasUncommittedChanges: vi.fn().mockResolvedValue(false),
  } as unknown as IGitManager;
}

function createMockEventBus(): EventBus & { _trigger: (type: string, data: unknown) => void } {
  const handlers = new Map<string, Array<(event: NovaEvent) => void>>();
  return {
    emit: vi.fn(),
    on: vi.fn().mockImplementation((type: string, handler: (e: NovaEvent) => void) => {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type)!.push(handler);
    }),
    off: vi.fn().mockImplementation((type: string, handler: (e: NovaEvent) => void) => {
      const list = handlers.get(type);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      }
    }),
    _trigger: (type: string, data: unknown) => {
      const list = handlers.get(type);
      if (list) {
        for (const handler of list) {
          handler({ type, data } as unknown as NovaEvent);
        }
      }
    },
  } as unknown as EventBus & { _trigger: (type: string, data: unknown) => void };
}

// ── Mock LLM factories ─────────────────────────────────────────────────

function makeStream(content: string): () => AsyncIterable<StreamChunk> {
  return () => {
    async function* gen(): AsyncIterable<StreamChunk> {
      yield { content };
    }
    return gen();
  };
}

function createPlanMockLlm(features?: Array<{
  id: string; description: string; files: string[]; dependencies?: string[];
}>): LlmClient {
  const f = (features ?? [
    { id: 'feat-1', description: 'Login component', files: ['app/login/page.tsx'], dependencies: [] },
    { id: 'feat-2', description: 'API route', files: ['app/api/auth/route.ts'], dependencies: [] },
  ]).map((f) => ({ ...f, type: 'multi_file' as const }));
  return {
    supportsVision: true,
    chat: vi.fn().mockResolvedValue({ content: JSON.stringify({ features: f }) }),
    chatWithVision: vi.fn(),
    stream: vi.fn().mockImplementation(makeStream('=== FILE: a.ts ===\n// code\n=== END FILE ===')),
  } as unknown as LlmClient;
}

function createFullMockLlm(): LlmClient {
  let chatCall = 0;
  return {
    supportsVision: true,
    chat: vi.fn().mockImplementation(async () => {
      chatCall++;
      if (chatCall === 1) {
        return { content: JSON.stringify({ features: [
          { id: 'feat-1', description: 'Login component', files: ['app/login/page.tsx'], type: 'multi_file', dependencies: [] },
          { id: 'feat-2', description: 'API route', files: ['app/api/auth/route.ts'], type: 'multi_file', dependencies: [] },
        ]}) } as ChatResponse;
      }
      return { content: JSON.stringify({ decision: 'APPROVED', feedback: [] }) } as ChatResponse;
    }),
    chatWithVision: vi.fn(),
    stream: vi.fn().mockImplementation(makeStream('=== FILE: app/login/page.tsx ===\nexport default function LoginPage() { return <div>Login</div>; }\n=== END FILE ===')),
  } as unknown as LlmClient;
}

function createAlwaysNeedsRevisionLlm(featureCount = 1): LlmClient {
  let chatCall = 0;
  const features = Array.from({ length: featureCount }, (_, i) => ({
    id: `f${i + 1}`, description: `Feature ${i + 1}`, files: [`f${i + 1}.ts`], type: 'multi_file' as const, dependencies: [] as string[],
  }));
  return {
    supportsVision: true,
    chat: vi.fn().mockImplementation(async () => {
      chatCall++;
      if (chatCall === 1) {
        return { content: JSON.stringify({ features }) } as ChatResponse;
      }
      return { content: JSON.stringify({
        decision: 'NEEDS_REVISION',
        feedback: features.map((f) => ({ featureId: f.id, actionItems: ['Fix it'] })),
      }) } as ChatResponse;
    }),
    chatWithVision: vi.fn(),
    stream: vi.fn().mockImplementation(makeStream('=== FILE: f1.ts ===\n// code\n=== END FILE ===')),
  } as unknown as LlmClient;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('Lane5Executor', () => {
  let mockGit: IGitManager;
  let mockEventBus: EventBus & { _trigger: (type: string, data: unknown) => void };
  let projectDir: string;

  beforeEach(() => {
    mockGit = createMockGitManager();
    mockEventBus = createMockEventBus();
    projectDir = mkdtempSync(join(tmpdir(), 'nova-lane5-test-'));
  });

  afterEach(() => {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  function makeExecutor(opts?: {
    orchestratorModel?: string;
    missionConfig?: MissionConfig;
    llm?: LlmClient;
    workerModel?: string;
  }): Lane5Executor {
    return new Lane5Executor(
      projectDir,
      opts?.llm ?? createBareMockLlm(),
      mockGit,
      mockEventBus,
      opts?.orchestratorModel ?? 'claude-opus-4-6',
      opts?.missionConfig ?? undefined,
      undefined, undefined, undefined, undefined, // agentPromptLoader, pathGuard, commitQueue, logger
      opts?.workerModel,
    );
  }

  /** Get all emitted event types in order. */
  function eventTypes(): string[] {
    const calls = (mockEventBus.emit as ReturnType<typeof vi.fn>).mock.calls as Array<[NovaEvent]>;
    return calls.map((c) => c[0].type);
  }

  // ── VAL-CORE-030: Constructor contract ──────────────────────────────

  describe('executor contract (VAL-CORE-030)', () => {
    it('constructs with required dependencies', () => {
      const executor = makeExecutor({ missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 } });
      expect(executor).toBeInstanceOf(Lane5Executor);
    });

    it('execute returns Promise<ExecutionResult>', async () => {
      const executor = makeExecutor({ llm: createFullMockLlm(), missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 } });
      const result = await executor.execute(createTaskItem(), createProjectMap());
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('taskId');
      expect(result.taskId).toBe('task-lane5-1');
    });

    it('accepts workerModel parameter', () => {
      const executor = new Lane5Executor(
        projectDir, createBareMockLlm(), mockGit, mockEventBus,
        'claude-opus-4-6',
        { enabled: true, autoApprove: false, maxIterations: 5 },
        undefined, undefined, undefined, undefined,
        'claude-sonnet-4-6',
      );
      expect(executor).toBeDefined();
    });
  });

  // ── VAL-CORE-031: Returns ExecutionResult ───────────────────────────

  describe('ExecutionResult (VAL-CORE-031)', () => {
    it('returns success on full approval', async () => {
      const executor = makeExecutor({ llm: createFullMockLlm(), missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 } });
      const result = await executor.execute(createTaskItem(), createProjectMap());
      expect(result.success).toBe(true);
    });

    it('never throws, catches exceptions', async () => {
      const crashLlm: LlmClient = { ...createBareMockLlm(), chat: vi.fn().mockRejectedValue(new Error('Network fail')) };
      const executor = makeExecutor({ llm: crashLlm, missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 } });
      const result = await executor.execute(createTaskItem(), createProjectMap());
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });
  });

  // ── VAL-CORE-022: Missing orchestrator model ────────────────────────

  describe('missing orchestrator model (VAL-CORE-022)', () => {
    it('returns error without orchestrator model', async () => {
      // Construct directly without makeExecutor so orchestratorModel is truly undefined
      const executor = new Lane5Executor(
        projectDir, createBareMockLlm(), mockGit, mockEventBus,
        undefined, // orchestratorModel
      );
      const result = await executor.execute(createTaskItem(), createProjectMap());
      expect(result.success).toBe(false);
      expect(result.error).toContain('orchestrator');
    });

    it('returns error with empty orchestrator model', async () => {
      const executor = new Lane5Executor(
        projectDir, createBareMockLlm(), mockGit, mockEventBus,
        '', // empty orchestrator model
      );
      const result = await executor.execute(createTaskItem(), createProjectMap());
      expect(result.success).toBe(false);
      expect(result.error).toContain('orchestrator');
    });
  });

  // ── VAL-CORE-042: Mission config disabled ───────────────────────────

  describe('mission config disabled (VAL-CORE-042)', () => {
    it('returns error when disabled', async () => {
      const executor = makeExecutor({ orchestratorModel: 'claude-opus-4-6', missionConfig: { enabled: false, autoApprove: false, maxIterations: 5 } });
      const result = await executor.execute(createTaskItem(), createProjectMap());
      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
    });
  });

  // ── VAL-ORCH-050: Full lifecycle ────────────────────────────────────

  describe('full lifecycle (VAL-ORCH-050)', () => {
    it('completes: plan → execute → review → commit', async () => {
      const executor = makeExecutor({ llm: createFullMockLlm(), missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 } });
      const result = await executor.execute(createTaskItem(), createProjectMap());
      expect(result.success).toBe(true);
      expect(result.taskId).toBe('task-lane5-1');
    });

    it('handles empty plan gracefully', async () => {
      const emptyPlanLlm: LlmClient = {
        ...createBareMockLlm(),
        chat: vi.fn().mockResolvedValue({ content: JSON.stringify({ features: [] }) } as ChatResponse),
      };
      const executor = makeExecutor({ llm: emptyPlanLlm, missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 } });
      const result = await executor.execute(createTaskItem(), createProjectMap());
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty plan');
    });
  });

  // ── VAL-ORCH-051: Event timeline ────────────────────────────────────

  describe('event emission timeline (VAL-ORCH-051)', () => {
    it('emits events in order: planned → started → completed → review → completed', async () => {
      const executor = makeExecutor({ llm: createFullMockLlm(), missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 } });
      await executor.execute(createTaskItem(), createProjectMap());

      const types = eventTypes();
      const planned = types.indexOf('mission_planned');
      const started = types.indexOf('mission_subtask_started');
      const completed = types.lastIndexOf('mission_subtask_completed');
      const review = types.indexOf('mission_director_review');
      const missionDone = types.indexOf('mission_completed');

      expect(planned).toBeGreaterThan(-1);
      expect(started).toBeGreaterThan(-1);
      expect(completed).toBeGreaterThan(-1);
      expect(review).toBeGreaterThan(-1);
      expect(missionDone).toBeGreaterThan(-1);
      expect(planned).toBeLessThan(started);
      expect(started).toBeLessThan(completed);
      expect(completed).toBeLessThan(review);
      expect(review).toBeLessThan(missionDone);
    });

    it('emits subtask_started for each feature', async () => {
      const executor = makeExecutor({ llm: createPlanMockLlm(), missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 } });
      await executor.execute(createTaskItem(), createProjectMap());

      const starts = eventTypes().filter((t) => t === 'mission_subtask_started').length;
      const ends = eventTypes().filter((t) => t === 'mission_subtask_completed').length;
      expect(starts).toBe(2);
      expect(ends).toBe(2);
    });

    it('mission_completed only after director review', async () => {
      const executor = makeExecutor({ llm: createFullMockLlm(), missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 } });
      await executor.execute(createTaskItem(), createProjectMap());

      const types = eventTypes();
      expect(types.indexOf('mission_director_review')).toBeLessThan(types.indexOf('mission_completed'));
    });
  });

  // ── VAL-ORCH-052: Confirmation gate ─────────────────────────────────

  describe('confirmation gate (VAL-ORCH-052)', () => {
    it('pauses after planning when !autoApprove', async () => {
      const executor = makeExecutor({ llm: createPlanMockLlm(), missionConfig: { enabled: true, autoApprove: false, maxIterations: 5 } });
      void executor.execute(createTaskItem(), createProjectMap());
      await new Promise((r) => setTimeout(r, 10));

      const types = eventTypes();
      expect(types).toContain('pending_tasks');
      expect(types).not.toContain('mission_completed');
    });

    it('proceeds immediately when autoApprove=true', async () => {
      const executor = makeExecutor({ llm: createFullMockLlm(), missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 } });
      await executor.execute(createTaskItem(), createProjectMap());
      expect(eventTypes()).not.toContain('pending_tasks');
    });

    it('aborts on cancel', async () => {
      const executor = makeExecutor({ llm: createPlanMockLlm(), missionConfig: { enabled: true, autoApprove: false, maxIterations: 5 } });
      const p = executor.execute(createTaskItem(), createProjectMap());
      await new Promise((r) => setTimeout(r, 50));
      mockEventBus._trigger('cancel', {});
      const result = await p;
      expect(result.success).toBe(false);
      expect(result.error).toContain('cancelled');
    });

    it('proceeds on confirm_tasks', async () => {
      const executor = makeExecutor({ llm: createFullMockLlm(), missionConfig: { enabled: true, autoApprove: false, maxIterations: 5 } });
      const p = executor.execute(createTaskItem(), createProjectMap());
      await new Promise((r) => setTimeout(r, 50));
      mockEventBus._trigger('confirm_tasks', { taskIds: ['task-lane5-1'] });
      const result = await p;
      expect(result.success).toBe(true);
    });
  });

  // ── VAL-ORCH-053: Orchestrator model override ───────────────────────

  describe('orchestrator model override (VAL-ORCH-053)', () => {
    it('uses orchestrator model for LLM calls', async () => {
      const llm = createFullMockLlm();
      const executor = makeExecutor({ llm, orchestratorModel: 'gpt-5-custom', missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 } });
      await executor.execute(createTaskItem(), createProjectMap());

      for (const call of (llm.chat as ReturnType<typeof vi.fn>).mock.calls) {
        const opts = call[1] as { model?: string };
        expect(opts.model).toBe('gpt-5-custom');
      }
    });
  });

  // ── VAL-ORCH-022: Director loop respects maxIterations ──────────────

  describe('director loop maxIterations (VAL-ORCH-022)', () => {
    it('retries up to maxIterations then finalizes', async () => {
      const executor = makeExecutor({ llm: createAlwaysNeedsRevisionLlm(1), missionConfig: { enabled: true, autoApprove: true, maxIterations: 3 } });
      const result = await executor.execute(createTaskItem(), createProjectMap());

      expect(result).toBeDefined();
      const types = eventTypes();
      const iterations = types.filter((t) => t === 'mission_iteration');
      expect(iterations.length).toBeLessThanOrEqual(3);
    });

    it('respects maxIterations=1 (single-shot)', async () => {
      const executor = makeExecutor({ llm: createAlwaysNeedsRevisionLlm(1), missionConfig: { enabled: true, autoApprove: true, maxIterations: 1 } });
      await executor.execute(createTaskItem(), createProjectMap());

      const types = eventTypes();
      const reviews = types.filter((t) => t === 'mission_director_review');
      // Only one review cycle
      expect(reviews.length).toBeLessThanOrEqual(1);
    });
  });
});

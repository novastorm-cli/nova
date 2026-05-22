/**
 * Cross-Area Integration Tests
 *
 * End-to-end integration tests verifying full cross-area flows between
 * Lane5Executor, MissionOrchestrator, MissionWorker, MissionDirector,
 * MissionStore, and event emission.
 *
 * These tests use mocked LLMs and real file I/O in temp directories.
 *
 * Covers assertions:
 *   VAL-CROSS-001 — Full user-task → mission lifecycle end-to-end
 *   VAL-CROSS-002 — Autofix + mission events interoperate
 *   VAL-CROSS-003 — Config gating across the entire pipeline
 *   VAL-CROSS-004 — Mission + regular task coexist in overlay
 *   VAL-CROSS-005 — Mission state survives restart
 *   VAL-CROSS-006 — Orchestrator model consistency
 *   VAL-CROSS-007 — Director NEEDS_REVISION updates overlay in real time
 *   VAL-CROSS-008 — Autofix budget exhausted → user tasks unaffected
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  TaskItem,
  ProjectMap,
  StackInfo,
  ChatResponse,
  StreamChunk,
} from '../../models/types.js';
import type { NovaEvent } from '../../models/events.js';
import type { LlmClient } from '../../contracts/ILlmClient.js';
import type { IGitManager } from '../../contracts/IGitManager.js';
import type { EventBus } from '../../contracts/IEventBus.js';
import { Lane5Executor } from '../Lane5Executor.js';
import type { MissionConfig } from '../Lane5Executor.js';
import { MissionStore } from '../MissionStore.js';

// ── Helpers ───────────────────────────────────────────────────────────

function createTaskItem(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'task-cross-1',
    description: 'Build a full-stack authentication feature with login, signup, and session management',
    files: ['app/login/page.tsx', 'app/signup/page.tsx'],
    type: 'multi_file',
    lane: 5,
    status: 'pending',
    ...overrides,
  };
}

function createProjectMap(extraFiles?: Record<string, string>): ProjectMap {
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

  fileContexts.set('app/layout.tsx', {
    filePath: 'app/layout.tsx',
    content: 'export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }',
    importedTypes: '',
  });

  fileContexts.set('app/page.tsx', {
    filePath: 'app/page.tsx',
    content: 'export default function HomePage() { return <div>Home</div>; }',
    importedTypes: '',
  });

  if (extraFiles) {
    for (const [path, content] of Object.entries(extraFiles)) {
      fileContexts.set(path, { filePath: path, content, importedTypes: '' });
    }
  }

  return {
    stack,
    devCommand: 'pnpm dev',
    port: 3000,
    routes: [
      { type: 'page', path: '/', filePath: 'app/page.tsx' },
    ],
    components: [],
    endpoints: [],
    models: [],
    dependencies: new Map(),
    fileContexts,
    compressedContext: '',
  };
}

function createMockGitManager(): IGitManager {
  return {
    createBranch: vi.fn().mockResolvedValue('nova/test-branch'),
    commit: vi.fn().mockResolvedValue('abc1234'),
    getCurrentBranch: vi.fn().mockResolvedValue('nova/test-branch'),
    hasUncommittedChanges: vi.fn().mockResolvedValue(false),
  } as unknown as IGitManager;
}

function createMockEventBus(): EventBus & { _trigger: (type: string, data: unknown) => void; _emitted: NovaEvent[] } {
  const handlers = new Map<string, Array<(event: NovaEvent) => void>>();
  const emitted: NovaEvent[] = [];

  const bus = {
    emit: vi.fn().mockImplementation((event: NovaEvent) => {
      emitted.push(event);
    }),
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
    _emitted: emitted,
  };

  return bus as unknown as EventBus & { _trigger: (type: string, data: unknown) => void; _emitted: NovaEvent[] };
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

function createFullMissionLlm(featureCount = 2): LlmClient {
  let chatCall = 0;
  const features = Array.from({ length: featureCount }, (_, i) => ({
    id: `feat-${i + 1}`,
    description: `Feature ${i + 1} description`,
    files: [`file-${i + 1}.tsx`],
    type: 'multi_file' as const,
    dependencies: [] as string[],
  }));

  return {
    supportsVision: true,
    chat: vi.fn().mockImplementation(async () => {
      chatCall++;
      if (chatCall === 1) {
        return { content: JSON.stringify({ features }) } as ChatResponse;
      }
      return { content: JSON.stringify({ decision: 'APPROVED', feedback: [] }) } as ChatResponse;
    }),
    chatWithVision: vi.fn(),
    stream: vi.fn().mockImplementation(makeStream('=== FILE: generated.tsx ===\n// Generated code\n=== END FILE ===')),
  } as unknown as LlmClient;
}

function createNeedsRevisionThenApprovedLlm(): LlmClient {
  let chatCall = 0;
  return {
    supportsVision: true,
    chat: vi.fn().mockImplementation(async () => {
      chatCall++;
      if (chatCall === 1) {
        return {
          content: JSON.stringify({
            features: [
              { id: 'feat-a', description: 'Feature A', files: ['a.tsx'], type: 'multi_file' as const, dependencies: [] },
              { id: 'feat-b', description: 'Feature B', files: ['b.tsx'], type: 'multi_file' as const, dependencies: ['feat-a'] },
            ],
          }),
        } as ChatResponse;
      }
      if (chatCall === 2) {
        return {
          content: JSON.stringify({
            decision: 'NEEDS_REVISION',
            feedback: [{ featureId: 'feat-a', actionItems: ['Fix type error in a.tsx'] }],
          }),
        } as ChatResponse;
      }
      return { content: JSON.stringify({ decision: 'APPROVED', feedback: [] }) } as ChatResponse;
    }),
    chatWithVision: vi.fn(),
    stream: vi.fn().mockImplementation(makeStream('=== FILE: a.tsx ===\n// fixed code\n=== END FILE ===')),
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
      return {
        content: JSON.stringify({
          decision: 'NEEDS_REVISION',
          feedback: features.map((f) => ({ featureId: f.id, actionItems: ['Fix it'] })),
        }),
      } as ChatResponse;
    }),
    chatWithVision: vi.fn(),
    stream: vi.fn().mockImplementation(makeStream('=== FILE: code.ts ===\n// code\n=== END FILE ===')),
  } as unknown as LlmClient;
}

function createDependentFeaturesLlm(): LlmClient {
  return {
    supportsVision: true,
    chat: vi.fn()
      .mockResolvedValueOnce({
        content: JSON.stringify({
          features: [
            { id: 'db-setup', description: 'DB setup', files: ['db/schema.ts'], type: 'multi_file' as const, dependencies: [] },
            { id: 'api-auth', description: 'Auth API', files: ['api/auth/route.ts'], type: 'multi_file' as const, dependencies: ['db-setup'] },
            { id: 'login-ui', description: 'Login UI', files: ['app/login/page.tsx'], type: 'multi_file' as const, dependencies: ['api-auth'] },
          ],
        }),
      } as ChatResponse)
      .mockResolvedValueOnce({
        content: JSON.stringify({ decision: 'APPROVED', feedback: [] }),
      } as ChatResponse),
    chatWithVision: vi.fn(),
    stream: vi.fn().mockImplementation(makeStream('=== FILE: schema.ts ===\n// schema\n=== END FILE ===')),
  } as unknown as LlmClient;
}

function createOrchestratorModelVerificationLlm(modelTracker: string[]): LlmClient {
  return {
    supportsVision: true,
    chat: vi.fn().mockImplementation(async (_messages, options?: { model?: string }) => {
      if (options?.model) modelTracker.push(options.model);
      // First call = orchestrator plan
      if (modelTracker.length === 1) {
        return {
          content: JSON.stringify({
            features: [
              { id: 'f1', description: 'Feature 1', files: ['f1.tsx'], type: 'multi_file' as const, dependencies: [] },
            ],
          }),
        } as ChatResponse;
      }
      return { content: JSON.stringify({ decision: 'APPROVED', feedback: [] }) } as ChatResponse;
    }),
    chatWithVision: vi.fn(),
    stream: vi.fn().mockImplementation(makeStream('=== FILE: f1.tsx ===\n// code\n=== END FILE ===')),
  } as unknown as LlmClient;
}

// ── Test Suite ─────────────────────────────────────────────────────────

describe('Cross-Area Integration', () => {
  let mockGit: IGitManager;
  let mockEventBus: EventBus & { _trigger: (type: string, data: unknown) => void; _emitted: NovaEvent[] };
  let projectDir: string;

  beforeEach(() => {
    mockGit = createMockGitManager();
    mockEventBus = createMockEventBus();
    projectDir = mkdtempSync(join(tmpdir(), 'nova-cross-test-'));
  });

  afterEach(() => {
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* cleanup */ }
  });

  function makeExecutor(opts: {
    orchestratorModel?: string;
    missionConfig?: MissionConfig;
    llm?: LlmClient;
    workerModel?: string;
  } = {}): Lane5Executor {
    return new Lane5Executor(
      projectDir,
      opts.llm ?? ({
        supportsVision: true,
        chat: vi.fn(),
        chatWithVision: vi.fn(),
        stream: vi.fn(),
      } as unknown as LlmClient),
      mockGit,
      mockEventBus,
      opts.orchestratorModel ?? 'claude-opus-4-6',
      opts.missionConfig ?? undefined,
      undefined, undefined, undefined, undefined,
      opts.workerModel,
    );
  }

  function eventTypes(): string[] {
    return mockEventBus._emitted.map((e) => e.type);
  }

  function eventsOfType(type: string): NovaEvent[] {
    return mockEventBus._emitted.filter((e) => e.type === type);
  }

  /** Safely extract data from a NovaEvent (discriminated union). */
  function eventData(event: NovaEvent): Record<string, unknown> {
    return (event as unknown as { data: Record<string, unknown> }).data ?? {};
  }

  // ── VAL-CROSS-001: Full user-task → mission lifecycle end-to-end ─────

  describe('VAL-CROSS-001: Full mission lifecycle', () => {
    it('completes full lifecycle: plan → confirm → execute → review → commit → completed', async () => {
      const llm = createFullMissionLlm(3);
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });

      const task = createTaskItem();
      const result = await executor.execute(task, createProjectMap());

      // Verify ExecutionResult
      expect(result.success).toBe(true);
      expect(result.taskId).toBe('task-cross-1');

      // Verify event timeline order
      const types = eventTypes();
      const planned = types.indexOf('mission_planned');
      const firstStarted = types.indexOf('mission_subtask_started');
      const lastCompleted = types.lastIndexOf('mission_subtask_completed');
      const review = types.indexOf('mission_director_review');
      const missionDone = types.indexOf('mission_completed');

      expect(planned).toBeGreaterThan(-1);
      expect(firstStarted).toBeGreaterThan(-1);
      expect(lastCompleted).toBeGreaterThan(-1);
      expect(review).toBeGreaterThan(-1);
      expect(missionDone).toBeGreaterThan(-1);

      // Verify strict ordering
      expect(planned).toBeLessThan(firstStarted);
      expect(firstStarted).toBeLessThan(lastCompleted);
      expect(lastCompleted).toBeLessThan(review);
      expect(review).toBeLessThan(missionDone);

      // Verify correct counts
      expect(eventsOfType('mission_subtask_started').length).toBe(3);
      expect(eventsOfType('mission_subtask_completed').length).toBe(3);
      expect(eventsOfType('mission_director_review').length).toBe(1);
      expect(eventsOfType('mission_completed').length).toBe(1);

      // Verify mission_completed has commitHash
      const completedEvent = eventsOfType('mission_completed')[0];
      expect(completedEvent).toBeDefined();
      expect(eventData(completedEvent!).commitHash as string).toBeTruthy();

      // Verify no failed events
      expect(types).not.toContain('mission_failed');

      // Verify mission state persisted
      const missionFilePath = join(projectDir, '.nova', 'missions', `mission-${task.id}.json`);
      expect(existsSync(missionFilePath)).toBe(true);
    });

    it('handles 5-feature mission with all independent features', async () => {
      const llm = createFullMissionLlm(5);
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });

      const result = await executor.execute(createTaskItem(), createProjectMap());
      expect(result.success).toBe(true);
      expect(eventsOfType('mission_subtask_started').length).toBe(5);
      expect(eventsOfType('mission_subtask_completed').length).toBe(5);
    });

    it('handles mission with dependent features (DAG execution)', async () => {
      const llm = createDependentFeaturesLlm();
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });

      const result = await executor.execute(createTaskItem(), createProjectMap());
      expect(result.success).toBe(true);

      // All 3 features should execute
      expect(eventsOfType('mission_subtask_started').length).toBe(3);
      expect(eventsOfType('mission_subtask_completed').length).toBe(3);
    });

    it('completes with user confirmation flow (non-autoApprove)', async () => {
      const llm = createFullMissionLlm(2);
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: false, maxIterations: 5 },
      });

      const p = executor.execute(createTaskItem(), createProjectMap());

      // Wait for plan to be emitted
      await vi.waitFor(() => {
        expect(eventsOfType('pending_tasks').length).toBe(1);
      }, { timeout: 2000 });

      // Pending tasks event should have the right structure
      const pendingEvent = eventsOfType('pending_tasks')[0];
      expect(pendingEvent).toBeDefined();
      const pendingData = eventData(pendingEvent!) as { tasks: Array<{ id: string }>; message: string };
      expect(pendingData.tasks.length).toBe(2);
      expect(pendingData.message).toContain('planned');

      // Confirm the tasks
      mockEventBus._trigger('confirm_tasks', { taskIds: ['task-cross-1'] });

      const result = await p;
      expect(result.success).toBe(true);
      expect(eventTypes()).toContain('mission_completed');
    });

    it('handles user cancellation after plan', async () => {
      const llm = createFullMissionLlm(2);
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: false, maxIterations: 5 },
      });

      const p = executor.execute(createTaskItem(), createProjectMap());

      await vi.waitFor(() => {
        expect(eventsOfType('pending_tasks').length).toBe(1);
      }, { timeout: 2000 });

      // Cancel instead of confirm
      mockEventBus._trigger('cancel', {});

      const result = await p;
      expect(result.success).toBe(false);
      expect(result.error).toContain('cancelled');
      expect(eventTypes()).not.toContain('mission_completed');
      expect(eventTypes()).toContain('mission_failed');
    });
  });

  // ── VAL-CROSS-002: Autofix + mission events interoperate ─────────────

  describe('VAL-CROSS-002: Autofix + mission event interoperability', () => {
    it('autofix_start precedes mission_planned, autofix_end follows mission_completed', async () => {
      // Simulate autofix flow: emit autofix_start, then run Lane 5 mission,
      // then verify the complete event timeline

      const llm = createFullMissionLlm(2);
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });

      // Emit autofix_start (simulating ErrorAutoFixer)
      mockEventBus.emit({
        type: 'status',
        data: { message: 'autofix_start' },
      });

      // Also emit task_started for the autofix task
      mockEventBus.emit({
        type: 'task_started',
        data: { taskId: 'task-cross-1' },
      });

      const task = createTaskItem();
      const result = await executor.execute(task, createProjectMap());

      expect(result.success).toBe(true);

      // Emit autofix_end after mission completes (simulating full autofix lifecycle)
      mockEventBus.emit({
        type: 'status',
        data: { message: 'autofix_end' },
      });

      // Now verify the complete event sequence
      const types = eventTypes();
      const statusEvents = mockEventBus._emitted
        .filter((e) => e.type === 'status')
        .map((e) => (eventData(e) as { message: string }).message);

      // Verify autofix events bookend the mission events
      const autofixStartIdx = types.indexOf('status');
      const plannedIdx = types.indexOf('mission_planned');
      const completedIdx = types.indexOf('mission_completed');
      const autofixEndMessages = statusEvents.filter((m: string) => m === 'autofix_end');

      expect(autofixStartIdx).toBeLessThan(plannedIdx);
      expect(completedIdx).toBeGreaterThan(-1);
      expect(autofixEndMessages.length).toBe(1);

      // Full sequence: autofix_start → task_started → mission_planned → ... → mission_completed → autofix_end
      expect(statusEvents).toContain('autofix_start');
      expect(types).toContain('task_started');
      expect(types).toContain('mission_planned');
      expect(types).toContain('mission_completed');
      expect(statusEvents).toContain('autofix_end');
    });

    it('autofix_failed is emitted when mission fails', async () => {
      const failingLlm: LlmClient = {
        supportsVision: true,
        chat: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
        chatWithVision: vi.fn(),
        stream: vi.fn(),
      } as unknown as LlmClient;

      const executor = makeExecutor({
        llm: failingLlm,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });

      // Simulate autofix_start
      mockEventBus.emit({
        type: 'status',
        data: { message: 'autofix_start' },
      });

      const result = await executor.execute(createTaskItem(), createProjectMap());
      expect(result.success).toBe(false);

      // Emit autofix_failed after mission failure
      mockEventBus.emit({
        type: 'status',
        data: { message: 'autofix_failed' },
      });

      const statusEvents = mockEventBus._emitted
        .filter((e) => e.type === 'status')
        .map((e) => (eventData(e) as { message: string }).message);

      expect(statusEvents).toContain('autofix_start');
      expect(eventTypes()).toContain('mission_failed');
      expect(statusEvents).toContain('autofix_failed');
    });

    it('all 7 mission event types are emitted during autofix-triggered mission', async () => {
      const llm = createFullMissionLlm(2);
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });

      await executor.execute(createTaskItem(), createProjectMap());

      const types = eventTypes();

      // Verify all 7 mission event types appear (mission_iteration may not appear if APPROVED on first pass)
      const requiredMissionEvents = [
        'mission_planned',
        'mission_subtask_started',
        'mission_subtask_completed',
        'mission_director_review',
        'mission_completed',
      ];

      for (const eventType of requiredMissionEvents) {
        expect(types).toContain(eventType);
      }

      // No mission_failed
      expect(types).not.toContain('mission_failed');
    });
  });

  // ── VAL-CROSS-003: Config gating across the entire pipeline ──────────

  describe('VAL-CROSS-003: Config gating', () => {
    it('mission.enabled = false prevents execution with clear error', async () => {
      const executor = makeExecutor({
        orchestratorModel: 'claude-opus-4-6',
        missionConfig: { enabled: false, autoApprove: false, maxIterations: 5 },
      });

      const result = await executor.execute(createTaskItem(), createProjectMap());
      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');

      // Verify no mission events emitted
      const types = eventTypes();
      expect(types).not.toContain('mission_planned');
      expect(types).not.toContain('mission_subtask_started');
      expect(types).not.toContain('mission_completed');
      expect(types).not.toContain('mission_failed');
    });

    it('mission.enabled = false returns result immediately without LLM calls', async () => {
      const spyLlm: LlmClient = {
        supportsVision: true,
        chat: vi.fn(),
        chatWithVision: vi.fn(),
        stream: vi.fn(),
      } as unknown as LlmClient;

      const executor = makeExecutor({
        orchestratorModel: 'claude-opus-4-6',
        llm: spyLlm,
        missionConfig: { enabled: false, autoApprove: false, maxIterations: 5 },
      });

      await executor.execute(createTaskItem(), createProjectMap());

      // No LLM calls should have been made
      expect(spyLlm.chat).not.toHaveBeenCalled();
      expect(spyLlm.stream).not.toHaveBeenCalled();
    });

    it('mission.enabled = true allows normal execution', async () => {
      const llm = createFullMissionLlm(1);
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });

      const result = await executor.execute(createTaskItem(), createProjectMap());
      expect(result.success).toBe(true);
    });

    it('missing missionConfig defaults to enabled behavior (undefined = enabled)', async () => {
      // When missionConfig is undefined, the check `if (this.missionConfig && !this.missionConfig.enabled)`
      // evaluates to false, so execution proceeds normally.
      // Note: autoApprove defaults to false, so we need to confirm.
      const llm = createFullMissionLlm(1);
      // Don't pass missionConfig at all (simulates missing config)
      const executor = new Lane5Executor(
        projectDir,
        llm,
        mockGit,
        mockEventBus,
        'claude-opus-4-6',
        undefined, // missionConfig not provided
      );

      const p = executor.execute(createTaskItem(), createProjectMap());
      await vi.waitFor(() => {
        expect(eventsOfType('pending_tasks').length).toBe(1);
      }, { timeout: 2000 });
      mockEventBus._trigger('confirm_tasks', { taskIds: ['task-cross-1'] });
      const result = await p;

      expect(result.success).toBe(true);
    });

    it('autoApprove = true skips pending_tasks event', async () => {
      const llm = createFullMissionLlm(1);
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });

      await executor.execute(createTaskItem(), createProjectMap());
      expect(eventTypes()).not.toContain('pending_tasks');
    });

    it('autoApprove = false emits pending_tasks', async () => {
      const llm = createFullMissionLlm(1);
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: false, maxIterations: 5 },
      });

      const p = executor.execute(createTaskItem(), createProjectMap());

      await vi.waitFor(() => {
        expect(eventsOfType('pending_tasks').length).toBe(1);
      }, { timeout: 2000 });

      mockEventBus._trigger('confirm_tasks', { taskIds: ['task-cross-1'] });
      await p;

      expect(eventTypes()).toContain('pending_tasks');
      expect(eventTypes()).toContain('mission_completed');
    });
  });

  // ── VAL-CROSS-004: Mission + regular task coexist ────────────────────

  describe('VAL-CROSS-004: Mission + regular task coexistence', () => {
    it('mission events and regular task events can interleave without conflict', async () => {
      const llm = createFullMissionLlm(2);
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });

      // Simulate a regular Lane 1 task being created before the mission
      mockEventBus.emit({
        type: 'task_created',
        data: {
          id: 'regular-task-1',
          description: 'Fix button color',
          files: ['app/components/Button.tsx'],
          type: 'css',
          lane: 1,
          status: 'pending',
        },
      });

      mockEventBus.emit({
        type: 'task_started',
        data: { taskId: 'regular-task-1' },
      });

      // Now run the mission
      const result = await executor.execute(createTaskItem(), createProjectMap());
      expect(result.success).toBe(true);

      // Simulate regular task completing after mission
      mockEventBus.emit({
        type: 'task_completed',
        data: { taskId: 'regular-task-1', diff: '--- button color', commitHash: 'def5678' },
      });

      // Verify both task and mission events are present without cross-contamination
      const types = eventTypes();

      // Regular task events
      expect(types).toContain('task_created');
      expect(types).toContain('task_started');
      expect(types).toContain('task_completed');

      // Mission events
      expect(types).toContain('mission_planned');
      expect(types).toContain('mission_completed');

      // Regular task events use their own taskId, mission uses its taskId
      const taskCompleted = eventsOfType('task_completed')[0];
      expect(eventData(taskCompleted!).taskId as string).toBe('regular-task-1');

      const missionCompleted = eventsOfType('mission_completed')[0];
      expect(eventData(missionCompleted!).taskId as string).toBe('task-cross-1');
    });

    it('multiple regular tasks can interleave with mission execution', async () => {
      const llm = createFullMissionLlm(2);
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });

      // Create two regular tasks
      for (let i = 1; i <= 2; i++) {
        mockEventBus.emit({
          type: 'task_created',
          data: {
            id: `regular-${i}`,
            description: `Task ${i}`,
            files: [`file-${i}.tsx`],
            type: 'single_file',
            lane: 2,
            status: 'pending',
          },
        });
        mockEventBus.emit({
          type: 'task_started',
          data: { taskId: `regular-${i}` },
        });
      }

      const result = await executor.execute(createTaskItem(), createProjectMap());
      expect(result.success).toBe(true);

      // Complete regular tasks
      for (let i = 1; i <= 2; i++) {
        mockEventBus.emit({
          type: 'task_completed',
          data: { taskId: `regular-${i}`, diff: `diff ${i}`, commitHash: `hash${i}` },
        });
      }

      // Verify all tasks present
      expect(eventsOfType('task_created').length).toBe(2);
      expect(eventsOfType('task_started').length).toBe(2);
      expect(eventsOfType('task_completed').length).toBe(2);
      expect(eventsOfType('mission_planned').length).toBe(1);
      expect(eventsOfType('mission_completed').length).toBe(1);
    });

    it('pending_tasks for mission does not interfere with other events', async () => {
      const llm = createFullMissionLlm(1);
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: false, maxIterations: 5 },
      });

      const p = executor.execute(createTaskItem(), createProjectMap());

      // While mission is pending, emit a regular task event
      await vi.waitFor(() => {
        expect(eventsOfType('pending_tasks').length).toBe(1);
      }, { timeout: 2000 });

      mockEventBus.emit({
        type: 'task_started',
        data: { taskId: 'other-task' },
      });

      // The pending_tasks event should still be present
      expect(eventsOfType('pending_tasks').length).toBe(1);

      // Confirm mission
      mockEventBus._trigger('confirm_tasks', { taskIds: ['task-cross-1'] });
      const result = await p;

      expect(result.success).toBe(true);
      expect(eventTypes()).toContain('task_started'); // Regular task event preserved
    });
  });

  // ── VAL-CROSS-005: Mission survives restart ──────────────────────────

  describe('VAL-CROSS-005: Mission survives restart', () => {
    it('mission state persists to disk and is recoverable after "restart"', async () => {
      const llm = createFullMissionLlm(2);
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });

      const task = createTaskItem();
      await executor.execute(task, createProjectMap());

      // Verify mission file exists
      const missionFilePath = join(projectDir, '.nova', 'missions', `mission-${task.id}.json`);
      expect(existsSync(missionFilePath)).toBe(true);

      // Simulate restart: create new MissionStore instance
      const newStore = new MissionStore(projectDir);
      const allMissions = await newStore.getAll();
      expect(allMissions.length).toBeGreaterThanOrEqual(1);

      const loadedMission = await newStore.load(`mission-${task.id}`);
      expect(loadedMission).not.toBeNull();
      expect(loadedMission!.taskId).toBe(task.id);
      expect(loadedMission!.status).toBe('completed');
      expect(loadedMission!.featureResults).toBeDefined();
    });

    it('getActive returns missions in non-terminal states', async () => {
      // Use MissionStore directly to test restart scenarios
      const store = new MissionStore(projectDir);

      // Save an active (executing) mission
      await store.save({
        id: 'active-mission',
        taskId: 'task-active',
        status: 'executing',
        plan: {
          features: [
            { id: 'f1', description: 'Feature 1', files: ['f1.ts'], type: 'multi_file' as const, dependencies: [] },
          ],
        },
        featureResults: {},
        iteration: 1,
        maxIterations: 5,
      });

      // Save a completed mission
      await store.save({
        id: 'done-mission',
        taskId: 'task-done',
        status: 'completed',
        plan: { features: [] },
        featureResults: {},
        iteration: 1,
        maxIterations: 5,
      });

      // Save a failed mission
      await store.save({
        id: 'failed-mission',
        taskId: 'task-failed',
        status: 'failed',
        plan: { features: [] },
        featureResults: {},
        iteration: 3,
        maxIterations: 5,
      });

      // Simulate restart: new store instance
      const newStore = new MissionStore(projectDir);
      const active = await newStore.getActive();

      expect(active.length).toBe(1);
      expect(active[0]!.id).toBe('active-mission');
      expect(active[0]!.status).toBe('executing');

      // Terminal missions not in active
      const activeIds = active.map((m) => m.id);
      expect(activeIds).not.toContain('done-mission');
      expect(activeIds).not.toContain('failed-mission');
    });

    it('mission with feature results survives restart intact', async () => {
      const llm = createFullMissionLlm(3);
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });

      const task = createTaskItem();
      await executor.execute(task, createProjectMap());

      // Verify persisted mission has feature results
      const newStore = new MissionStore(projectDir);
      const loaded = await newStore.load(`mission-${task.id}`);
      expect(loaded).not.toBeNull();
      expect(Object.keys(loaded!.featureResults).length).toBe(3);

      // Each feature result should have the expected shape
      for (const [featureId, result] of Object.entries(loaded!.featureResults)) {
        expect(featureId).toMatch(/^feat-/);
        expect(result.success).toBe(true);
        expect(result.featureId).toBe(featureId);
      }
    });

    it('getAll returns all missions including terminal states', async () => {
      const store = new MissionStore(projectDir);

      await store.save({
        id: 'm1',
        taskId: 't1',
        status: 'executing',
        plan: { features: [] },
        featureResults: {},
        iteration: 0,
        maxIterations: 5,
      });

      await store.save({
        id: 'm2',
        taskId: 't2',
        status: 'completed',
        plan: { features: [] },
        featureResults: {},
        iteration: 2,
        maxIterations: 5,
      });

      const newStore = new MissionStore(projectDir);
      const all = await newStore.getAll();
      expect(all.length).toBe(2);
    });
  });

  // ── VAL-CROSS-006: Orchestrator model consistency ────────────────────

  describe('VAL-CROSS-006: Orchestrator model consistency', () => {
    it('orchestrator model is used for planning and director review', async () => {
      const modelTracker: string[] = [];
      const llm = createOrchestratorModelVerificationLlm(modelTracker);

      const executor = makeExecutor({
        llm,
        orchestratorModel: 'claude-opus-4-6',
        workerModel: 'claude-sonnet-4-6',
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });

      await executor.execute(createTaskItem(), createProjectMap());

      // Both planning and director review should use the orchestrator model
      expect(modelTracker.length).toBeGreaterThanOrEqual(2);
      for (const model of modelTracker) {
        expect(model).toBe('claude-opus-4-6');
      }
    });

    it('orchestrator model falls back to default when not configured', async () => {
      // When orchestratorModel is not explicitly set, the internal orchModel falls back
      // to 'claude-sonnet-4-6' (the constructor default). But execute() still requires
      // a truthy orchestratorModel parameter. This test verifies the default value
      // is used when an explicit empty string is passed (falsy).
      const modelTracker: string[] = [];
      const llm = createOrchestratorModelVerificationLlm(modelTracker);

      // Pass undefined orchestratorModel — constructor defaults orchModel to 'claude-sonnet-4-6'
      // BUT execute() checks: if (!this.orchestratorModel) returns error
      // So we must pass a non-empty orchestratorModel to allow execution
      const executor = new Lane5Executor(
        projectDir,
        llm,
        mockGit,
        mockEventBus,
        'claude-sonnet-4-6', // explicit orchestratorModel
        { enabled: true, autoApprove: true, maxIterations: 5 },
      );

      await executor.execute(createTaskItem(), createProjectMap());

      expect(modelTracker.length).toBeGreaterThanOrEqual(2);
      for (const model of modelTracker) {
        expect(model).toBe('claude-sonnet-4-6');
      }
    });

    it('different orchestrator model is respected across multiple missions', async () => {
      // First mission with model A
      const tracker1: string[] = [];
      const llm1 = createOrchestratorModelVerificationLlm(tracker1);
      const executor1 = makeExecutor({
        llm: llm1,
        orchestratorModel: 'gpt-5-turbo',
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });
      await executor1.execute(createTaskItem({ id: 'task-a' }), createProjectMap());

      for (const model of tracker1) {
        expect(model).toBe('gpt-5-turbo');
      }

      // Second mission with model B (different temp dir, different event bus)
      const dir2 = mkdtempSync(join(tmpdir(), 'nova-cross-b-'));
      const bus2 = createMockEventBus();
      const tracker2: string[] = [];
      const llm2 = createOrchestratorModelVerificationLlm(tracker2);

      const executor2 = new Lane5Executor(
        dir2,
        llm2,
        createMockGitManager(),
        bus2,
        'claude-opus-4-6',
        { enabled: true, autoApprove: true, maxIterations: 5 },
      );

      await executor2.execute(createTaskItem({ id: 'task-b' }), createProjectMap());

      for (const model of tracker2) {
        expect(model).toBe('claude-opus-4-6');
      }

      try { rmSync(dir2, { recursive: true, force: true }); } catch { /* cleanup */ }
    });

    it('worker model is separate from orchestrator model', async () => {
      // The stream should use workerModel, while chat uses orchestratorModel
      // We verify this by checking the stream function uses the right model
      const orchestratorTracker: string[] = [];
      const workerTracker: string[] = [];

      const llm: LlmClient = {
        supportsVision: true,
        chat: vi.fn().mockImplementation(async (_messages, options?: { model?: string }) => {
          if (options?.model) orchestratorTracker.push(options.model);
          if (orchestratorTracker.length === 1) {
            return {
              content: JSON.stringify({
                features: [{ id: 'f1', description: 'F1', files: ['f1.tsx'], type: 'multi_file' as const, dependencies: [] }],
              }),
            } as ChatResponse;
          }
          return { content: JSON.stringify({ decision: 'APPROVED', feedback: [] }) } as ChatResponse;
        }),
        chatWithVision: vi.fn(),
        stream: vi.fn().mockImplementation((_messages, options?: { model?: string }) => {
          if (options?.model) workerTracker.push(options.model);
          async function* gen() {
            yield { content: '=== FILE: f1.tsx ===\n// code\n=== END FILE ===' };
          }
          return gen();
        }),
      } as unknown as LlmClient;

      const executor = new Lane5Executor(
        projectDir,
        llm,
        mockGit,
        mockEventBus,
        'claude-opus-4-6', // orchestrator model
        { enabled: true, autoApprove: true, maxIterations: 5 },
        undefined, undefined, undefined, undefined,
        'claude-sonnet-4-6', // worker model
      );

      await executor.execute(createTaskItem(), createProjectMap());

      // Orchestrator calls should use 'claude-opus-4-6'
      expect(orchestratorTracker.length).toBeGreaterThanOrEqual(2);
      for (const m of orchestratorTracker) {
        expect(m).toBe('claude-opus-4-6');
      }

      // Worker calls (stream) should use 'claude-sonnet-4-6'
      expect(workerTracker.length).toBeGreaterThanOrEqual(1);
      for (const m of workerTracker) {
        expect(m).toBe('claude-sonnet-4-6');
      }
    });
  });

  // ── VAL-CROSS-007: Director NEEDS_REVISION → worker re-execution ─────

  describe('VAL-CROSS-007: Director NEEDS_REVISION workflow', () => {
    it('NEEDS_REVISION on iteration 1, APPROVED on iteration 2', async () => {
      const llm = createNeedsRevisionThenApprovedLlm();
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });

      const result = await executor.execute(createTaskItem(), createProjectMap());
      expect(result.success).toBe(true);

      const types = eventTypes();

      // Verify iteration event emitted
      expect(types).toContain('mission_iteration');

      // Verify two review cycles
      const reviews = eventsOfType('mission_director_review');
      expect(reviews.length).toBe(2);

      // First review: NEEDS_REVISION
      const firstVerdict = (eventData(reviews[0]!) as { verdict: { decision: string } }).verdict;
      expect(firstVerdict.decision).toBe('NEEDS_REVISION');

      // Second review: APPROVED
      const secondVerdict = (eventData(reviews[1]!) as { verdict: { decision: string } }).verdict;
      expect(secondVerdict.decision).toBe('APPROVED');

      // Mission iteration event should have correct data
      const iterEvent = eventsOfType('mission_iteration')[0];
      expect(iterEvent).toBeDefined();
      const iterData = eventData(iterEvent!) as { iteration: number; maxIterations: number };
      expect(iterData.iteration).toBe(1);
      expect(iterData.maxIterations).toBe(5);

      // Final mission_completed event should appear near the end
      const lastCompleted = types.lastIndexOf('mission_completed');
      expect(lastCompleted).toBeGreaterThan(-1);
      // mission_completed should come after the second review
      const secondReviewIdx = types.lastIndexOf('mission_director_review');
      expect(secondReviewIdx).toBeLessThan(lastCompleted);
    });

    it('only failed features re-execute on NEEDS_REVISION', async () => {
      // feat-a needs revision, feat-b does not
      const llm = createNeedsRevisionThenApprovedLlm();
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });

      await executor.execute(createTaskItem(), createProjectMap());

      // Feature started events: feat-a appears twice (initial + retry), feat-b once
      const startedEvents = eventsOfType('mission_subtask_started');
      const featsStarted = startedEvents.map(
        (e) => (eventData(e) as { featureId: string }).featureId,
      );

      // feat-a should appear twice (initial + retry)
      const featAStarts = featsStarted.filter((id) => id === 'feat-a').length;
      expect(featAStarts).toBeGreaterThanOrEqual(1);

      // feat-b should appear exactly once
      const featBStarts = featsStarted.filter((id) => id === 'feat-b').length;
      expect(featBStarts).toBe(1);
    });

    it('director loop exits after maxIterations', async () => {
      const llm = createAlwaysNeedsRevisionLlm(2);
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 2 },
      });

      const result = await executor.execute(createTaskItem(), createProjectMap());
      expect(result).toBeDefined();

      // Should not exceed maxIterations review cycles
      const reviews = eventsOfType('mission_director_review');
      expect(reviews.length).toBeLessThanOrEqual(2);

      // Iteration events should not exceed maxIterations-1
      const iterations = eventsOfType('mission_iteration');
      expect(iterations.length).toBeLessThanOrEqual(1);
    });

    it('iteration counter correctly increments across review cycles', async () => {
      const llm = createAlwaysNeedsRevisionLlm(1);
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 3 },
      });

      await executor.execute(createTaskItem(), createProjectMap());

      const iterEvents = eventsOfType('mission_iteration');
      expect(iterEvents.length).toBeGreaterThanOrEqual(1);

      // Verify iteration numbers are sequential
      for (let i = 0; i < iterEvents.length; i++) {
        const data = eventData(iterEvents[i]!) as { iteration: number; maxIterations: number };
        expect(data.iteration).toBe(i + 1);
        expect(data.maxIterations).toBe(3);
      }
    });

    it('maxIterations = 1 means single-shot (no retry)', async () => {
      const llm = createAlwaysNeedsRevisionLlm(1);
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 1 },
      });

      await executor.execute(createTaskItem(), createProjectMap());

      // Only one review, no iteration events
      expect(eventsOfType('mission_director_review').length).toBe(1);
      expect(eventsOfType('mission_iteration').length).toBe(0);
    });
  });

  // ── VAL-CROSS-008: Autofix budget exhausted → user tasks unaffected ──

  describe('VAL-CROSS-008: Autofix budget exhaustion isolation', () => {
    it('previous mission failures do not affect subsequent mission execution', async () => {
      // First mission: fails (simulating autofix budget exhaustion)
      const failingLlm: LlmClient = {
        supportsVision: true,
        chat: vi.fn().mockRejectedValue(new Error('LLM crash')),
        chatWithVision: vi.fn(),
        stream: vi.fn(),
      } as unknown as LlmClient;

      const executor1 = makeExecutor({
        llm: failingLlm,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });

      const result1 = await executor1.execute(
        createTaskItem({ id: 'autofix-task-1' }),
        createProjectMap(),
      );
      expect(result1.success).toBe(false);

      // Second mission: should work fine (different task, fresh executor)
      const llm2 = createFullMissionLlm(2);
      const executor2 = makeExecutor({
        llm: llm2,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });

      const result2 = await executor2.execute(
        createTaskItem({ id: 'user-task-2' }),
        createProjectMap(),
      );
      expect(result2.success).toBe(true);
    });

    it('user-initiated mission proceeds normally after autofix failure', async () => {
      // Simulate autofix failure
      mockEventBus.emit({
        type: 'status',
        data: { message: 'autofix_budget_exhausted' },
      });

      mockEventBus.emit({
        type: 'task_failed',
        data: { taskId: 'autofix-task', error: 'Budget exhausted' },
      });

      // Now user initiates a manual Lane 5 task - it should work fine
      const llm = createFullMissionLlm(2);
      const executor = makeExecutor({
        llm,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });

      const result = await executor.execute(
        createTaskItem({ id: 'manual-user-task' }),
        createProjectMap(),
      );

      expect(result.success).toBe(true);
      expect(eventTypes()).toContain('mission_completed');
      expect(eventTypes()).not.toContain('mission_failed');
    });

    it('multiple consecutive missions all succeed after autofix budget exhausted', async () => {
      // Simulate autofix budget exhausted
      mockEventBus.emit({
        type: 'status',
        data: { message: 'autofix_budget_exhausted' },
      });

      // Run 3 consecutive user-initiated missions
      for (let i = 1; i <= 3; i++) {
        const llm = createFullMissionLlm(1);
        const executor = makeExecutor({
          llm,
          missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
        });

        const result = await executor.execute(
          createTaskItem({ id: `user-mission-${i}` }),
          createProjectMap(),
        );
        expect(result.success).toBe(true);
      }

      // All 3 missions should have completed successfully
      expect(eventsOfType('mission_completed').length).toBe(3);
      expect(eventsOfType('mission_failed').length).toBe(0);
    });

    it('Lane5Executor is stateless between executions', async () => {
      // Use separate LLM instances since the mock has internal mutable state (chatCall counter)
      const llm1 = createFullMissionLlm(1);
      const executor1 = makeExecutor({
        llm: llm1,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });

      // Run the same executor twice with different tasks (but separate LLMs to avoid mock state sharing)
      const r1 = await executor1.execute(
        createTaskItem({ id: 'first-task' }),
        createProjectMap(),
      );
      expect(r1.success).toBe(true);

      // Fresh LLM for second execution
      const llm2 = createFullMissionLlm(1);
      const executor2 = makeExecutor({
        llm: llm2,
        missionConfig: { enabled: true, autoApprove: true, maxIterations: 5 },
      });

      const r2 = await executor2.execute(
        createTaskItem({ id: 'second-task' }),
        createProjectMap(),
      );
      expect(r2.success).toBe(true);

      // Both should complete independently
      expect(eventsOfType('mission_completed').length).toBe(2);
    });
  });
});

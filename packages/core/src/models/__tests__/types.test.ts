import { describe, it, expect } from 'vitest';
import type {
  Lane,
  TaskItem,
  HistoryEntry,
  BackgroundTask,
  MissionFeature,
  MissionPlan,
  MissionState,
  MissionStatus,
  FeatureResult,
  DirectorVerdict,
  DirectorDecision,
} from '../types.js';

describe('Lane type', () => {
  it('should accept lane 5', () => {
    // Compile-time check: Lane type must accept 5
    const lane: Lane = 5;
    expect(lane).toBe(5);
  });

  it('should accept lanes 1-4 for backward compatibility', () => {
    const lane1: Lane = 1;
    const lane2: Lane = 2;
    const lane3: Lane = 3;
    const lane4: Lane = 4;
    expect(lane1).toBe(1);
    expect(lane2).toBe(2);
    expect(lane3).toBe(3);
    expect(lane4).toBe(4);
  });
});

describe('TaskItem with lane 5', () => {
  it('should accept TaskItem with lane: 5', () => {
    const task: TaskItem = {
      id: 'task-1',
      description: 'Build a login page with form validation',
      files: ['app/login/page.tsx'],
      type: 'multi_file',
      lane: 5,
      status: 'pending',
    };
    expect(task.lane).toBe(5);
  });
});

describe('HistoryEntry with lane 5', () => {
  it('should accept HistoryEntry with lane: 5', () => {
    const entry: HistoryEntry = {
      id: 'hist-1',
      taskId: 'task-1',
      description: 'Build a login page',
      type: 'multi_file',
      lane: 5,
      status: 'done',
      filesChanged: ['app/login/page.tsx'],
      startedAt: Date.now(),
    };
    expect(entry.lane).toBe(5);
  });
});

describe('BackgroundTask with lane 5', () => {
  it('should accept BackgroundTask with lane: 5 in nested task', () => {
    const bgTask: BackgroundTask = {
      id: 'bg-1',
      task: {
        id: 'task-1',
        description: 'Mission task',
        files: ['app/page.tsx'],
        type: 'refactor',
        lane: 5,
        status: 'pending',
      },
      status: 'queued',
      queuedAt: Date.now(),
    };
    expect(bgTask.task.lane).toBe(5);
  });
});

describe('MissionFeature', () => {
  it('should construct valid MissionFeature', () => {
    const feature: MissionFeature = {
      id: 'feat-1',
      description: 'Add login form',
      files: ['app/login/page.tsx'],
      type: 'multi_file',
      dependencies: [],
    };
    expect(feature.id).toBe('feat-1');
    expect(feature.dependencies).toEqual([]);
  });

  it('should accept features with dependencies', () => {
    const feature: MissionFeature = {
      id: 'feat-2',
      description: 'Add dashboard',
      files: ['app/dashboard/page.tsx'],
      type: 'multi_file',
      dependencies: ['feat-1'],
    };
    expect(feature.dependencies).toContain('feat-1');
  });
});

describe('MissionPlan', () => {
  it('should construct valid MissionPlan', () => {
    const plan: MissionPlan = {
      features: [
        {
          id: 'feat-1',
          description: 'Add login form',
          files: ['app/login/page.tsx'],
          type: 'multi_file',
          dependencies: [],
        },
      ],
    };
    expect(plan.features).toHaveLength(1);
  });

  it('should accept empty features array', () => {
    const plan: MissionPlan = { features: [] };
    expect(plan.features).toEqual([]);
  });
});

describe('FeatureResult', () => {
  it('should construct successful FeatureResult', () => {
    const result: FeatureResult = {
      success: true,
      featureId: 'feat-1',
      diff: '+import React',
      generatedFiles: [{ path: 'app/login/page.tsx', content: 'export default function Page() {}' }],
      validationErrors: [],
    };
    expect(result.success).toBe(true);
    expect(result.featureId).toBe('feat-1');
  });

  it('should construct failed FeatureResult', () => {
    const result: FeatureResult = {
      success: false,
      featureId: 'feat-2',
      error: 'LLM did not generate any file blocks',
    };
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should accept FeatureResult with fixIterations', () => {
    const result: FeatureResult = {
      success: true,
      featureId: 'feat-1',
      fixIterations: 2,
    };
    expect(result.fixIterations).toBe(2);
  });
});

describe('DirectorVerdict', () => {
  it('should construct APPROVED verdict', () => {
    const verdict: DirectorVerdict = {
      decision: 'APPROVED',
      feedback: [],
    };
    expect(verdict.decision).toBe('APPROVED');
  });

  it('should construct NEEDS_REVISION verdict', () => {
    const verdict: DirectorVerdict = {
      decision: 'NEEDS_REVISION',
      feedback: [
        { featureId: 'feat-1', actionItems: ['fix type error in login.ts'] },
      ],
    };
    expect(verdict.decision).toBe('NEEDS_REVISION');
    expect(verdict.feedback[0]?.actionItems).toHaveLength(1);
  });

  it('should construct REJECTED verdict', () => {
    const verdict: DirectorVerdict = {
      decision: 'REJECTED',
      feedback: [
        { featureId: 'feat-1', actionItems: ['redo entire feature'] },
      ],
    };
    expect(verdict.decision).toBe('REJECTED');
  });

  it('DirectorDecision type should be constrained to 3 values', () => {
    // Compile-time check: must only accept the 3 allowed values
    const approved: DirectorDecision = 'APPROVED';
    const revision: DirectorDecision = 'NEEDS_REVISION';
    const rejected: DirectorDecision = 'REJECTED';
    expect(approved).toBe('APPROVED');
    expect(revision).toBe('NEEDS_REVISION');
    expect(rejected).toBe('REJECTED');
  });
});

describe('MissionState', () => {
  it('should construct full MissionState', () => {
    const state: MissionState = {
      id: 'mission-1',
      taskId: 'task-1',
      status: 'executing',
      plan: {
        features: [
          {
            id: 'feat-1',
            description: 'Add login',
            files: ['app/login/page.tsx'],
            type: 'multi_file',
            dependencies: [],
          },
        ],
      },
      featureResults: {},
      iteration: 0,
      maxIterations: 5,
    };
    expect(state.status).toBe('executing');
    expect(state.iteration).toBe(0);
    expect(state.maxIterations).toBe(5);
  });

  it('MissionStatus should be exhaustive (6 values)', () => {
    const statuses: MissionStatus[] = [
      'planning',
      'awaiting_confirmation',
      'executing',
      'reviewing',
      'completed',
      'failed',
    ];
    expect(statuses).toHaveLength(6);
  });

  it('should switch exhaustively on all MissionStatus values', () => {
    const statuses: MissionStatus[] = [
      'planning',
      'awaiting_confirmation',
      'executing',
      'reviewing',
      'completed',
      'failed',
    ];

    const results: string[] = [];

    for (const status of statuses) {
      // Exhaustive switch: if any status is unhandled, TypeScript will error
      switch (status) {
        case 'planning':
          results.push('p');
          break;
        case 'awaiting_confirmation':
          results.push('a');
          break;
        case 'executing':
          results.push('e');
          break;
        case 'reviewing':
          results.push('r');
          break;
        case 'completed':
          results.push('c');
          break;
        case 'failed':
          results.push('f');
          break;
        default: {
          // TypeScript should narrow status to `never` here
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const _exhaustive: never = status;
          throw new Error(`Unhandled status: ${String(_exhaustive)}`);
        }
      }
    }

    expect(results).toEqual(['p', 'a', 'e', 'r', 'c', 'f']);
  });
});

describe('Mission-specific types do not leak into TaskItem', () => {
  it('should not have mission fields on TaskItem', () => {
    const task: TaskItem = {
      id: 'task-1',
      description: 'Test',
      files: ['test.ts'],
      type: 'single_file',
      lane: 1,
      status: 'pending',
    };

    // Verify only standard TaskItem fields exist
    expect(task).toHaveProperty('id');
    expect(task).toHaveProperty('description');
    expect(task).toHaveProperty('files');
    expect(task).toHaveProperty('type');
    expect(task).toHaveProperty('lane');
    expect(task).toHaveProperty('status');

    // Mission fields should NOT exist on TaskItem
    const taskAsRecord = task as unknown as Record<string, unknown>;
    expect(taskAsRecord.featureResults).toBeUndefined();
    expect(taskAsRecord.directorVerdict).toBeUndefined();
    expect(taskAsRecord.plan).toBeUndefined();
  });
});

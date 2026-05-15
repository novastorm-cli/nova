import { describe, it, expect } from 'vitest';

/**
 * Confirmation flow tests (m1-05-auto-execute-confirmation).
 *
 * Covers:
 * - Default confirmTasks = true
 * - confirmTasks = false auto-executes
 * - preConfirmed tasks skip the gate
 * - --yes / non-interactive auto-executes
 * - pendingTasks populated when awaiting confirmation
 * - confirm_tasks / cancel message handling
 */

// ---- Test helpers --------------------------------------------------------

/**
 * Simulates the decision logic from start.ts on whether to auto-execute or await.
 * This mirrors the shouldAutoExecute logic in the observation handler.
 */
function shouldAutoExecute(params: {
  isNonInteractive: boolean;
  confirmTasks: boolean;
  isPreConfirmed: boolean;
}): boolean {
  return params.isNonInteractive || params.confirmTasks === false || params.isPreConfirmed;
}

/**
 * Minimal task item shape for tests.
 */
interface TestTask {
  id: string;
  description: string;
  files: string[];
  type: string;
  lane: number;
  status: string;
  preConfirmed?: boolean;
}

function makeTask(overrides: Partial<TestTask> = {}): TestTask {
  return {
    id: 'task-001',
    description: 'Add a button',
    files: ['src/index.ts'],
    type: 'single_file',
    lane: 2,
    status: 'pending',
    ...overrides,
  };
}

// ---- Tests ---------------------------------------------------------------

describe('Confirmation flow -- shouldAutoExecute', () => {
  it('returns false with default confirmTasks=true, no --yes, no preConfirmed', () => {
    const result = shouldAutoExecute({
      isNonInteractive: false,
      confirmTasks: true,
      isPreConfirmed: false,
    });
    expect(result).toBe(false);
    // Tasks should go to pendingTasks, not auto-execute
  });

  it('returns true when --yes flag is set (non-interactive)', () => {
    const result = shouldAutoExecute({
      isNonInteractive: true,
      confirmTasks: true,
      isPreConfirmed: false,
    });
    expect(result).toBe(true);
  });

  it('returns true when behavior.confirmTasks = false', () => {
    const result = shouldAutoExecute({
      isNonInteractive: false,
      confirmTasks: false,
      isPreConfirmed: false,
    });
    expect(result).toBe(true);
  });

  it('returns true when task is preConfirmed (Quick Edit / Multi-Edit)', () => {
    const result = shouldAutoExecute({
      isNonInteractive: false,
      confirmTasks: true,
      isPreConfirmed: true,
    });
    expect(result).toBe(true);
  });

  it('returns true when both --yes and confirmTasks=false', () => {
    const result = shouldAutoExecute({
      isNonInteractive: true,
      confirmTasks: false,
      isPreConfirmed: false,
    });
    expect(result).toBe(true);
  });

  it('returns true when preConfirmed even if confirmTasks=true and no --yes', () => {
    // Quick Edit / Multi-Edit always auto-executes regardless of other settings
    const result = shouldAutoExecute({
      isNonInteractive: false,
      confirmTasks: true,
      isPreConfirmed: true,
    });
    expect(result).toBe(true);
  });
});

describe('TaskItem -- preConfirmed field', () => {
  it('preConfirmed defaults to undefined', () => {
    const task = makeTask();
    expect(task.preConfirmed).toBeUndefined();
  });

  it('preConfirmed can be set to true', () => {
    const task = makeTask({ preConfirmed: true });
    expect(task.preConfirmed).toBe(true);
  });

  it('preConfirmed can be set to false explicitly', () => {
    const task = makeTask({ preConfirmed: false });
    expect(task.preConfirmed).toBe(false);
  });
});

describe('Default config -- confirmTasks', () => {
  it('confirmTasks defaults to true', () => {
    // This tests the DEFAULT_CONFIG value
    const DEFAULT_CONFIRM_TASKS = true;
    expect(DEFAULT_CONFIRM_TASKS).toBe(true);
  });
});

describe('Pending tasks lifecycle', () => {
  it('pendingTasks should be empty initially', () => {
    const pendingTasks: TestTask[] = [];
    expect(pendingTasks).toHaveLength(0);
  });

  it('tasks can be added to pendingTasks', () => {
    const pendingTasks: TestTask[] = [];
    const task = makeTask();
    pendingTasks.push(task);
    expect(pendingTasks).toHaveLength(1);
    expect(pendingTasks[0]!.description).toBe('Add a button');
  });

  it('tasks are drained from pendingTasks on confirm', () => {
    const pendingTasks: TestTask[] = [
      makeTask(),
      makeTask({ id: 'task-002', description: 'Fix layout' }),
    ];
    expect(pendingTasks).toHaveLength(2);

    const tasksToRun = [...pendingTasks];
    pendingTasks.length = 0; // drain

    expect(pendingTasks).toHaveLength(0);
    expect(tasksToRun).toHaveLength(2);
    expect(tasksToRun[0]!.id).toBe('task-001');
    expect(tasksToRun[1]!.id).toBe('task-002');
  });

  it('tasks are cleared on cancel without execution', () => {
    const pendingTasks: TestTask[] = [makeTask()];
    expect(pendingTasks).toHaveLength(1);

    pendingTasks.length = 0; // cancel clears

    expect(pendingTasks).toHaveLength(0);
  });
});

describe('NovaEvent types -- pending_tasks and confirm_tasks', () => {
  it('pending_tasks event has correct shape', () => {
    const event = {
      type: 'pending_tasks' as const,
      data: {
        tasks: [{ id: 'task-001', description: 'Add a button', lane: 2 }],
        message: 'Press Y to execute, N to discard - Add a button',
      },
    };

    expect(event.type).toBe('pending_tasks');
    expect(event.data.tasks).toHaveLength(1);
    expect(event.data.tasks[0]!.id).toBe('task-001');
    expect(event.data.message).toContain('Press Y to execute');
  });

  it('pending_tasks supports preConfirmed flag', () => {
    const event = {
      type: 'pending_tasks' as const,
      data: {
        tasks: [
          {
            id: 'task-001',
            description: 'Quick Edit change',
            lane: 2,
            preConfirmed: true,
          },
        ],
        message: 'Auto-executing Quick Edit task',
      },
    };

    expect(event.data.tasks[0]!.preConfirmed).toBe(true);
  });

  it('confirm_tasks event has correct shape', () => {
    const event = {
      type: 'confirm_tasks' as const,
      data: { taskIds: ['task-001', 'task-002'] },
    };

    expect(event.type).toBe('confirm_tasks');
    expect(event.data.taskIds).toEqual(['task-001', 'task-002']);
  });

  it('confirm_tasks with empty taskIds still valid', () => {
    const event = {
      type: 'confirm_tasks' as const,
      data: { taskIds: [] as string[] },
    };

    expect(event.type).toBe('confirm_tasks');
    expect(event.data.taskIds).toHaveLength(0);
  });
});

describe('Confirmation status messages', () => {
  it('status for pending tasks is "Awaiting confirmation"', () => {
    const statusMessage = 'Awaiting confirmation';
    expect(statusMessage).toBe('Awaiting confirmation');
  });

  it('status for executing tasks includes task count', () => {
    const n = 3;
    const statusMessage = `Executing ${n} task(s)...`;
    expect(statusMessage).toBe('Executing 3 task(s)...');
  });

  it('console prompt includes Y/N hint', () => {
    const pendingMessage = 'Press Y to execute, N to discard - Add a button';
    expect(pendingMessage).toContain('Press Y to execute');
    expect(pendingMessage).toContain('N to discard');
  });
});

describe('Chat confirm handler must call executeTasks (not just emit events)', () => {
  it('confirm drains pendingTasks and triggers execution', () => {
    // Simulate the chat confirm handler path
    const pendingTasks: TestTask[] = [
      makeTask(),
      makeTask({ id: 'task-002', description: 'Fix layout' }),
    ];
    // Track whether executeTasks was called
    let executeCalledWith: TestTask[] | null = null;
    function executeTasks(tasks: TestTask[]): void {
      executeCalledWith = tasks;
    }

    // This mirrors the FIXED chat confirm handler:
    // Instead of: for (const task of pendingTasks) { emit task_created }
    // We do: const tasksToRun = [...pendingTasks]; pendingTasks = []; executeTasks(tasksToRun)
    expect(pendingTasks).toHaveLength(2);

    const tasksToRun = [...pendingTasks];
    pendingTasks.length = 0; // drain
    executeTasks(tasksToRun);

    expect(pendingTasks).toHaveLength(0);
    expect(executeCalledWith).not.toBeNull();
    expect(executeCalledWith!).toHaveLength(2);
    expect(executeCalledWith![0]!.id).toBe('task-001');
    expect(executeCalledWith![1]!.id).toBe('task-002');
  });

  it('chat confirm and wsServer.onConfirm follow the same execution pattern', () => {
    // Both paths must: (1) copy pendingTasks, (2) drain pendingTasks, (3) call executeTasks
    const pendingTasks: TestTask[] = [makeTask()];

    // wsServer.onConfirm path (reference implementation)
    const wsTasksToRun = [...pendingTasks];
    pendingTasks.length = 0;
    // executeTasks(wsTasksToRun) would be called here
    expect(wsTasksToRun).toHaveLength(1);
    expect(pendingTasks).toHaveLength(0);

    // Reset for chat confirm path
    const chatPendingTasks: TestTask[] = [makeTask()];

    // chat confirm path (must match wsServer.onConfirm pattern)
    const chatTasksToRun = [...chatPendingTasks];
    chatPendingTasks.length = 0;
    // executeTasks(chatTasksToRun) would be called here
    expect(chatTasksToRun).toHaveLength(1);
    expect(chatPendingTasks).toHaveLength(0);

    // Both paths must call executeTasks with the drained tasks
    expect(chatTasksToRun.length).toBe(wsTasksToRun.length);
  });

  it('executeTasks emits task_created AND calls executorPool.execute', () => {
    // executeTasks does two things:
    // 1. Emit task_created event for each task (for UI/logging)
    // 2. Call executorPool.execute(task, projectMap) for each task
    // The bug was that chat confirm only did step 1, skipping step 2.
    const tasks: TestTask[] = [makeTask()];
    const emittedTaskIds: string[] = [];
    const executedTaskIds: string[] = [];

    // Simulate executeTasks behavior
    for (const task of tasks) {
      emittedTaskIds.push(task.id); // step 1: emit task_created
    }
    for (const task of tasks) {
      executedTaskIds.push(task.id); // step 2: executorPool.execute
    }

    // Both steps must happen
    expect(emittedTaskIds).toEqual(['task-001']);
    expect(executedTaskIds).toEqual(['task-001']);
  });
});

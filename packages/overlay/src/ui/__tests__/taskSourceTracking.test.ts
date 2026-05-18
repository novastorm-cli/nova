// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { strings } from '../strings.js';

type AutoExecuteSource = 'quick-edit' | 'multi-edit';

/**
 * Helper that mirrors the label-generation logic in index.ts's boot() closure.
 * Duplicated here for testability — the actual implementation lives in boot().
 */
function makeAutoExecLabel(taskSource: AutoExecuteSource | null | undefined): string {
  return taskSource
    ? ` (${
        taskSource === 'quick-edit' ? strings.executedViaQuickEdit : strings.executedViaMultiEdit
      })`
    : '';
}

/**
 * Simulates consuming autoExecuteSource into the per-task map and
 * returning the consumed source (which becomes null in real code).
 * Returns the consumed source value for assertion purposes.
 */
function consumeSource(
  map: Map<string, AutoExecuteSource>,
  taskIds: string[],
  source: AutoExecuteSource | null,
): AutoExecuteSource | null {
  if (source) {
    for (const id of taskIds) {
      map.set(id, source);
    }
  }
  return null; // autoExecuteSource becomes null after consumption
}

/**
 * Tests the per-task autoExecuteSource tracking pattern used in
 * packages/overlay/src/index.ts to fix the race condition where
 * autoExecuteSource was reset before the server responded with
 * task_created / task_started / task_completed events.
 *
 * The fix: autoExecuteSource is consumed into a Map<taskId, source>
 * when tasks are created, and looked up from the map when tasks
 * start and complete.
 */
describe('per-task autoExecuteSource tracking (Map-based)', () => {
  it('labels task_started with "executed via quick-edit" for quick-edit tasks', () => {
    const taskSourceMap = new Map<string, AutoExecuteSource>();
    const taskId = 'task-quick-1';

    // Simulate task_created: consume autoExecuteSource into per-task map
    consumeSource(taskSourceMap, [taskId], 'quick-edit');

    // Simulate task_started: look up source from map
    const taskSource = taskSourceMap.get(taskId);
    const label = makeAutoExecLabel(taskSource);
    expect(label).toBe(' (executed via quick-edit)');
  });

  it('labels task_completed with "executed via quick-edit" for quick-edit tasks', () => {
    const taskSourceMap = new Map<string, AutoExecuteSource>();
    const taskId = 'task-quick-1';

    // task_created
    consumeSource(taskSourceMap, [taskId], 'quick-edit');

    // task_completed
    const taskSource = taskSourceMap.get(taskId);
    const label = makeAutoExecLabel(taskSource);
    expect(label).toBe(' (executed via quick-edit)');

    // Cleanup after task_completed
    taskSourceMap.delete(taskId);
    expect(taskSourceMap.has(taskId)).toBe(false);
  });

  it('labels with "executed via multi-edit" for multi-edit tasks', () => {
    const taskSourceMap = new Map<string, AutoExecuteSource>();
    const taskId = 'task-multi-1';

    // task_created
    consumeSource(taskSourceMap, [taskId], 'multi-edit');

    // task_started
    const label = makeAutoExecLabel(taskSourceMap.get(taskId));
    expect(label).toBe(' (executed via multi-edit)');
  });

  it('returns empty label when no source is tracked for a task', () => {
    const taskSourceMap = new Map<string, AutoExecuteSource>();
    const label = makeAutoExecLabel(taskSourceMap.get('unknown-task'));
    expect(label).toBe('');
  });

  it('correctly tracks multiple concurrent tasks from the same source', () => {
    const taskSourceMap = new Map<string, AutoExecuteSource>();
    const taskIds = ['task-1', 'task-2', 'task-3'];

    // Simulate pending_tasks: consume source for all task IDs
    consumeSource(taskSourceMap, taskIds, 'multi-edit');

    // All tasks should have the correct label
    for (const id of taskIds) {
      const label = makeAutoExecLabel(taskSourceMap.get(id));
      expect(label).toBe(' (executed via multi-edit)');
    }

    // Each task completion cleans up only its own entry
    taskSourceMap.delete('task-1');
    expect(taskSourceMap.has('task-1')).toBe(false);
    expect(taskSourceMap.has('task-2')).toBe(true);
    expect(taskSourceMap.has('task-3')).toBe(true);

    taskSourceMap.delete('task-2');
    taskSourceMap.delete('task-3');
    expect(taskSourceMap.size).toBe(0);
  });

  it('correctly tracks multiple concurrent tasks from different sources', () => {
    const taskSourceMap = new Map<string, AutoExecuteSource>();

    // First batch: quick-edit
    consumeSource(taskSourceMap, ['quick-1', 'quick-2'], 'quick-edit');

    // Second batch: multi-edit
    consumeSource(taskSourceMap, ['multi-1'], 'multi-edit');

    // Verify mixed labels
    expect(makeAutoExecLabel(taskSourceMap.get('quick-1'))).toBe(' (executed via quick-edit)');
    expect(makeAutoExecLabel(taskSourceMap.get('quick-2'))).toBe(' (executed via quick-edit)');
    expect(makeAutoExecLabel(taskSourceMap.get('multi-1'))).toBe(' (executed via multi-edit)');

    // Tasks complete in any order
    taskSourceMap.delete('quick-1');
    taskSourceMap.delete('multi-1');
    taskSourceMap.delete('quick-2');

    expect(taskSourceMap.size).toBe(0);
  });

  it('does not label tasks when autoExecuteSource is null (regular voice/text commands)', () => {
    const taskSourceMap = new Map<string, AutoExecuteSource>();
    const taskId = 'task-regular-1';

    // task_created without a source — consumeSource skips when source is null
    consumeSource(taskSourceMap, [taskId], null);

    // No label expected
    const label = makeAutoExecLabel(taskSourceMap.get(taskId));
    expect(label).toBe('');
  });

  it('consumes autoExecuteSource exactly once per batch', () => {
    const taskSourceMap = new Map<string, AutoExecuteSource>();

    // First pending_tasks consumes the source
    consumeSource(taskSourceMap, ['a', 'b'], 'quick-edit');

    // Second pending_tasks (if any) has no source to consume
    // (source was already consumed and is now null)
    consumeSource(taskSourceMap, ['c'], null);

    // Only first batch gets labels
    expect(makeAutoExecLabel(taskSourceMap.get('a'))).toBe(' (executed via quick-edit)');
    expect(makeAutoExecLabel(taskSourceMap.get('b'))).toBe(' (executed via quick-edit)');
    expect(makeAutoExecLabel(taskSourceMap.get('c'))).toBe('');
  });

  it('labels are preserved even when task_started fires long after sendObservation', () => {
    // This is the core race-condition fix: autoExecuteSource survives
    // after sendObservation because it was consumed into the Map.
    const taskSourceMap = new Map<string, AutoExecuteSource>();
    const taskId = 'task-delayed';

    // 1. sendObservation sets autoExecuteSource and sends the observation
    // 2. autoExecuteSource is NOT reset (the fix)

    // 3. task_created fires (could be delayed)
    consumeSource(taskSourceMap, [taskId], 'quick-edit');

    // 4. task_started fires (could be much later)
    // At this point autoExecuteSource is null, but Map still has the entry
    const label = makeAutoExecLabel(taskSourceMap.get(taskId));
    expect(label).toBe(' (executed via quick-edit)');
  });
});

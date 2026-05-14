import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EventBus } from '../../contracts/IEventBus.js';
import type { NovaEvent } from '../../models/events.js';
import { ExecutorFSM, ExecutorState } from '../ExecutorFSM.js';

function createMockEventBus(): { bus: EventBus; events: NovaEvent[] } {
  const events: NovaEvent[] = [];
  const bus: EventBus = {
    emit: vi.fn((event: NovaEvent) => {
      events.push(event);
    }),
    on: vi.fn(),
    off: vi.fn(),
  };
  return { bus, events };
}

describe('ExecutorFSM', () => {
  let fsm: ExecutorFSM;
  let events: NovaEvent[];
  let bus: EventBus;

  beforeEach(() => {
    const mock = createMockEventBus();
    bus = mock.bus;
    events = mock.events;
    fsm = new ExecutorFSM(bus);
  });

  it('should start a task in Planning state and transition to Generating', () => {
    fsm.transition('task-1', ExecutorState.Planning, ExecutorState.Generating);

    expect(fsm.getState('task-1')).toBe(ExecutorState.Generating);

    // Verify event emitted
    const transitionEvents = events.filter((e) => e.type === 'fsm_transition');
    expect(transitionEvents).toHaveLength(1);
    expect(transitionEvents[0].task_id).toBe('task-1');
    expect(transitionEvents[0].prev).toBe('Planning');
    expect(transitionEvents[0].next).toBe('Generating');
    expect(transitionEvents[0].ts).toBeGreaterThan(0);
  });

  it('should transition through a full happy-path flow for Lane 2', () => {
    // Planning → Generating → Applying → Validating → Committing
    fsm.transition('task-1', ExecutorState.Planning, ExecutorState.Generating);
    fsm.transition('task-1', ExecutorState.Generating, ExecutorState.Applying);
    fsm.transition('task-1', ExecutorState.Applying, ExecutorState.Validating);
    fsm.transition('task-1', ExecutorState.Validating, ExecutorState.Committing);

    expect(fsm.getState('task-1')).toBe(ExecutorState.Committing);

    const transitionEvents = events.filter(
      (e): e is Extract<NovaEvent, { type: 'fsm_transition' }> => e.type === 'fsm_transition',
    );
    expect(transitionEvents).toHaveLength(4);
    expect(transitionEvents.map((t) => t.next)).toEqual([
      'Generating',
      'Applying',
      'Validating',
      'Committing',
    ]);
  });

  it('should handle the Fixing loop for Lane 3', () => {
    fsm.transition('task-1', ExecutorState.Planning, ExecutorState.Generating);
    fsm.transition('task-1', ExecutorState.Generating, ExecutorState.Applying);
    fsm.transition('task-1', ExecutorState.Applying, ExecutorState.Validating);
    // Validation found errors → Fixing
    fsm.transition('task-1', ExecutorState.Validating, ExecutorState.Fixing);
    // After fixing, re-validate
    fsm.transition('task-1', ExecutorState.Fixing, ExecutorState.Validating);
    fsm.transition('task-1', ExecutorState.Validating, ExecutorState.Committing);

    const transitionEvents = events.filter(
      (e): e is Extract<NovaEvent, { type: 'fsm_transition' }> => e.type === 'fsm_transition',
    );
    expect(transitionEvents).toHaveLength(6);
  });

  it('should handle transition to Failed state', () => {
    fsm.transition('task-1', ExecutorState.Planning, ExecutorState.Generating);
    fsm.transition('task-1', ExecutorState.Generating, ExecutorState.Failed);

    expect(fsm.getState('task-1')).toBe(ExecutorState.Failed);
    expect(fsm.isTerminal('task-1')).toBe(true);
  });

  it('should identify terminal states', () => {
    fsm.transition('task-1', ExecutorState.Planning, ExecutorState.Generating);
    expect(fsm.isTerminal('task-1')).toBe(false);

    fsm.transition('task-1', ExecutorState.Generating, ExecutorState.Failed);
    expect(fsm.isTerminal('task-1')).toBe(true);
  });

  it('should reset task state', () => {
    fsm.transition('task-1', ExecutorState.Planning, ExecutorState.Generating);
    fsm.transition('task-1', ExecutorState.Generating, ExecutorState.Committing);

    fsm.reset('task-1');
    expect(fsm.getState('task-1')).toBeUndefined();
  });

  it('should handle multiple tasks independently', () => {
    fsm.transition('task-1', ExecutorState.Planning, ExecutorState.Generating);
    fsm.transition('task-2', ExecutorState.Planning, ExecutorState.Generating);
    fsm.transition('task-1', ExecutorState.Generating, ExecutorState.Applying);

    expect(fsm.getState('task-1')).toBe(ExecutorState.Applying);
    expect(fsm.getState('task-2')).toBe(ExecutorState.Generating);
  });

  it('should include timestamp in transition events', () => {
    const before = Date.now();
    fsm.transition('task-1', ExecutorState.Planning, ExecutorState.Generating);
    const after = Date.now();

    const ev = events.find(
      (e): e is Extract<NovaEvent, { type: 'fsm_transition' }> => e.type === 'fsm_transition',
    );
    expect(ev).toBeDefined();
    expect(ev!.ts).toBeGreaterThanOrEqual(before);
    expect(ev!.ts).toBeLessThanOrEqual(after);
  });

  it('should log transitions with correlation ID when logger is provided', () => {
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };

    const fsmWithLogger = new ExecutorFSM(bus, mockLogger);
    fsmWithLogger.transition('task-1', ExecutorState.Planning, ExecutorState.Generating);

    expect(mockLogger.info).toHaveBeenCalledWith(
      'FSM: Planning -> Generating',
      expect.objectContaining({ taskId: 'task-1', prev: 'Planning', next: 'Generating' }),
    );
  });
});

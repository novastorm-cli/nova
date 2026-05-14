import type { EventBus } from '../models/events.js';
import type { ILogger } from '../contracts/ILogger.js';

/**
 * Executor FSM states.
 * Each task flows through these states during execution.
 */
export enum ExecutorState {
  Planning = 'Planning',
  Generating = 'Generating',
  Applying = 'Applying',
  Validating = 'Validating',
  Fixing = 'Fixing',
  Committing = 'Committing',
  Failed = 'Failed',
}

export interface FsmTransition {
  type: 'fsm_transition';
  task_id: string;
  prev: ExecutorState;
  next: ExecutorState;
  ts: number;
}

/**
 * Manages the executor state machine for a single task.
 * Emits fsm_transition events via EventBus and logs transitions via ILogger.
 *
 * Each lane implements the FSM with lane-specific strategies for `Applying`:
 * - Lane 1: regex/AST-based instant application
 * - Lane 2: single-file diff application
 * - Lane 3: multi-file file/diff block application
 * - Lane 4: background queue → Lane 3 delegation
 */
export class ExecutorFSM {
  private readonly state = new Map<string, ExecutorState>();

  constructor(
    private readonly eventBus: EventBus,
    private readonly logger?: ILogger,
  ) {}

  /**
   * Transition a task from one state to another.
   * Emits an fsm_transition event and logs the transition with correlation ID.
   */
  transition(taskId: string, from: ExecutorState, to: ExecutorState): void {
    const prev = this.getState(taskId);
    // Only transition if the from state matches current (sanity check)
    if (prev !== from) {
      // Allow initial transition from "nothing" to Planning
      if (from === ExecutorState.Planning && prev === undefined) {
        // First transition — allowed
      } else {
        this.logger?.warn('FSM transition mismatch', {
          taskId,
          expectedFrom: from,
          actualState: prev ?? 'undefined',
          targetTo: to,
        });
        // Proceed anyway — don't block execution on state mismatches
      }
    }

    this.state.set(taskId, to);
    const ts = Date.now();

    this.eventBus.emit({
      type: 'fsm_transition',
      task_id: taskId,
      prev: from,
      next: to,
      ts,
    });

    this.logger?.info(`FSM: ${from} -> ${to}`, { taskId, prev: from, next: to, ts });
  }

  /**
   * Get the current state of a task.
   */
  getState(taskId: string): ExecutorState | undefined {
    return this.state.get(taskId);
  }

  /**
   * Check if a task is in a terminal state (Failed or Committing).
   */
  isTerminal(taskId: string): boolean {
    const s = this.state.get(taskId);
    return s === ExecutorState.Failed || s === ExecutorState.Committing;
  }

  /**
   * Clean up state for a completed task.
   */
  reset(taskId: string): void {
    this.state.delete(taskId);
  }
}

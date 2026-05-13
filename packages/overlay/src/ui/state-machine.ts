/**
 * OverlayStateMachine — single FSM driving the overlay status line and
 * aria-live announcements.
 *
 * States:
 *   idle | listening | thinking | applying | awaiting-confirmation |
 *   quick-edit | multi-edit | gesture | error
 *
 * Components dispatch transitions via fsm.send({ type: 'voice_started' }).
 * The machine emits a 'state-changed' event with { prev, next, label }.
 * Invalid transitions are rejected (return false).
 */

import { strings } from './strings.js';

/** All FSM states. */
export type FsmState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'applying'
  | 'awaiting-confirmation'
  | 'quick-edit'
  | 'multi-edit'
  | 'gesture'
  | 'error';

/** All valid event types that can be dispatched to the FSM. */
export type FsmEventType =
  | 'voice_started'
  | 'voice_stopped'
  | 'thinking_started'
  | 'thinking_complete'
  | 'applying_started'
  | 'applying_complete'
  | 'awaiting_confirmation'
  | 'confirmed'
  | 'cancelled'
  | 'error_occurred'
  | 'error_acknowledged'
  | 'quick_edit_start'
  | 'quick_edit_end'
  | 'multi_edit_start'
  | 'multi_edit_end'
  | 'gesture_mode_start'
  | 'gesture_mode_end';

/** Payload emitted on every valid state change. */
export interface StateChangeEvent {
  prev: FsmState;
  next: FsmState;
  label: string;
}

/** Transition table: from-state → event-type → next-state. */
const TRANSITIONS: Record<FsmState, Partial<Record<FsmEventType, FsmState>>> = {
  idle: {
    voice_started: 'listening',
    thinking_started: 'thinking',
    quick_edit_start: 'quick-edit',
    multi_edit_start: 'multi-edit',
    gesture_mode_start: 'gesture',
    error_occurred: 'error',
  },

  listening: {
    voice_stopped: 'idle',
    thinking_started: 'thinking',
    error_occurred: 'error',
  },

  thinking: {
    thinking_complete: 'idle',
    applying_started: 'applying',
    awaiting_confirmation: 'awaiting-confirmation',
    error_occurred: 'error',
  },

  applying: {
    applying_complete: 'idle',
    error_occurred: 'error',
  },

  'awaiting-confirmation': {
    confirmed: 'thinking',
    cancelled: 'idle',
    error_occurred: 'error',
  },

  'quick-edit': {
    quick_edit_end: 'idle',
    error_occurred: 'error',
  },

  'multi-edit': {
    multi_edit_end: 'idle',
    error_occurred: 'error',
  },

  gesture: {
    gesture_mode_end: 'idle',
    error_occurred: 'error',
  },

  error: {
    error_acknowledged: 'idle',
  },
};

/** Map each state to its user-visible label from strings.ts. */
const STATE_LABELS: Record<FsmState, string> = {
  idle: strings.stateIdle,
  listening: strings.stateListening,
  thinking: strings.stateThinking,
  applying: strings.stateApplying,
  'awaiting-confirmation': strings.stateAwaitingConfirmation,
  'quick-edit': strings.stateQuickEdit,
  'multi-edit': strings.stateMultiEdit,
  gesture: strings.stateGesture,
  error: strings.stateError,
};

export type StateChangeListener = (event: StateChangeEvent) => void;

export class OverlayStateMachine {
  private _state: FsmState = 'idle';
  private _listeners: StateChangeListener[] = [];

  /** Return the current FSM state. */
  get state(): FsmState {
    return this._state;
  }

  /** Return the user-visible label for the current state. */
  get label(): string {
    return STATE_LABELS[this._state];
  }

  /**
   * Dispatch an event to the FSM.
   *
   * If the transition is valid for the current state, the state is updated,
   * all registered listeners are notified, and `true` is returned.
   *
   * If the transition is NOT valid, the state remains unchanged and `false`
   * is returned. No listener is notified for invalid transitions.
   */
  send(event: { type: FsmEventType }): boolean {
    const allowed = TRANSITIONS[this._state];
    const nextState = allowed?.[event.type];

    if (!nextState) {
      return false;
    }

    const prev = this._state;
    this._state = nextState;

    const changeEvent: StateChangeEvent = {
      prev,
      next: nextState,
      label: STATE_LABELS[nextState],
    };

    for (const listener of this._listeners) {
      try {
        listener(changeEvent);
      } catch {
        // Swallow listener errors — never let a listener crash the FSM.
      }
    }

    return true;
  }

  /**
   * Register a listener that will be called on every valid state change.
   * Returns an unsubscribe function.
   */
  onStateChange(listener: StateChangeListener): () => void {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Remove a previously registered listener.
   */
  offStateChange(listener: StateChangeListener): void {
    this._listeners = this._listeners.filter((l) => l !== listener);
  }

  /**
   * Reset the FSM back to the idle state without emitting a change event.
   * Useful for tests and edge-case recovery.
   */
  reset(): void {
    this._state = 'idle';
  }
}

// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OverlayStateMachine, type FsmEventType, type FsmState } from '../state-machine.js';

describe('OverlayStateMachine', () => {
  let fsm: OverlayStateMachine;

  beforeEach(() => {
    fsm = new OverlayStateMachine();
  });

  // ── Initial state ──────────────────────────────────────────

  it('starts in idle state', () => {
    expect(fsm.state).toBe('idle');
    expect(fsm.label).toBe('Idle');
  });

  // ── idle transitions ───────────────────────────────────────

  it('voice_started from idle → listening', () => {
    const result = fsm.send({ type: 'voice_started' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('listening');
    expect(fsm.label).toBe('Listening');
  });

  it('thinking_started from idle → thinking', () => {
    const result = fsm.send({ type: 'thinking_started' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('thinking');
    expect(fsm.label).toBe('Thinking');
  });

  it('quick_edit_start from idle → quick-edit', () => {
    const result = fsm.send({ type: 'quick_edit_start' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('quick-edit');
    expect(fsm.label).toBe('Quick Edit active');
  });

  it('multi_edit_start from idle → multi-edit', () => {
    const result = fsm.send({ type: 'multi_edit_start' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('multi-edit');
    expect(fsm.label).toBe('Multi-Edit active');
  });

  it('gesture_mode_start from idle → gesture', () => {
    const result = fsm.send({ type: 'gesture_mode_start' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('gesture');
    expect(fsm.label).toBe('Gesture mode');
  });

  it('awaiting_confirmation from idle → awaiting-confirmation', () => {
    const result = fsm.send({ type: 'awaiting_confirmation' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('awaiting-confirmation');
    expect(fsm.label).toBe('Awaiting confirmation');
  });

  it('error_occurred from idle → error', () => {
    const result = fsm.send({ type: 'error_occurred' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('error');
    expect(fsm.label).toBe('Error');
  });

  // ── listening transitions ──────────────────────────────────

  it('voice_stopped from listening → idle', () => {
    fsm.send({ type: 'voice_started' });
    const result = fsm.send({ type: 'voice_stopped' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('idle');
  });

  it('thinking_started from listening → thinking', () => {
    fsm.send({ type: 'voice_started' });
    const result = fsm.send({ type: 'thinking_started' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('thinking');
  });

  it('error_occurred from listening → error', () => {
    fsm.send({ type: 'voice_started' });
    const result = fsm.send({ type: 'error_occurred' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('error');
  });

  // ── thinking transitions ───────────────────────────────────

  it('applying_started from thinking → applying', () => {
    fsm.send({ type: 'thinking_started' });
    const result = fsm.send({ type: 'applying_started' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('applying');
    expect(fsm.label).toBe('Applying');
  });

  it('awaiting_confirmation from thinking → awaiting-confirmation', () => {
    fsm.send({ type: 'thinking_started' });
    const result = fsm.send({ type: 'awaiting_confirmation' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('awaiting-confirmation');
    expect(fsm.label).toBe('Awaiting confirmation');
  });

  it('thinking_complete from thinking → idle', () => {
    fsm.send({ type: 'thinking_started' });
    const result = fsm.send({ type: 'thinking_complete' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('idle');
  });

  it('error_occurred from thinking → error', () => {
    fsm.send({ type: 'thinking_started' });
    const result = fsm.send({ type: 'error_occurred' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('error');
  });

  // ── applying transitions ───────────────────────────────────

  it('applying_complete from applying → idle', () => {
    fsm.send({ type: 'thinking_started' });
    fsm.send({ type: 'applying_started' });
    const result = fsm.send({ type: 'applying_complete' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('idle');
  });

  it('error_occurred from applying → error', () => {
    fsm.send({ type: 'thinking_started' });
    fsm.send({ type: 'applying_started' });
    const result = fsm.send({ type: 'error_occurred' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('error');
  });

  // ── awaiting-confirmation transitions ──────────────────────

  it('confirmed from awaiting-confirmation → thinking', () => {
    fsm.send({ type: 'thinking_started' });
    fsm.send({ type: 'awaiting_confirmation' });
    const result = fsm.send({ type: 'confirmed' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('thinking');
  });

  it('cancelled from awaiting-confirmation → idle', () => {
    fsm.send({ type: 'thinking_started' });
    fsm.send({ type: 'awaiting_confirmation' });
    const result = fsm.send({ type: 'cancelled' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('idle');
  });

  it('thinking_started from awaiting-confirmation → thinking', () => {
    fsm.send({ type: 'thinking_started' });
    fsm.send({ type: 'awaiting_confirmation' });
    const result = fsm.send({ type: 'thinking_started' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('thinking');
  });

  // ── quick-edit transitions ─────────────────────────────────

  it('quick_edit_end from quick-edit → idle', () => {
    fsm.send({ type: 'quick_edit_start' });
    const result = fsm.send({ type: 'quick_edit_end' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('idle');
  });

  // ── multi-edit transitions ─────────────────────────────────

  it('multi_edit_end from multi-edit → idle', () => {
    fsm.send({ type: 'multi_edit_start' });
    const result = fsm.send({ type: 'multi_edit_end' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('idle');
  });

  // ── gesture transitions ────────────────────────────────────

  it('gesture_mode_end from gesture → idle', () => {
    fsm.send({ type: 'gesture_mode_start' });
    const result = fsm.send({ type: 'gesture_mode_end' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('idle');
  });

  // ── error transitions ──────────────────────────────────────

  it('error_acknowledged from error → idle', () => {
    fsm.send({ type: 'error_occurred' });
    const result = fsm.send({ type: 'error_acknowledged' });
    expect(result).toBe(true);
    expect(fsm.state).toBe('idle');
  });

  // ── Invalid transitions (rejected) ─────────────────────────

  it('rejects applying_started from idle (needs thinking first)', () => {
    const result = fsm.send({ type: 'applying_started' });
    expect(result).toBe(false);
    expect(fsm.state).toBe('idle');
  });

  it('rejects applying_complete from idle (no previous thinking)', () => {
    const result = fsm.send({ type: 'applying_complete' });
    expect(result).toBe(false);
    expect(fsm.state).toBe('idle');
  });

  it('rejects confirmed from idle (not awaiting confirmation)', () => {
    const result = fsm.send({ type: 'confirmed' });
    expect(result).toBe(false);
    expect(fsm.state).toBe('idle');
  });

  it('rejects thinking_complete from idle', () => {
    const result = fsm.send({ type: 'thinking_complete' });
    expect(result).toBe(false);
    expect(fsm.state).toBe('idle');
  });

  it('rejects voice_started from thinking', () => {
    fsm.send({ type: 'thinking_started' });
    const result = fsm.send({ type: 'voice_started' });
    expect(result).toBe(false);
    expect(fsm.state).toBe('thinking');
  });

  it('rejects quick_edit_end from idle', () => {
    const result = fsm.send({ type: 'quick_edit_end' });
    expect(result).toBe(false);
    expect(fsm.state).toBe('idle');
  });

  it('rejects multi_edit_end from idle', () => {
    const result = fsm.send({ type: 'multi_edit_end' });
    expect(result).toBe(false);
    expect(fsm.state).toBe('idle');
  });

  it('rejects gesture_mode_end from idle', () => {
    const result = fsm.send({ type: 'gesture_mode_end' });
    expect(result).toBe(false);
    expect(fsm.state).toBe('idle');
  });

  it('rejects error_acknowledged from idle (not in error state)', () => {
    const result = fsm.send({ type: 'error_acknowledged' });
    expect(result).toBe(false);
    expect(fsm.state).toBe('idle');
  });

  it('rejects quick_edit_start from listening (busy)', () => {
    fsm.send({ type: 'voice_started' });
    const result = fsm.send({ type: 'quick_edit_start' });
    expect(result).toBe(false);
    expect(fsm.state).toBe('listening');
  });

  it('rejects voice_started from quick-edit (busy)', () => {
    fsm.send({ type: 'quick_edit_start' });
    const result = fsm.send({ type: 'voice_started' });
    expect(result).toBe(false);
    expect(fsm.state).toBe('quick-edit');
  });

  // ── Event emission ─────────────────────────────────────────

  it('emits state-changed event with {prev, next, label} on valid transition', () => {
    const events: Array<{ prev: FsmState; next: FsmState; label: string }> = [];
    fsm.onStateChange((ev) => {
      events.push({ prev: ev.prev, next: ev.next, label: ev.label });
    });

    fsm.send({ type: 'voice_started' });

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      prev: 'idle',
      next: 'listening',
      label: 'Listening',
    });
  });

  it('does NOT emit on invalid transition', () => {
    const listener = vi.fn();
    fsm.onStateChange(listener);

    const result = fsm.send({ type: 'applying_started' });
    expect(result).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('emits for each valid step in a multi-step transition chain', () => {
    const events: Array<{ prev: FsmState; next: FsmState }> = [];
    fsm.onStateChange((ev) => events.push({ prev: ev.prev, next: ev.next }));

    // idle → listening → thinking → awaiting-confirmation → thinking → idle
    fsm.send({ type: 'voice_started' });
    fsm.send({ type: 'thinking_started' });
    fsm.send({ type: 'awaiting_confirmation' });
    fsm.send({ type: 'confirmed' });
    fsm.send({ type: 'thinking_complete' });

    expect(events).toHaveLength(5);
    expect(events).toEqual([
      { prev: 'idle', next: 'listening' },
      { prev: 'listening', next: 'thinking' },
      { prev: 'thinking', next: 'awaiting-confirmation' },
      { prev: 'awaiting-confirmation', next: 'thinking' },
      { prev: 'thinking', next: 'idle' },
    ]);
  });

  it('unsubscribe via returned function stops listener', () => {
    const listener = vi.fn();
    const unsub = fsm.onStateChange(listener);

    fsm.send({ type: 'voice_started' });
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    fsm.send({ type: 'voice_stopped' });
    expect(listener).toHaveBeenCalledTimes(1); // still 1, not 2
  });

  it('offStateChange removes listener', () => {
    const listener = vi.fn();
    fsm.onStateChange(listener);

    fsm.send({ type: 'voice_started' });
    expect(listener).toHaveBeenCalledTimes(1);

    fsm.offStateChange(listener);
    fsm.send({ type: 'voice_stopped' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('state label changes with each transition', () => {
    expect(fsm.label).toBe('Idle');

    fsm.send({ type: 'voice_started' });
    expect(fsm.label).toBe('Listening');

    fsm.send({ type: 'thinking_started' });
    expect(fsm.label).toBe('Thinking');

    fsm.send({ type: 'awaiting_confirmation' });
    expect(fsm.label).toBe('Awaiting confirmation');
  });

  it('reset() returns to idle without emitting event', () => {
    fsm.send({ type: 'voice_started' });
    expect(fsm.state).toBe('listening');

    const listener = vi.fn();
    fsm.onStateChange(listener);

    fsm.reset();
    expect(fsm.state).toBe('idle');
    expect(listener).not.toHaveBeenCalled();
  });

  it('all valid transitions map to the right labels', () => {
    const expectedLabels: Record<FsmState, string> = {
      idle: 'Idle',
      listening: 'Listening',
      thinking: 'Thinking',
      applying: 'Applying',
      'awaiting-confirmation': 'Awaiting confirmation',
      'quick-edit': 'Quick Edit active',
      'multi-edit': 'Multi-Edit active',
      gesture: 'Gesture mode',
      error: 'Error',
    };

    // Navigate through every state reachable from idle
    const allTransitions: Array<{ event: FsmEventType; expectedState: FsmState }> = [
      { event: 'voice_started', expectedState: 'listening' },
      { event: 'voice_stopped', expectedState: 'idle' },
      { event: 'awaiting_confirmation', expectedState: 'awaiting-confirmation' },
      { event: 'cancelled', expectedState: 'idle' },
      { event: 'thinking_started', expectedState: 'thinking' },
      { event: 'thinking_complete', expectedState: 'idle' },
      { event: 'thinking_started', expectedState: 'thinking' },
      { event: 'applying_started', expectedState: 'applying' },
      { event: 'applying_complete', expectedState: 'idle' },
      { event: 'thinking_started', expectedState: 'thinking' },
      { event: 'awaiting_confirmation', expectedState: 'awaiting-confirmation' },
      { event: 'cancelled', expectedState: 'idle' },
      { event: 'quick_edit_start', expectedState: 'quick-edit' },
      { event: 'quick_edit_end', expectedState: 'idle' },
      { event: 'multi_edit_start', expectedState: 'multi-edit' },
      { event: 'multi_edit_end', expectedState: 'idle' },
      { event: 'gesture_mode_start', expectedState: 'gesture' },
      { event: 'gesture_mode_end', expectedState: 'idle' },
      { event: 'error_occurred', expectedState: 'error' },
      { event: 'error_acknowledged', expectedState: 'idle' },
    ];

    for (const { event, expectedState } of allTransitions) {
      const result = fsm.send({ type: event });
      expect(result).toBe(true);
      expect(fsm.state).toBe(expectedState);
      expect(fsm.label).toBe(expectedLabels[expectedState]);
    }
  });
});

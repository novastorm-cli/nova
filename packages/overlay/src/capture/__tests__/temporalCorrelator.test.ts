// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TemporalCorrelator } from '../TemporalCorrelator.js';
import { GestureRecognizer } from '../GestureRecognizer.js';
import type { ICursorTracker, CursorPoint, IDomCapture } from '../../contracts/ICapture.js';

function createMockTracker(trail: CursorPoint[] = []): ICursorTracker {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    isTracking: vi.fn().mockReturnValue(true),
    getTrail: vi.fn().mockReturnValue(trail),
    getPointAtTime: vi.fn((ts: number) => {
      if (trail.length === 0) return null;
      let closest = trail[0]!;
      for (const p of trail) {
        if (Math.abs(p.timestamp - ts) < Math.abs(closest.timestamp - ts)) {
          closest = p;
        }
      }
      return closest;
    }),
    getElementAtTime: vi.fn().mockReturnValue(null),
    onDwell: vi.fn(),
    clear: vi.fn(),
  };
}

function createMockDomCapture(): IDomCapture {
  return {
    captureElement: vi.fn((el: HTMLElement) => {
      return `<${el.tagName.toLowerCase()}>${el.textContent ?? ''}</${el.tagName.toLowerCase()}>`;
    }),
  };
}

describe('TemporalCorrelator', () => {
  let tracker: ICursorTracker;
  let domCapture: IDomCapture;
  let gestureRecognizer: GestureRecognizer;
  let correlator: TemporalCorrelator;

  beforeEach(() => {
    document.body.innerHTML = '';
    const trail: CursorPoint[] = [
      { x: 100, y: 100, timestamp: 1000 },
      { x: 101, y: 101, timestamp: 1100 },
      { x: 102, y: 102, timestamp: 1200 },
    ];
    tracker = createMockTracker(trail);
    domCapture = createMockDomCapture();
    gestureRecognizer = new GestureRecognizer(tracker, domCapture);
    correlator = new TemporalCorrelator(tracker, gestureRecognizer, domCapture);
  });

  it('maps deictic word "this" to element under cursor at pronunciation time', () => {
    const targetEl = document.createElement('button');
    targetEl.textContent = 'Submit';
    document.body.appendChild(targetEl);

    // Return targetEl for any timestamp query
    (tracker.getElementAtTime as ReturnType<typeof vi.fn>).mockReturnValue(targetEl);

    correlator.addTranscript({
      text: 'change this',
      isFinal: true,
      timestamp: 1000,
    });

    const context = correlator.resolve();

    expect(context.gestures.length).toBeGreaterThan(0);
    const gestureWithElement = context.gestures.find((g) =>
      g.elements.some((e) => e.tagName === 'button'),
    );
    expect(gestureWithElement).toBeDefined();

    targetEl.remove();
  });

  it('returns empty context when no gestures and no deictic words', () => {
    correlator.addTranscript({
      text: 'hello world',
      isFinal: true,
      timestamp: 1000,
    });

    const context = correlator.resolve();

    expect(context.gestures).toHaveLength(0);
  });

  it('maps multiple deictic words correctly', () => {
    const el1 = document.createElement('div');
    el1.id = 'first';
    el1.textContent = 'First';
    document.body.appendChild(el1);

    const el2 = document.createElement('span');
    el2.id = 'second';
    el2.textContent = 'Second';
    document.body.appendChild(el2);

    // Return different elements for different timestamps
    (tracker.getElementAtTime as ReturnType<typeof vi.fn>).mockImplementation((ts: number) => {
      if (ts < 1200) return el1;
      return el2;
    });

    correlator.addTranscript({
      text: 'move this there',
      isFinal: true,
      timestamp: 1000,
    });

    const context = correlator.resolve();
    expect(context.gestures.length).toBeGreaterThanOrEqual(1);

    el1.remove();
    el2.remove();
  });

  it('summary does not exceed 800 chars', () => {
    const longEl = document.createElement('div');
    longEl.textContent = 'x'.repeat(500);
    document.body.appendChild(longEl);

    (tracker.getElementAtTime as ReturnType<typeof vi.fn>).mockReturnValue(longEl);

    // Add many transcripts with deictic words to generate long summary
    for (let i = 0; i < 20; i++) {
      correlator.addTranscript({
        text: `this is element number ${i} and also here and there`,
        isFinal: true,
        timestamp: 1000 + i * 100,
      });
    }

    const context = correlator.resolve();
    expect(context.summary.length).toBeLessThanOrEqual(800);

    longEl.remove();
  });

  it('clear() resets accumulated transcripts', () => {
    const el = document.createElement('div');
    el.textContent = 'Target';
    document.body.appendChild(el);

    (tracker.getElementAtTime as ReturnType<typeof vi.fn>).mockReturnValue(el);

    correlator.addTranscript({
      text: 'this element',
      isFinal: true,
      timestamp: 1000,
    });

    correlator.clear();

    // After clear, should have no deictic gestures (only recognizer gestures)
    const context = correlator.resolve();
    // The gesture recognizer may return some gestures but deictic references should be empty
    const deicticGestures = context.gestures.filter((g) =>
      g.elements.some((e) => e.tagName === 'div'),
    );
    // Since we cleared transcripts, no deictic resolution should happen
    // (GestureRecognizer may still have its own gestures)
    expect(deicticGestures).toHaveLength(0);

    el.remove();
  });
});

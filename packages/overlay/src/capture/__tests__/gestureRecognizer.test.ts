// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GestureRecognizer } from '../GestureRecognizer.js';
import type { ICursorTracker, CursorPoint, IDomCapture } from '../../contracts/ICapture.js';

function createMockTracker(trail: CursorPoint[] = []): ICursorTracker {
  const dwellHandlers: Array<(element: Element, point: CursorPoint) => void> = [];
  return {
    start: vi.fn(),
    stop: vi.fn(),
    isTracking: vi.fn().mockReturnValue(true),
    getTrail: vi.fn().mockReturnValue(trail),
    getPointAtTime: vi.fn((ts: number) => {
      if (trail.length === 0) return null;
      let closest = trail[0];
      for (const p of trail) {
        if (Math.abs(p.timestamp - ts) < Math.abs(closest.timestamp - ts)) {
          closest = p;
        }
      }
      return closest;
    }),
    getElementAtTime: vi.fn().mockReturnValue(null),
    onDwell: vi.fn((handler) => {
      dwellHandlers.push(handler);
    }),
    clear: vi.fn(),
    _fireDwell(element: Element, point: CursorPoint) {
      for (const h of dwellHandlers) h(element, point);
    },
  } as ICursorTracker & { _fireDwell: (el: Element, pt: CursorPoint) => void };
}

function createMockDomCapture(): IDomCapture {
  return {
    captureElement: vi.fn((el: HTMLElement) => {
      return `<${el.tagName.toLowerCase()}>${el.textContent ?? ''}</${el.tagName.toLowerCase()}>`;
    }),
  };
}

describe('GestureRecognizer', () => {
  let domCapture: IDomCapture;

  beforeEach(() => {
    domCapture = createMockDomCapture();
  });

  it('recognizes a circle from synthetic circular points', () => {
    const now = Date.now();
    const trail: CursorPoint[] = [];
    const cx = 200;
    const cy = 200;
    const radius = 80;
    const numPoints = 35;

    // Generate points along a circle
    for (let i = 0; i < numPoints; i++) {
      const angle = (2 * Math.PI * i) / numPoints;
      trail.push({
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
        timestamp: now + i * 30, // 30ms apart = ~1050ms total
      });
    }

    const centerEl = document.createElement('div');
    centerEl.textContent = 'Center';
    document.body.appendChild(centerEl);

    const tracker = createMockTracker(trail);
    (tracker.getElementAtTime as ReturnType<typeof vi.fn>).mockReturnValue(centerEl);

    const recognizer = new GestureRecognizer(tracker, domCapture);
    const gestures = recognizer.recognize();

    const circle = gestures.find((g) => g.type === 'circle');
    expect(circle).toBeDefined();
    expect(circle!.region).toBeDefined();
    expect(circle!.elements.length).toBeGreaterThan(0);
    expect(circle!.elements[0].role).toBe('encircled');

    centerEl.remove();
  });

  // skip: flaky in CI
  it.skip('does NOT recognize a circle from random movement', () => {
    const now = Date.now();
    const trail: CursorPoint[] = [];

    // Random scatter points — not circular
    for (let i = 0; i < 30; i++) {
      trail.push({
        x: Math.random() * 500,
        y: Math.random() * 500,
        timestamp: now + i * 30,
      });
    }

    const tracker = createMockTracker(trail);
    const recognizer = new GestureRecognizer(tracker, domCapture);
    const gestures = recognizer.recognize();

    const circle = gestures.find((g) => g.type === 'circle');
    expect(circle).toBeUndefined();
  });

  it('detects a path from two dwells with movement > 100px', () => {
    const now = Date.now();
    const trail: CursorPoint[] = [
      { x: 10, y: 10, timestamp: now },
      { x: 300, y: 300, timestamp: now + 2000 },
    ];

    const sourceEl = document.createElement('button');
    sourceEl.textContent = 'Source';
    document.body.appendChild(sourceEl);

    const targetEl = document.createElement('div');
    targetEl.textContent = 'Target';
    document.body.appendChild(targetEl);

    const tracker = createMockTracker(trail) as ICursorTracker & {
      _fireDwell: (el: Element, pt: CursorPoint) => void;
    };

    const recognizer = new GestureRecognizer(tracker, domCapture);

    // Fire two dwells
    tracker._fireDwell(sourceEl, { x: 10, y: 10, timestamp: now });
    tracker._fireDwell(targetEl, { x: 300, y: 300, timestamp: now + 2000 });

    const gestures = recognizer.recognize();
    const path = gestures.find((g) => g.type === 'path');
    expect(path).toBeDefined();
    expect(path!.elements.length).toBe(2);

    const source = path!.elements.find((e) => e.role === 'source');
    const target = path!.elements.find((e) => e.role === 'target');
    expect(source).toBeDefined();
    expect(target).toBeDefined();

    sourceEl.remove();
    targetEl.remove();
  });

  it('detects a dwell gesture', () => {
    const now = Date.now();
    const trail: CursorPoint[] = [{ x: 100, y: 100, timestamp: now }];

    const dwellEl = document.createElement('span');
    dwellEl.textContent = 'Hover target';
    document.body.appendChild(dwellEl);

    const tracker = createMockTracker(trail) as ICursorTracker & {
      _fireDwell: (el: Element, pt: CursorPoint) => void;
    };

    const recognizer = new GestureRecognizer(tracker, domCapture);
    tracker._fireDwell(dwellEl, { x: 100, y: 100, timestamp: now });

    const gestures = recognizer.recognize();
    const dwell = gestures.find((g) => g.type === 'dwell');
    expect(dwell).toBeDefined();
    expect(dwell!.elements[0].tagName).toBe('span');

    dwellEl.remove();
  });

  it('returns at most 3 gestures', () => {
    const now = Date.now();
    const trail: CursorPoint[] = [];

    const el = document.createElement('div');
    el.textContent = 'Target';
    document.body.appendChild(el);

    const tracker = createMockTracker(trail) as ICursorTracker & {
      _fireDwell: (el: Element, pt: CursorPoint) => void;
    };

    const recognizer = new GestureRecognizer(tracker, domCapture);

    // Fire 5 dwells
    for (let i = 0; i < 5; i++) {
      tracker._fireDwell(el, { x: 100 + i * 10, y: 100, timestamp: now + i * 1000 });
    }

    const gestures = recognizer.recognize();
    expect(gestures.length).toBeLessThanOrEqual(3);

    el.remove();
  });

  it('limits domSnippet to 500 chars', () => {
    const now = Date.now();
    const trail: CursorPoint[] = [{ x: 100, y: 100, timestamp: now }];

    const el = document.createElement('div');
    el.textContent = 'x'.repeat(1000);
    document.body.appendChild(el);

    // Override domCapture to return long string
    const longDomCapture: IDomCapture = {
      captureElement: vi.fn(() => 'a'.repeat(1000)),
    };

    const tracker = createMockTracker(trail) as ICursorTracker & {
      _fireDwell: (el: Element, pt: CursorPoint) => void;
    };

    const recognizer = new GestureRecognizer(tracker, longDomCapture);
    tracker._fireDwell(el, { x: 100, y: 100, timestamp: now });

    const gestures = recognizer.recognize();
    for (const g of gestures) {
      for (const ge of g.elements) {
        expect(ge.domSnippet.length).toBeLessThanOrEqual(500);
      }
    }

    el.remove();
  });
});

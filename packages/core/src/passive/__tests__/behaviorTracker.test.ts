import { describe, it, expect, beforeEach } from 'vitest';
import { BehaviorTracker } from '../BehaviorTracker.js';
import type { BehaviorEvent } from '../../models/types.js';

function createEvent(overrides: Partial<BehaviorEvent> = {}): BehaviorEvent {
  return {
    type: 'page_visit',
    url: 'http://localhost:3000/dashboard',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('BehaviorTracker', () => {
  let tracker: BehaviorTracker;

  beforeEach(() => {
    tracker = new BehaviorTracker();
  });

  it('should track events and return them', () => {
    const event = createEvent();
    tracker.track(event);
    expect(tracker.getEvents()).toEqual([event]);
    expect(tracker.size).toBe(1);
  });

  it('should enforce ring buffer limit of 1000', () => {
    for (let i = 0; i < 1050; i++) {
      tracker.track(createEvent({ timestamp: i }));
    }
    expect(tracker.size).toBe(1000);
    const events = tracker.getEvents();
    expect(events[0].timestamp).toBe(50);
    expect(events[999].timestamp).toBe(1049);
  });

  it('should filter events by since timestamp', () => {
    tracker.track(createEvent({ timestamp: 100 }));
    tracker.track(createEvent({ timestamp: 200 }));
    tracker.track(createEvent({ timestamp: 300 }));

    const filtered = tracker.getEvents(200);
    expect(filtered).toHaveLength(2);
    expect(filtered[0].timestamp).toBe(200);
    expect(filtered[1].timestamp).toBe(300);
  });

  it('should count page visits by URL', () => {
    tracker.track(createEvent({ url: '/a' }));
    tracker.track(createEvent({ url: '/a' }));
    tracker.track(createEvent({ url: '/b' }));
    tracker.track(createEvent({ type: 'click', url: '/a', target: '#btn' }));

    const counts = tracker.getPageVisitCounts();
    expect(counts.get('/a')).toBe(2);
    expect(counts.get('/b')).toBe(1);
    expect(counts.size).toBe(2);
  });

  it('should return frequent actions sorted by count', () => {
    tracker.track(createEvent({ type: 'click', url: '/page', target: '#btn1' }));
    tracker.track(createEvent({ type: 'click', url: '/page', target: '#btn1' }));
    tracker.track(createEvent({ type: 'click', url: '/page', target: '#btn1' }));
    tracker.track(createEvent({ type: 'click', url: '/page', target: '#btn2' }));

    const actions = tracker.getFrequentActions();
    expect(actions[0]).toEqual({ action: 'click:#btn1', count: 3 });
    expect(actions[1]).toEqual({ action: 'click:#btn2', count: 1 });
  });

  it('should not count page_visit events as actions', () => {
    tracker.track(createEvent({ type: 'page_visit', url: '/a' }));
    tracker.track(createEvent({ type: 'page_visit', url: '/a' }));

    const actions = tracker.getFrequentActions();
    expect(actions).toHaveLength(0);
  });

  it('should clear all events', () => {
    tracker.track(createEvent());
    tracker.track(createEvent());
    tracker.clear();
    expect(tracker.size).toBe(0);
    expect(tracker.getEvents()).toEqual([]);
  });
});

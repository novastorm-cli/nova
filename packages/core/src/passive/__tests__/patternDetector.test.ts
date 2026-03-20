import { describe, it, expect, beforeEach } from 'vitest';
import { PatternDetector } from '../PatternDetector.js';
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

describe('PatternDetector', () => {
  let detector: PatternDetector;
  let tracker: BehaviorTracker;

  beforeEach(() => {
    detector = new PatternDetector();
    tracker = new BehaviorTracker();
  });

  describe('frequent_page detection', () => {
    it('should detect pages visited >= 5 times in the last hour', () => {
      const now = Date.now();
      for (let i = 0; i < 6; i++) {
        tracker.track(createEvent({ url: '/dashboard', timestamp: now - i * 1000 }));
      }

      const patterns = detector.detect(tracker);
      const frequent = patterns.filter((p) => p.type === 'frequent_page');
      expect(frequent).toHaveLength(1);
      expect(frequent[0].occurrences).toBe(6);
      expect(frequent[0].metadata['url']).toBe('/dashboard');
    });

    it('should not detect pages visited < 5 times', () => {
      const now = Date.now();
      for (let i = 0; i < 4; i++) {
        tracker.track(createEvent({ url: '/settings', timestamp: now - i * 1000 }));
      }

      const patterns = detector.detect(tracker);
      const frequent = patterns.filter((p) => p.type === 'frequent_page');
      expect(frequent).toHaveLength(0);
    });

    it('should not count visits older than 1 hour', () => {
      const now = Date.now();
      const oneHourAgo = now - 61 * 60 * 1000;
      for (let i = 0; i < 6; i++) {
        tracker.track(createEvent({ url: '/old', timestamp: oneHourAgo - i * 1000 }));
      }

      const patterns = detector.detect(tracker);
      const frequent = patterns.filter((p) => p.type === 'frequent_page');
      expect(frequent).toHaveLength(0);
    });
  });

  describe('repeated_action detection', () => {
    it('should detect same action repeated >= 3 times in 10 minutes', () => {
      const now = Date.now();
      for (let i = 0; i < 4; i++) {
        tracker.track(createEvent({
          type: 'click',
          url: '/page',
          target: '#sort-btn',
          timestamp: now - i * 1000,
        }));
      }

      const patterns = detector.detect(tracker);
      const repeated = patterns.filter((p) => p.type === 'repeated_action');
      expect(repeated).toHaveLength(1);
      expect(repeated[0].occurrences).toBe(4);
    });

    it('should not detect actions repeated < 3 times', () => {
      const now = Date.now();
      for (let i = 0; i < 2; i++) {
        tracker.track(createEvent({
          type: 'filter',
          url: '/page',
          target: '#filter-btn',
          timestamp: now - i * 1000,
        }));
      }

      const patterns = detector.detect(tracker);
      const repeated = patterns.filter((p) => p.type === 'repeated_action');
      expect(repeated).toHaveLength(0);
    });
  });

  describe('slow_api detection', () => {
    it('should detect API calls consistently > 2s', () => {
      const now = Date.now();
      tracker.track(createEvent({ type: 'api_call', url: '/api/users', duration: 3000, timestamp: now }));
      tracker.track(createEvent({ type: 'api_call', url: '/api/users', duration: 2500, timestamp: now - 1000 }));

      const patterns = detector.detect(tracker);
      const slow = patterns.filter((p) => p.type === 'slow_api');
      expect(slow).toHaveLength(1);
      expect(slow[0].metadata['endpoint']).toBe('/api/users');
    });

    it('should not detect fast API calls', () => {
      const now = Date.now();
      tracker.track(createEvent({ type: 'api_call', url: '/api/fast', duration: 100, timestamp: now }));
      tracker.track(createEvent({ type: 'api_call', url: '/api/fast', duration: 200, timestamp: now - 1000 }));

      const patterns = detector.detect(tracker);
      const slow = patterns.filter((p) => p.type === 'slow_api');
      expect(slow).toHaveLength(0);
    });

    it('should require at least 2 slow calls', () => {
      const now = Date.now();
      tracker.track(createEvent({ type: 'api_call', url: '/api/once', duration: 5000, timestamp: now }));

      const patterns = detector.detect(tracker);
      const slow = patterns.filter((p) => p.type === 'slow_api');
      expect(slow).toHaveLength(0);
    });
  });

  describe('recurring_error detection', () => {
    it('should detect errors recurring >= 3 times', () => {
      const now = Date.now();
      for (let i = 0; i < 4; i++) {
        tracker.track(createEvent({
          type: 'error',
          url: '/page',
          target: 'TypeError: Cannot read property',
          timestamp: now - i * 1000,
        }));
      }

      const patterns = detector.detect(tracker);
      const recurring = patterns.filter((p) => p.type === 'recurring_error');
      expect(recurring).toHaveLength(1);
      expect(recurring[0].occurrences).toBe(4);
    });

    it('should not detect errors occurring < 3 times', () => {
      const now = Date.now();
      for (let i = 0; i < 2; i++) {
        tracker.track(createEvent({
          type: 'error',
          url: '/page',
          target: 'RangeError: stack overflow',
          timestamp: now - i * 1000,
        }));
      }

      const patterns = detector.detect(tracker);
      const recurring = patterns.filter((p) => p.type === 'recurring_error');
      expect(recurring).toHaveLength(0);
    });
  });

  it('should return empty array when no events tracked', () => {
    const patterns = detector.detect(tracker);
    expect(patterns).toEqual([]);
  });
});

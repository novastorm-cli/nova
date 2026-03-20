import type { BehaviorPattern } from '../models/types.js';
import { randomUUID } from 'node:crypto';
import type { BehaviorTracker } from './BehaviorTracker.js';

const FREQUENT_PAGE_THRESHOLD = 5;
const FREQUENT_PAGE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const REPEATED_ACTION_THRESHOLD = 3;
const REPEATED_ACTION_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

const SLOW_API_THRESHOLD_MS = 2000;
const SLOW_API_MIN_OCCURRENCES = 2;

const RECURRING_ERROR_THRESHOLD = 3;

export class PatternDetector {
  detect(tracker: BehaviorTracker): BehaviorPattern[] {
    const patterns: BehaviorPattern[] = [];
    const now = Date.now();

    patterns.push(...this.detectFrequentPages(tracker, now));
    patterns.push(...this.detectRepeatedActions(tracker, now));
    patterns.push(...this.detectSlowApis(tracker));
    patterns.push(...this.detectRecurringErrors(tracker));

    return patterns;
  }

  private detectFrequentPages(tracker: BehaviorTracker, now: number): BehaviorPattern[] {
    const recentEvents = tracker.getEvents(now - FREQUENT_PAGE_WINDOW_MS);
    const pageCounts = new Map<string, { count: number; firstSeen: number; lastSeen: number }>();

    for (const event of recentEvents) {
      if (event.type === 'page_visit') {
        const existing = pageCounts.get(event.url);
        if (existing) {
          existing.count++;
          existing.lastSeen = Math.max(existing.lastSeen, event.timestamp);
          existing.firstSeen = Math.min(existing.firstSeen, event.timestamp);
        } else {
          pageCounts.set(event.url, {
            count: 1,
            firstSeen: event.timestamp,
            lastSeen: event.timestamp,
          });
        }
      }
    }

    const patterns: BehaviorPattern[] = [];
    for (const [url, data] of pageCounts) {
      if (data.count >= FREQUENT_PAGE_THRESHOLD) {
        patterns.push({
          id: randomUUID(),
          type: 'frequent_page',
          description: `Page "${url}" visited ${data.count} times in the last hour`,
          confidence: Math.min(data.count / 10, 1),
          occurrences: data.count,
          firstSeen: data.firstSeen,
          lastSeen: data.lastSeen,
          metadata: { url },
        });
      }
    }

    return patterns;
  }

  private detectRepeatedActions(tracker: BehaviorTracker, now: number): BehaviorPattern[] {
    const recentEvents = tracker.getEvents(now - REPEATED_ACTION_WINDOW_MS);
    const actionCounts = new Map<string, { count: number; firstSeen: number; lastSeen: number; target: string }>();

    for (const event of recentEvents) {
      if (event.type === 'click' || event.type === 'sort' || event.type === 'filter') {
        const key = `${event.type}:${event.target ?? ''}`;
        const existing = actionCounts.get(key);
        if (existing) {
          existing.count++;
          existing.lastSeen = Math.max(existing.lastSeen, event.timestamp);
          existing.firstSeen = Math.min(existing.firstSeen, event.timestamp);
        } else {
          actionCounts.set(key, {
            count: 1,
            firstSeen: event.timestamp,
            lastSeen: event.timestamp,
            target: event.target ?? event.url,
          });
        }
      }
    }

    const patterns: BehaviorPattern[] = [];
    for (const [key, data] of actionCounts) {
      if (data.count >= REPEATED_ACTION_THRESHOLD) {
        const [actionType] = key.split(':');
        patterns.push({
          id: randomUUID(),
          type: 'repeated_action',
          description: `Action "${actionType}" on "${data.target}" repeated ${data.count} times in 10 minutes`,
          confidence: Math.min(data.count / 6, 1),
          occurrences: data.count,
          firstSeen: data.firstSeen,
          lastSeen: data.lastSeen,
          metadata: { action: actionType, target: data.target },
        });
      }
    }

    return patterns;
  }

  private detectSlowApis(tracker: BehaviorTracker): BehaviorPattern[] {
    const apiEvents = tracker.getEvents().filter((e) => e.type === 'api_call');
    const endpointDurations = new Map<string, { durations: number[]; firstSeen: number; lastSeen: number }>();

    for (const event of apiEvents) {
      if (event.duration !== undefined) {
        const endpoint = event.url;
        const existing = endpointDurations.get(endpoint);
        if (existing) {
          existing.durations.push(event.duration);
          existing.lastSeen = Math.max(existing.lastSeen, event.timestamp);
          existing.firstSeen = Math.min(existing.firstSeen, event.timestamp);
        } else {
          endpointDurations.set(endpoint, {
            durations: [event.duration],
            firstSeen: event.timestamp,
            lastSeen: event.timestamp,
          });
        }
      }
    }

    const patterns: BehaviorPattern[] = [];
    for (const [endpoint, data] of endpointDurations) {
      const slowCalls = data.durations.filter((d) => d > SLOW_API_THRESHOLD_MS);
      if (slowCalls.length >= SLOW_API_MIN_OCCURRENCES) {
        const avgDuration = Math.round(slowCalls.reduce((a, b) => a + b, 0) / slowCalls.length);
        patterns.push({
          id: randomUUID(),
          type: 'slow_api',
          description: `API "${endpoint}" averaging ${avgDuration}ms (${slowCalls.length} slow calls)`,
          confidence: Math.min(slowCalls.length / data.durations.length, 1),
          occurrences: slowCalls.length,
          firstSeen: data.firstSeen,
          lastSeen: data.lastSeen,
          metadata: { endpoint, avgDuration: String(avgDuration) },
        });
      }
    }

    return patterns;
  }

  private detectRecurringErrors(tracker: BehaviorTracker): BehaviorPattern[] {
    const errorEvents = tracker.getEvents().filter((e) => e.type === 'error');
    const errorCounts = new Map<string, { count: number; firstSeen: number; lastSeen: number; message: string }>();

    for (const event of errorEvents) {
      const message = event.metadata?.['message'] ?? event.target ?? 'Unknown error';
      const existing = errorCounts.get(message);
      if (existing) {
        existing.count++;
        existing.lastSeen = Math.max(existing.lastSeen, event.timestamp);
        existing.firstSeen = Math.min(existing.firstSeen, event.timestamp);
      } else {
        errorCounts.set(message, {
          count: 1,
          firstSeen: event.timestamp,
          lastSeen: event.timestamp,
          message,
        });
      }
    }

    const patterns: BehaviorPattern[] = [];
    for (const [, data] of errorCounts) {
      if (data.count >= RECURRING_ERROR_THRESHOLD) {
        patterns.push({
          id: randomUUID(),
          type: 'recurring_error',
          description: `Error "${data.message}" occurred ${data.count} times`,
          confidence: Math.min(data.count / 5, 1),
          occurrences: data.count,
          firstSeen: data.firstSeen,
          lastSeen: data.lastSeen,
          metadata: { message: data.message },
        });
      }
    }

    return patterns;
  }
}

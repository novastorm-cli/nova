import type { BehaviorEvent } from '../models/types.js';

const MAX_BUFFER_SIZE = 1000;

export class BehaviorTracker {
  private buffer: BehaviorEvent[] = [];

  track(event: BehaviorEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.buffer.shift();
    }
  }

  getEvents(since?: number): BehaviorEvent[] {
    if (since === undefined) {
      return [...this.buffer];
    }
    return this.buffer.filter((e) => e.timestamp >= since);
  }

  getPageVisitCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const event of this.buffer) {
      if (event.type === 'page_visit') {
        counts.set(event.url, (counts.get(event.url) ?? 0) + 1);
      }
    }
    return counts;
  }

  getFrequentActions(): Array<{ action: string; count: number }> {
    const actionCounts = new Map<string, number>();
    for (const event of this.buffer) {
      if (event.type !== 'page_visit') {
        const key = `${event.type}:${event.target ?? event.url}`;
        actionCounts.set(key, (actionCounts.get(key) ?? 0) + 1);
      }
    }

    return Array.from(actionCounts.entries())
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count);
  }

  get size(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
  }
}

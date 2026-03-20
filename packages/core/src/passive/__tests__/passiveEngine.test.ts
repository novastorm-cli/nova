import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassiveEngine } from '../PassiveEngine.js';
import type { EventBus, NovaEvent, NovaEventType } from '../../models/events.js';

function createMockEventBus(): EventBus & {
  handlers: Map<string, Set<(event: NovaEvent) => void>>;
  emitted: NovaEvent[];
} {
  const handlers = new Map<string, Set<(event: NovaEvent) => void>>();
  const emitted: NovaEvent[] = [];

  return {
    handlers,
    emitted,
    emit(event: NovaEvent): void {
      emitted.push(event);
      const set = handlers.get(event.type);
      if (set) {
        for (const handler of set) {
          handler(event);
        }
      }
    },
    on<T extends NovaEventType>(type: T, handler: (event: Extract<NovaEvent, { type: T }>) => void): void {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler as (event: NovaEvent) => void);
    },
    off<T extends NovaEventType>(type: T, handler: (event: Extract<NovaEvent, { type: T }>) => void): void {
      handlers.get(type)?.delete(handler as (event: NovaEvent) => void);
    },
  };
}

describe('PassiveEngine', () => {
  let tmpDir: string;
  let bus: ReturnType<typeof createMockEventBus>;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'nova-passive-engine-'));
    bus = createMockEventBus();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('should subscribe to passive_behavior events on start', () => {
    const engine = new PassiveEngine(bus, tmpDir, { enabled: true, analyzeIntervalMs: 60_000 });
    engine.start();

    expect(bus.handlers.get('passive_behavior')?.size).toBe(1);

    engine.stop();
  });

  it('should not subscribe when disabled', () => {
    const engine = new PassiveEngine(bus, tmpDir, { enabled: false, analyzeIntervalMs: 60_000 });
    engine.start();

    expect(bus.handlers.get('passive_behavior')?.size ?? 0).toBe(0);

    engine.stop();
  });

  it('should track behavior events from EventBus', () => {
    const engine = new PassiveEngine(bus, tmpDir, { enabled: true, analyzeIntervalMs: 60_000 });
    engine.start();

    bus.emit({
      type: 'passive_behavior',
      data: { type: 'page_visit', url: '/test', timestamp: Date.now() },
    });

    expect(engine.getTracker().size).toBe(1);

    engine.stop();
  });

  it('should run analysis and emit patterns/suggestions', async () => {
    vi.useRealTimers();

    const engine = new PassiveEngine(bus, tmpDir, { enabled: true, analyzeIntervalMs: 60_000 });
    engine.start();

    const now = Date.now();
    // Add enough events to trigger frequent_page pattern
    for (let i = 0; i < 6; i++) {
      bus.emit({
        type: 'passive_behavior',
        data: { type: 'page_visit', url: '/hot-page', timestamp: now + i },
      });
    }

    // Clear emitted events from behavior tracking
    bus.emitted.length = 0;

    // Directly call analyze instead of relying on interval with fake timers
    await engine.analyze();

    const patternEvents = bus.emitted.filter((e) => e.type === 'passive_pattern');
    const suggestionEvents = bus.emitted.filter((e) => e.type === 'passive_suggestion');

    expect(patternEvents.length).toBeGreaterThan(0);
    expect(suggestionEvents.length).toBeGreaterThan(0);

    engine.stop();
  });

  it('should unsubscribe and clear interval on stop', () => {
    const engine = new PassiveEngine(bus, tmpDir, { enabled: true, analyzeIntervalMs: 60_000 });
    engine.start();

    expect(bus.handlers.get('passive_behavior')?.size).toBe(1);
    expect(bus.handlers.get('suggestion_response')?.size).toBe(1);

    engine.stop();

    expect(bus.handlers.get('passive_behavior')?.size).toBe(0);
    expect(bus.handlers.get('suggestion_response')?.size).toBe(0);
  });

  it('should handle suggestion_response events', () => {
    const engine = new PassiveEngine(bus, tmpDir, { enabled: true, analyzeIntervalMs: 60_000 });
    engine.start();

    // Should not throw
    bus.emit({
      type: 'suggestion_response',
      data: { suggestionId: 'test-id', approved: true },
    });

    engine.stop();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { NovaEventBus } from '../EventBus.js';
import type { NovaEvent } from '../../models/events.js';

describe('NovaEventBus', () => {
  it('should emit and receive events', () => {
    const bus = new NovaEventBus();
    const handler = vi.fn();

    bus.on('status', handler);
    bus.emit({ type: 'status', data: { message: 'hello' } });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ type: 'status', data: { message: 'hello' } });
  });

  it('should handle typed events correctly', () => {
    const bus = new NovaEventBus();
    const statusHandler = vi.fn();
    const taskHandler = vi.fn();

    bus.on('status', statusHandler);
    bus.on('task_started', taskHandler);

    bus.emit({ type: 'status', data: { message: 'indexing' } });
    bus.emit({ type: 'task_started', data: { taskId: 'task-1' } });

    expect(statusHandler).toHaveBeenCalledOnce();
    expect(statusHandler).toHaveBeenCalledWith({
      type: 'status',
      data: { message: 'indexing' },
    });

    expect(taskHandler).toHaveBeenCalledOnce();
    expect(taskHandler).toHaveBeenCalledWith({
      type: 'task_started',
      data: { taskId: 'task-1' },
    });
  });

  it('should support multiple listeners for the same event type', () => {
    const bus = new NovaEventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on('status', handler1);
    bus.on('status', handler2);

    bus.emit({ type: 'status', data: { message: 'test' } });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it('should unsubscribe with off()', () => {
    const bus = new NovaEventBus();
    const handler = vi.fn();

    bus.on('status', handler);
    bus.emit({ type: 'status', data: { message: 'first' } });
    expect(handler).toHaveBeenCalledOnce();

    bus.off('status', handler);
    bus.emit({ type: 'status', data: { message: 'second' } });
    expect(handler).toHaveBeenCalledOnce(); // still 1, not 2
  });

  it('should not call handlers for other event types', () => {
    const bus = new NovaEventBus();
    const handler = vi.fn();

    bus.on('task_failed', handler);
    bus.emit({ type: 'status', data: { message: 'test' } });

    expect(handler).not.toHaveBeenCalled();
  });

  it('should handle task_completed event with full data', () => {
    const bus = new NovaEventBus();
    const handler = vi.fn();

    bus.on('task_completed', handler);

    const event: NovaEvent = {
      type: 'task_completed',
      data: { taskId: 'task-42', diff: '--- a\n+++ b', commitHash: 'abc1234' },
    };
    bus.emit(event);

    expect(handler).toHaveBeenCalledWith(event);
  });
});

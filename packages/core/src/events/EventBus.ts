import { EventEmitter } from 'node:events';
import type { EventBus, NovaEvent, NovaEventType } from '../models/events.js';

export class NovaEventBus implements EventBus {
  private emitter = new EventEmitter();

  emit(event: NovaEvent): void {
    this.emitter.emit(event.type, event);
  }

  on<T extends NovaEventType>(
    type: T,
    handler: (event: Extract<NovaEvent, { type: T }>) => void,
  ): void {
    this.emitter.on(type, handler as (...args: unknown[]) => void);
  }

  off<T extends NovaEventType>(
    type: T,
    handler: (event: Extract<NovaEvent, { type: T }>) => void,
  ): void {
    this.emitter.off(type, handler as (...args: unknown[]) => void);
  }
}

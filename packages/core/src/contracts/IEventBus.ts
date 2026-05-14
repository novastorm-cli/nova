import type { NovaEvent, NovaEventType } from '../models/events.js';

/**
 * Canonical interface for event buses.
 *
 * Consumers emit typed events and subscribe to specific event types.
 */
export interface EventBus {
  emit(event: NovaEvent): void;
  on<T extends NovaEventType>(
    type: T,
    handler: (event: Extract<NovaEvent, { type: T }>) => void,
  ): void;
  off<T extends NovaEventType>(
    type: T,
    handler: (event: Extract<NovaEvent, { type: T }>) => void,
  ): void;
}

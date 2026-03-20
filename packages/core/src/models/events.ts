import type { Observation, TaskItem } from './types.js';

export type NovaEvent =
  | { type: 'observation'; data: Observation }
  | { type: 'task_created'; data: TaskItem }
  | { type: 'task_started'; data: { taskId: string } }
  | { type: 'task_completed'; data: { taskId: string; diff: string; commitHash: string } }
  | { type: 'task_failed'; data: { taskId: string; error: string } }
  | { type: 'file_changed'; data: { filePath: string; source: 'user' | 'nova' } }
  | { type: 'index_updated'; data: { filesChanged: string[] } }
  | { type: 'status'; data: { message: string; tasks?: Array<{ id: string; description: string; lane: number }> } }
  | { type: 'confirm'; data: Record<string, never> }
  | { type: 'cancel'; data: Record<string, never> }
  | { type: 'llm_chunk'; data: { text: string; phase: 'reasoning' | 'code'; taskId?: string } }
  | { type: 'secrets_required'; data: { envVars: string[]; taskId: string } };

export type NovaEventType = NovaEvent['type'];

export interface EventBus {
  emit(event: NovaEvent): void;
  on<T extends NovaEventType>(type: T, handler: (event: Extract<NovaEvent, { type: T }>) => void): void;
  off<T extends NovaEventType>(type: T, handler: (event: Extract<NovaEvent, { type: T }>) => void): void;
}

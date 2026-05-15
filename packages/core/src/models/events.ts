import type {
  Observation,
  TaskItem,
  BehaviorEvent,
  BehaviorPattern,
  PassiveSuggestion,
} from './types.js';

export type NovaEvent =
  | { type: 'observation'; data: Observation }
  | { type: 'task_created'; data: TaskItem }
  | { type: 'task_started'; data: { taskId: string } }
  | { type: 'task_completed'; data: { taskId: string; diff: string; commitHash: string } }
  | { type: 'task_failed'; data: { taskId: string; error: string } }
  | { type: 'file_changed'; data: { filePath: string; source: 'user' | 'nova' } }
  | { type: 'index_updated'; data: { filesChanged: string[] } }
  | {
      type: 'status';
      data: { message: string; tasks?: Array<{ id: string; description: string; lane: number }> };
    }
  | { type: 'confirm'; data: Record<string, never> }
  | { type: 'cancel'; data: Record<string, never> }
  | { type: 'llm_chunk'; data: { text: string; phase: 'reasoning' | 'code'; taskId?: string } }
  | { type: 'secrets_required'; data: { envVars: string[]; taskId: string } }
  | { type: 'analysis_complete'; data: { fileCount: number; methodCount: number } }
  | { type: 'passive_behavior'; data: BehaviorEvent }
  | { type: 'passive_pattern'; data: BehaviorPattern }
  | { type: 'passive_suggestion'; data: PassiveSuggestion }
  | { type: 'suggestion_response'; data: { suggestionId: string; approved: boolean } }
  | { type: 'background_queued'; data: { taskId: string; position: number } }
  | { type: 'background_started'; data: { taskId: string; branch: string } }
  | { type: 'background_progress'; data: { taskId: string; progress: string } }
  | {
      type: 'background_completed';
      data: { taskId: string; branch: string; commitHash: string; diff: string };
    }
  | { type: 'background_failed'; data: { taskId: string; error: string } }
  | {
      type: 'pending_tasks';
      data: {
        tasks: Array<{ id: string; description: string; lane: number; preConfirmed?: boolean }>;
        message: string;
      };
    }
  | { type: 'confirm_tasks'; data: { taskIds: string[] } }
  | { type: 'fsm_transition'; task_id: string; prev: string; next: string; ts: number }
  | { type: 'provider_retry'; data: { attempt: number; waitMs: number; reason: string } }
  | {
      type: 'provider_fallback';
      data: { fromModel: string; toModel: string; reason: string };
    };

export type NovaEventType = NovaEvent['type'];

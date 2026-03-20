import { z } from 'zod';
import type { NovaEvent } from './events.js';

// Observation schema — loose validation since it comes from internal pipeline
const ObservationDataSchema = z.object({
  screenshot: z.any(), // Buffer at runtime
  clickCoords: z.object({ x: z.number(), y: z.number() }).optional(),
  domSnapshot: z.string().optional(),
  transcript: z.string().optional(),
  currentUrl: z.string(),
  consoleErrors: z.array(z.string()).optional(),
  timestamp: z.number(),
  gestureContext: z.object({
    gestures: z.array(z.object({
      type: z.string(),
      startTime: z.number(),
      endTime: z.number(),
      elements: z.array(z.object({
        tagName: z.string(),
        selector: z.string(),
        domSnippet: z.string(),
        role: z.string(),
      })),
      region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
    })),
    summary: z.string(),
  }).optional(),
});

const TaskItemDataSchema = z.object({
  id: z.string(),
  description: z.string(),
  files: z.array(z.string()),
  type: z.enum(['css', 'single_file', 'multi_file', 'refactor']),
  lane: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  status: z.enum(['pending', 'running', 'done', 'failed', 'rolled_back']),
  commitHash: z.string().optional(),
  diff: z.string().optional(),
  error: z.string().optional(),
});

export const NovaEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('observation'), data: ObservationDataSchema }),
  z.object({ type: z.literal('task_created'), data: TaskItemDataSchema }),
  z.object({ type: z.literal('task_started'), data: z.object({ taskId: z.string() }) }),
  z.object({ type: z.literal('task_completed'), data: z.object({ taskId: z.string(), diff: z.string(), commitHash: z.string() }) }),
  z.object({ type: z.literal('task_failed'), data: z.object({ taskId: z.string(), error: z.string() }) }),
  z.object({ type: z.literal('file_changed'), data: z.object({ filePath: z.string(), source: z.enum(['user', 'nova']) }) }),
  z.object({ type: z.literal('index_updated'), data: z.object({ filesChanged: z.array(z.string()) }) }),
  z.object({ type: z.literal('status'), data: z.object({ message: z.string(), tasks: z.array(z.object({ id: z.string(), description: z.string(), lane: z.number() })).optional() }) }),
  z.object({ type: z.literal('confirm'), data: z.object({}) }),
  z.object({ type: z.literal('cancel'), data: z.object({}) }),
  z.object({ type: z.literal('llm_chunk'), data: z.object({ text: z.string(), phase: z.enum(['reasoning', 'code']), taskId: z.string().optional() }) }),
  z.object({ type: z.literal('secrets_required'), data: z.object({ envVars: z.array(z.string()), taskId: z.string() }) }),
  z.object({ type: z.literal('analysis_complete'), data: z.object({ fileCount: z.number(), methodCount: z.number() }) }),
]);

export function parseNovaEvent(raw: unknown): NovaEvent {
  return NovaEventSchema.parse(raw) as NovaEvent;
}

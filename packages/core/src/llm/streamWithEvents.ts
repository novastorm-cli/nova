import type { LlmClient, LlmOptions, Message } from '../models/types.js';
import type { EventBus } from '../models/events.js';

/**
 * Calls llmClient.stream() and emits llm_chunk events as text arrives.
 * Returns the full accumulated response.
 */
export async function streamWithEvents(
  llmClient: LlmClient,
  messages: Message[],
  options: LlmOptions | undefined,
  eventBus: EventBus | undefined,
  taskId?: string,
): Promise<string> {
  const chunks: string[] = [];
  let inCodeBlock = false;

  for await (const chunk of llmClient.stream(messages, options)) {
    chunks.push(chunk);

    // Detect phase: before first === FILE: is reasoning, after is code
    if (chunk.includes('=== FILE:')) inCodeBlock = true;
    const phase = inCodeBlock ? 'code' : 'reasoning';

    eventBus?.emit({
      type: 'llm_chunk',
      data: { text: chunk, phase, taskId },
    });
  }

  return chunks.join('');
}

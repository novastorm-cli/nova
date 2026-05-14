import type { LlmClient } from '../contracts/ILlmClient.js';
import type { LlmOptions, Message } from '../models/types.js';
import type { EventBus } from '../contracts/IEventBus.js';

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

  for await (const streamChunk of llmClient.stream(messages, options)) {
    const text = streamChunk.content;
    chunks.push(text);

    // Detect phase: before first === FILE: is reasoning, after is code
    if (text.includes('=== FILE:')) inCodeBlock = true;
    const phase = inCodeBlock ? 'code' : 'reasoning';

    eventBus?.emit({
      type: 'llm_chunk',
      data: { text, phase, taskId },
    });
  }

  return chunks.join('');
}

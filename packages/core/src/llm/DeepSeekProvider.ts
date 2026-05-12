import { OpenAIProvider } from './OpenAIProvider.js';
import { ProviderError } from '../contracts/ILlmClient.js';
import type { LlmOptions, Message } from '../models/types.js';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-v4-pro';
const ALLOWED_MODELS = new Set(['deepseek-v4-pro', 'deepseek-v4-flash']);

export class DeepSeekProvider extends OpenAIProvider {
  constructor(apiKey: string, model: string = DEFAULT_MODEL) {
    if (!ALLOWED_MODELS.has(model)) {
      throw new ProviderError(
        `Unsupported DeepSeek model: "${model}". Allowed models: ${[...ALLOWED_MODELS].join(', ')}`,
        undefined,
        'deepseek',
      );
    }
    super(apiKey, DEEPSEEK_BASE_URL, 'deepseek', model);
  }

  async chat(messages: Message[], options?: LlmOptions): Promise<string> {
    // Validate model if overridden in options
    if (options?.model && !ALLOWED_MODELS.has(options.model)) {
      throw new ProviderError(
        `Unsupported DeepSeek model: "${options.model}". Allowed models: ${[...ALLOWED_MODELS].join(', ')}`,
        undefined,
        'deepseek',
      );
    }
    return super.chat(messages, options);
  }

  /* eslint-disable @typescript-eslint/no-unused-vars */
  chatWithVision(
    _messages: Message[],
    _images: Buffer[],
    _options?: LlmOptions,
  ): Promise<string> {
    /* eslint-enable @typescript-eslint/no-unused-vars */
    throw new ProviderError(
      'DeepSeek does not support vision. Use a vision-capable provider for visual mode.',
      undefined,
      'deepseek',
    );
  }

  async *stream(messages: Message[], options?: LlmOptions): AsyncIterable<string> {
    // Validate model if overridden in options
    if (options?.model && !ALLOWED_MODELS.has(options.model)) {
      throw new ProviderError(
        `Unsupported DeepSeek model: "${options.model}". Allowed models: ${[...ALLOWED_MODELS].join(', ')}`,
        undefined,
        'deepseek',
      );
    }
    yield* super.stream(messages, options);
  }
}

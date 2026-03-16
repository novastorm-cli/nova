import type { LlmClient } from '../models/types.js';
import type { IProviderFactory } from '../contracts/ILlmClient.js';
import { ProviderError } from '../contracts/ILlmClient.js';
import { AnthropicProvider } from './AnthropicProvider.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { OpenRouterProvider } from './OpenRouterProvider.js';
import { OllamaProvider } from './OllamaProvider.js';

const SUPPORTED_PROVIDERS = ['anthropic', 'openrouter', 'openai', 'ollama'] as const;

export class ProviderFactory implements IProviderFactory {
  create(provider: string, apiKey?: string): LlmClient {
    if (!SUPPORTED_PROVIDERS.includes(provider as typeof SUPPORTED_PROVIDERS[number])) {
      throw new ProviderError(
        `Unknown provider: "${provider}". Supported: ${SUPPORTED_PROVIDERS.join(', ')}`,
        undefined,
        provider,
      );
    }

    if (provider !== 'ollama' && !apiKey) {
      throw new ProviderError(
        `API key is required for provider "${provider}"`,
        undefined,
        provider,
      );
    }

    switch (provider) {
      case 'anthropic':
        return new AnthropicProvider(apiKey!);
      case 'openai':
        return new OpenAIProvider(apiKey!);
      case 'openrouter':
        return new OpenRouterProvider(apiKey!);
      case 'ollama':
        return new OllamaProvider();
      default:
        throw new ProviderError(`Unknown provider: "${provider}"`, undefined, provider);
    }
  }
}

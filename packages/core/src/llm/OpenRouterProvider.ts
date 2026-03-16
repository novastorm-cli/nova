import { OpenAIProvider } from './OpenAIProvider.js';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4';

export class OpenRouterProvider extends OpenAIProvider {
  constructor(apiKey: string) {
    super(apiKey, OPENROUTER_BASE_URL, 'openrouter', DEFAULT_MODEL);
  }
}

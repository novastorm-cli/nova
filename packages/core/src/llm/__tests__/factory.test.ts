import { describe, it, expect, vi } from 'vitest';
import { ProviderError } from '../../contracts/ILlmClient.js';

// Mock both SDKs so constructors don't fail
vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    constructor(_opts: Record<string, unknown>) {}
  }
  return { default: Anthropic };
});

vi.mock('openai', () => {
  class OpenAI {
    chat = { completions: { create: vi.fn() } };
    constructor(_opts: Record<string, unknown>) {}
  }
  return { default: OpenAI };
});

const { ProviderFactory } = await import('../ProviderFactory.js');
const { AnthropicProvider } = await import('../AnthropicProvider.js');
const { OpenAIProvider } = await import('../OpenAIProvider.js');
const { OpenRouterProvider } = await import('../OpenRouterProvider.js');
const { OllamaProvider } = await import('../OllamaProvider.js');

describe('ProviderFactory', () => {
  const factory = new ProviderFactory();

  it('create("anthropic", key) returns AnthropicProvider instance', () => {
    const client = factory.create('anthropic', 'sk-ant-test-key');
    expect(client).toBeInstanceOf(AnthropicProvider);
  });

  it('create("openrouter", key) returns OpenRouterProvider instance', () => {
    const client = factory.create('openrouter', 'sk-or-test-key');
    expect(client).toBeInstanceOf(OpenRouterProvider);
  });

  it('create("openai", key) returns OpenAIProvider instance', () => {
    const client = factory.create('openai', 'sk-test-key');
    expect(client).toBeInstanceOf(OpenAIProvider);
  });

  it('create("ollama") returns OllamaProvider (no key needed)', () => {
    const client = factory.create('ollama');
    expect(client).toBeInstanceOf(OllamaProvider);
  });

  it('create("unknown") throws ProviderError', () => {
    expect(() => factory.create('unknown', 'key')).toThrow(ProviderError);
  });

  it('create("anthropic") without key throws ProviderError', () => {
    expect(() => factory.create('anthropic')).toThrow(ProviderError);
  });

  it('create("openrouter") without key throws ProviderError', () => {
    expect(() => factory.create('openrouter')).toThrow(ProviderError);
  });

  it('create("openai") without key throws ProviderError', () => {
    expect(() => factory.create('openai')).toThrow(ProviderError);
  });
});

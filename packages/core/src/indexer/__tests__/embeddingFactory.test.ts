import { describe, it, expect } from 'vitest';
import { createEmbeddingService } from '../EmbeddingService.js';
import { OllamaEmbedding } from '../OllamaEmbedding.js';
import { TfIdfEmbedding } from '../TfIdfEmbedding.js';

describe('createEmbeddingService', () => {
  it('creates TF-IDF provider', () => {
    const service = createEmbeddingService({ provider: 'tfidf' });
    expect(service).toBeInstanceOf(TfIdfEmbedding);
  });

  it('creates Ollama provider', () => {
    const service = createEmbeddingService({ provider: 'ollama' });
    expect(service).toBeInstanceOf(OllamaEmbedding);
  });

  it('throws for unknown provider', () => {
    expect(() => createEmbeddingService({ provider: 'unknown' as any })).toThrow(
      'Unknown embedding provider',
    );
  });

  it('creates OpenAI provider with key', () => {
    const service = createEmbeddingService({ provider: 'openai', apiKey: 'test-key' });
    expect(service).toBeDefined();
  });
});

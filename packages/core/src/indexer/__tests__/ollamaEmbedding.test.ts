import { describe, it, expect, vi, afterEach } from 'vitest';
import { OllamaEmbedding } from '../OllamaEmbedding.js';

describe('OllamaEmbedding', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls Ollama API and returns embedding', async () => {
    const mockEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ embedding: mockEmbedding }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const service = new OllamaEmbedding('http://localhost:11434', 'nomic-embed-text');
    const result = await service.embedSingle('test query');

    expect(result).toEqual(mockEmbedding);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/embeddings',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ model: 'nomic-embed-text', prompt: 'test query' }),
      }),
    );
  });

  it('embed() processes multiple texts sequentially', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      return new Response(JSON.stringify({ embedding: [callCount * 0.1, callCount * 0.2] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const service = new OllamaEmbedding();
    const results = await service.embed(['text1', 'text2', 'text3']);

    expect(results).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('retries on failure', async () => {
    let attempt = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      attempt++;
      if (attempt < 3) {
        throw new Error('Connection refused');
      }
      return new Response(JSON.stringify({ embedding: [0.5] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const service = new OllamaEmbedding();
    const result = await service.embedSingle('test');

    expect(result).toEqual([0.5]);
    expect(attempt).toBe(3);
  });

  it('throws after max retries', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Connection refused'));

    const service = new OllamaEmbedding();
    await expect(service.embedSingle('test')).rejects.toThrow('Connection refused');
  });

  it('uses default model and base URL', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ embedding: [0.1] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const service = new OllamaEmbedding();
    await service.embedSingle('test');

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/embeddings',
      expect.objectContaining({
        body: JSON.stringify({ model: 'nomic-embed-text', prompt: 'test' }),
      }),
    );
  });
});

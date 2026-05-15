import type { IEmbeddingService } from '../contracts/IStorage.js';
import { OllamaEmbedding } from './OllamaEmbedding.js';
import { TfIdfEmbedding } from './TfIdfEmbedding.js';

// ── Provider types ──────────────────────────────────────────────────────

export type EmbeddingProvider = 'openai' | 'ollama' | 'tfidf';

export interface EmbeddingServiceOptions {
  provider: EmbeddingProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

// ── Factory ─────────────────────────────────────────────────────────────

export function createEmbeddingService(options: EmbeddingServiceOptions): IEmbeddingService {
  switch (options.provider) {
    case 'openai':
      return new OpenAIEmbedding(options.apiKey!, options.model);
    case 'ollama':
      return new OllamaEmbedding(options.baseUrl, options.model);
    case 'tfidf':
      return new TfIdfEmbedding();
    default:
      throw new Error(`Unknown embedding provider: ${String(options.provider)}`);
  }
}

// ── Backward-compatible wrapper ─────────────────────────────────────────

/**
 * Backward-compatible class that delegates to OpenAIEmbedding.
 * Existing code using `new EmbeddingService(apiKey)` continues to work.
 */
export class EmbeddingService implements IEmbeddingService {
  private delegate: IEmbeddingService;

  constructor(apiKey: string) {
    this.delegate = new OpenAIEmbedding(apiKey);
  }

  embed(texts: string[]): Promise<number[][]> {
    return this.delegate.embed(texts);
  }

  embedSingle(text: string): Promise<number[]> {
    return this.delegate.embedSingle(text);
  }
}

// ── OpenAI provider ─────────────────────────────────────────────────────

const BATCH_SIZE = 2048;
const MAX_RETRIES = 3;

class OpenAIEmbedding implements IEmbeddingService {
  private client: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  private initPromise: Promise<void>;
  private model: string;

  constructor(
    private readonly apiKey: string,
    model?: string,
  ) {
    this.model = model ?? 'text-embedding-3-small';
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    const { default: OpenAI } = await import('openai');
    this.client = new OpenAI({ apiKey: this.apiKey });
  }

  async embed(texts: string[]): Promise<number[][]> {
    await this.initPromise;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const embeddings = await this.callWithRetry(batch);
      results.push(...embeddings);
    }

    return results;
  }

  async embedSingle(text: string): Promise<number[]> {
    const results = await this.embed([text]);
    if (!results[0]) {
      throw new Error('Embedding returned empty result');
    }
    return results[0];
  }

  private async callWithRetry(texts: string[]): Promise<number[][]> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.embeddings.create({
          model: this.model,
          input: texts,
        });
        return response.data
          .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
          .map((d: { embedding: number[] }) => d.embedding);
      } catch (err: unknown) {
        const status = (err as { status?: number })?.status;
        if (status === 429 && attempt < MAX_RETRIES - 1) {
          // Rate limited -- wait and retry
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
    throw new Error('Embedding failed after max retries');
  }
}

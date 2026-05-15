import { join } from 'node:path';
import type { IEmbeddingService, IVectorStore } from '../contracts/IStorage.js';
import type { EmbeddingRecord, ProjectMap } from '../models/types.js';
import { CodeChunker, type CodeChunk } from './CodeChunker.js';
import { MethodExtractor } from './MethodExtractor.js';

const EMBEDDINGS_FILE = 'embeddings.json';

export class RagIndexer {
  private readonly chunker = new CodeChunker();
  private readonly methodExtractor = new MethodExtractor();

  constructor(
    private readonly embeddingService: IEmbeddingService,
    private readonly vectorStore: IVectorStore,
  ) {}

  async index(projectPath: string, projectMap: ProjectMap): Promise<void> {
    const embeddingsPath = join(projectPath, '.nova', EMBEDDINGS_FILE);
    await this.vectorStore.load(embeddingsPath);

    const allChunks: CodeChunk[] = [];

    for (const [filePath, ctx] of projectMap.fileContexts) {
      const methods = this.methodExtractor.extract(ctx.content, filePath);
      const chunks = this.chunker.chunkFile(ctx.content, filePath, methods);
      allChunks.push(...chunks);
    }

    // Batch embed all chunks
    const texts = allChunks.map((c) => c.text);
    if (texts.length === 0) return;

    const embeddings = await this.embeddingService.embed(texts);

    // Clear and rebuild
    for (const [filePath] of projectMap.fileContexts) {
      this.vectorStore.remove(filePath);
    }

    for (let i = 0; i < allChunks.length; i++) {
      const chunk = allChunks[i]!;
      const record: EmbeddingRecord = {
        id: `${chunk.filePath}:${chunk.lineStart}-${chunk.lineEnd}`,
        filePath: chunk.filePath,
        chunkText: chunk.text,
        embedding: embeddings[i]!,
        metadata: {
          type: chunk.type,
          name: chunk.name,
          lineStart: chunk.lineStart,
          lineEnd: chunk.lineEnd,
        },
      };
      this.vectorStore.upsert(record);
    }

    await this.vectorStore.save(embeddingsPath);
  }

  async updateFiles(
    changedFiles: string[],
    projectMap: ProjectMap,
    projectPath: string,
  ): Promise<void> {
    const embeddingsPath = join(projectPath, '.nova', EMBEDDINGS_FILE);
    await this.vectorStore.load(embeddingsPath);

    const allChunks: CodeChunk[] = [];

    for (const filePath of changedFiles) {
      // Remove old embeddings for this file
      this.vectorStore.remove(filePath);

      const ctx = projectMap.fileContexts.get(filePath);
      if (!ctx) continue;

      const methods = this.methodExtractor.extract(ctx.content, filePath);
      const chunks = this.chunker.chunkFile(ctx.content, filePath, methods);
      allChunks.push(...chunks);
    }

    if (allChunks.length === 0) {
      await this.vectorStore.save(embeddingsPath);
      return;
    }

    const texts = allChunks.map((c) => c.text);
    const embeddings = await this.embeddingService.embed(texts);

    for (let i = 0; i < allChunks.length; i++) {
      const chunk = allChunks[i]!;
      const record: EmbeddingRecord = {
        id: `${chunk.filePath}:${chunk.lineStart}-${chunk.lineEnd}`,
        filePath: chunk.filePath,
        chunkText: chunk.text,
        embedding: embeddings[i]!,
        metadata: {
          type: chunk.type,
          name: chunk.name,
          lineStart: chunk.lineStart,
          lineEnd: chunk.lineEnd,
        },
      };
      this.vectorStore.upsert(record);
    }

    await this.vectorStore.save(embeddingsPath);
  }

  async searchCode(
    query: string,
    limit: number = 5,
  ): Promise<Array<{ filePath: string; chunkText: string; score: number }>> {
    const queryEmbedding = await this.embeddingService.embedSingle(query);
    const results = this.vectorStore.search(queryEmbedding, limit);
    return results.map((r) => ({
      filePath: r.record.filePath,
      chunkText: r.record.chunkText,
      score: r.score,
    }));
  }
}

import { readFile, writeFile } from 'node:fs/promises';
import type { IVectorStore } from '../contracts/IStorage.js';
import type { EmbeddingRecord } from '../models/types.js';

export class VectorStore implements IVectorStore {
  private records: EmbeddingRecord[] = [];

  async load(filePath: string): Promise<void> {
    try {
      const raw = await readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.records = parsed;
      }
    } catch {
      this.records = [];
    }
  }

  async save(filePath: string): Promise<void> {
    await writeFile(filePath, JSON.stringify(this.records), 'utf-8');
  }

  upsert(record: EmbeddingRecord): void {
    const idx = this.records.findIndex((r) => r.id === record.id);
    if (idx >= 0) {
      this.records[idx] = record;
    } else {
      this.records.push(record);
    }
  }

  remove(filePath: string): void {
    this.records = this.records.filter((r) => r.filePath !== filePath);
  }

  search(
    queryEmbedding: number[],
    limit: number,
  ): Array<{ record: EmbeddingRecord; score: number }> {
    if (this.records.length === 0) return [];

    const scored = this.records.map((record) => ({
      record,
      score: this.cosineSimilarity(queryEmbedding, record.embedding),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  getRecordCount(): number {
    return this.records.length;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 0;

    return dot / denom;
  }
}

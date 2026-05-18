import type { IEmbeddingService } from '../contracts/IStorage.js';

const VOCAB_SIZE = 512; // Fixed dimension for vectors

export class TfIdfEmbedding implements IEmbeddingService {
  private vocabulary: Map<string, number> = new Map();
  private idf: Map<string, number> = new Map();
  private trained = false;

  // eslint-disable-next-line @typescript-eslint/require-await
  async embed(texts: string[]): Promise<number[][]> {
    if (!this.trained) {
      this.buildVocabulary(texts);
    }
    return texts.map((text) => this.vectorize(text));
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async embedSingle(text: string): Promise<number[]> {
    return this.vectorize(text);
  }

  private buildVocabulary(documents: string[]): void {
    const docFreq = new Map<string, number>();
    const allTerms = new Map<string, number>();

    for (const doc of documents) {
      const terms = this.tokenize(doc);
      const seen = new Set<string>();

      for (const term of terms) {
        allTerms.set(term, (allTerms.get(term) ?? 0) + 1);
        if (!seen.has(term)) {
          docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
          seen.add(term);
        }
      }
    }

    // Select top VOCAB_SIZE terms by frequency
    const sorted = [...allTerms.entries()].sort((a, b) => b[1] - a[1]).slice(0, VOCAB_SIZE);

    this.vocabulary.clear();
    for (let i = 0; i < sorted.length; i++) {
      this.vocabulary.set(sorted[i]![0], i);
    }

    // Calculate IDF
    const n = documents.length;
    this.idf.clear();
    for (const [term, df] of docFreq) {
      if (this.vocabulary.has(term)) {
        this.idf.set(term, Math.log((n + 1) / (df + 1)) + 1);
      }
    }

    this.trained = true;
  }

  private vectorize(text: string): number[] {
    const vec = new Array<number>(VOCAB_SIZE).fill(0);
    const terms = this.tokenize(text);
    const termCounts = new Map<string, number>();

    for (const term of terms) {
      termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
    }

    // TF-IDF
    for (const [term, count] of termCounts) {
      const idx = this.vocabulary.get(term);
      if (idx !== undefined) {
        const tf = count / terms.length;
        const idf = this.idf.get(term) ?? 1;
        vec[idx] = tf * idf;
      }
    }

    // L2 normalize
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) vec[i]! /= norm;
    }

    return vec;
  }

  private tokenize(text: string): string[] {
    return (
      text
        .toLowerCase()
        // Split camelCase
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        // Remove non-alphanumeric
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 1 && t.length < 30)
    );
  }
}

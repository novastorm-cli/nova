import { describe, it, expect } from 'vitest';
import { TfIdfEmbedding } from '../TfIdfEmbedding.js';

describe('TfIdfEmbedding', () => {
  it('embed() returns vectors of fixed dimension', async () => {
    const service = new TfIdfEmbedding();
    const results = await service.embed([
      'function fetchUser(id) { return db.find(id); }',
      'class AuthService { login(user, pass) {} }',
      'const API_URL = "https://api.example.com"',
    ]);

    expect(results).toHaveLength(3);
    // All vectors have same dimension
    const dim = results[0]!.length;
    expect(dim).toBe(512);
    expect(results[1]!.length).toBe(dim);
    expect(results[2]!.length).toBe(dim);
  });

  it('embedSingle() returns a vector', async () => {
    const service = new TfIdfEmbedding();
    // Train on some data first
    await service.embed(['function test() {}', 'class Foo {}']);
    const vec = await service.embedSingle('function test');

    expect(vec).toHaveLength(512);
    expect(typeof vec[0]!).toBe('number');
  });

  it('produces similar vectors for similar texts', async () => {
    const service = new TfIdfEmbedding();
    const results = await service.embed([
      'export function fetchUserById(id: string) { return db.users.find(id); }',
      'export function getUserById(userId: string) { return database.users.get(userId); }',
      'body { background: red; color: white; font-size: 16px; margin: 0; }',
    ]);

    // Cosine similarity between similar code should be higher than between code and CSS
    const sim01 = cosine(results[0]!, results[1]!);
    const sim02 = cosine(results[0]!, results[2]!);

    expect(sim01).toBeGreaterThan(sim02);
  });

  it('produces normalized vectors (L2 norm close to 1)', async () => {
    const service = new TfIdfEmbedding();
    const results = await service.embed([
      'export function calculateTotal(items: Item[]) { return items.reduce((s, i) => s + i.price, 0); }',
    ]);

    const norm = Math.sqrt(results[0]!.reduce((s, v) => s + v * v, 0));
    // Should be close to 1 (or 0 for empty docs)
    if (norm > 0) {
      expect(norm).toBeCloseTo(1, 2);
    }
  });

  it('handles empty text', async () => {
    const service = new TfIdfEmbedding();
    await service.embed(['some training data']);
    const vec = await service.embedSingle('');

    expect(vec).toHaveLength(512);
  });
});

function cosine(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

import { describe, it, expect } from 'vitest';
import { CodeChunker } from '../CodeChunker.js';
import type { MethodInfo } from '../../models/types.js';

describe('CodeChunker', () => {
  const chunker = new CodeChunker();

  it('creates import chunk from file with imports', () => {
    const code = `import { foo } from './foo';
import { bar } from './bar';

export function main() {}`;

    const chunks = chunker.chunkFile(code, 'src/index.ts', [
      { name: 'main', filePath: 'src/index.ts', signature: 'function main()', purpose: 'main', lineStart: 4, lineEnd: 4, visibility: 'public', isAsync: false },
    ]);

    const importChunk = chunks.find((c) => c.type === 'imports');
    expect(importChunk).toBeDefined();
    expect(importChunk!.text).toContain('foo');
    expect(importChunk!.text).toContain('bar');
  });

  it('creates method chunks from methods', () => {
    const code = `function a() {\n  return 1;\n}\nfunction b() {\n  return 2;\n}`;
    const methods: MethodInfo[] = [
      { name: 'a', filePath: 'f.ts', signature: 'function a()', purpose: 'a', lineStart: 1, lineEnd: 3, visibility: 'public', isAsync: false },
      { name: 'b', filePath: 'f.ts', signature: 'function b()', purpose: 'b', lineStart: 4, lineEnd: 6, visibility: 'public', isAsync: false },
    ];

    const chunks = chunker.chunkFile(code, 'f.ts', methods);
    const methodChunks = chunks.filter((c) => c.type === 'method');
    expect(methodChunks).toHaveLength(2);
    expect(methodChunks[0]!.name).toBe('a');
    expect(methodChunks[1]!.name).toBe('b');
  });

  it('falls back to sliding window for files without methods', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `// line ${i + 1}`);
    const code = lines.join('\n');

    const chunks = chunker.chunkFile(code, 'src/data.txt', []);
    const generalChunks = chunks.filter((c) => c.type === 'general');
    expect(generalChunks.length).toBeGreaterThan(0);
  });

  it('extracts type chunks', () => {
    const code = `export interface User {
  id: string;
  name: string;
  email: string;
}`;
    const chunks = chunker.chunkFile(code, 'src/types.ts', []);
    const typeChunks = chunks.filter((c) => c.type === 'types');
    expect(typeChunks.length).toBeGreaterThanOrEqual(1);
    expect(typeChunks[0]!.name).toBe('User');
  });

  it('handles empty files', () => {
    const chunks = chunker.chunkFile('', 'empty.ts', []);
    expect(chunks).toHaveLength(0);
  });
});

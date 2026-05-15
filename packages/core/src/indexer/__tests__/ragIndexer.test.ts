import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { RagIndexer } from '../RagIndexer.js';
import { VectorStore } from '../../storage/VectorStore.js';
import type { IEmbeddingService } from '../../contracts/IStorage.js';
import type { ProjectMap, MiniContext, DependencyNode } from '../../models/types.js';

function mockEmbeddingService(): IEmbeddingService {
  return {
    embed: vi.fn(async (texts: string[]) => {
      // Return deterministic fake embeddings based on text length
      return texts.map((t) => {
        const len = t.length;
        return [len / 1000, (len % 100) / 100, Math.sin(len)];
      });
    }),
    embedSingle: vi.fn(async (text: string) => {
      const len = text.length;
      return [len / 1000, (len % 100) / 100, Math.sin(len)];
    }),
  };
}

function makeProjectMap(files: Record<string, string>): ProjectMap {
  const fileContexts = new Map<string, MiniContext>();
  const dependencies = new Map<string, DependencyNode>();

  for (const [filePath, content] of Object.entries(files)) {
    fileContexts.set(filePath, { filePath, content, importedTypes: '' });
    dependencies.set(filePath, {
      filePath,
      imports: [],
      exports: [],
      type: 'util',
      keywords: [],
    });
  }

  return {
    stack: { framework: 'test', language: 'typescript', typescript: true },
    devCommand: 'npm run dev',
    port: 3000,
    routes: [],
    components: [],
    endpoints: [],
    models: [],
    dependencies,
    fileContexts,
    compressedContext: '',
  };
}

describe('RagIndexer', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('indexes project files and stores embeddings', async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ragindexer-test-'));
    await fsp.mkdir(path.join(tmpDir, '.nova'), { recursive: true });

    const embeddingService = mockEmbeddingService();
    const vectorStore = new VectorStore();
    const ragIndexer = new RagIndexer(embeddingService, vectorStore);

    const projectMap = makeProjectMap({
      'src/auth.ts': `export function login(user: string, pass: string) {\n  return authenticate(user, pass);\n}`,
      'src/utils.ts': `export function formatDate(d: Date): string {\n  return d.toISOString();\n}`,
    });

    await ragIndexer.index(tmpDir, projectMap);

    expect(vectorStore.getRecordCount()).toBeGreaterThan(0);
    expect(embeddingService.embed).toHaveBeenCalled();
  });

  it('searchCode returns relevant results', async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ragindexer-test-'));
    await fsp.mkdir(path.join(tmpDir, '.nova'), { recursive: true });

    const embeddingService = mockEmbeddingService();
    const vectorStore = new VectorStore();
    const ragIndexer = new RagIndexer(embeddingService, vectorStore);

    const projectMap = makeProjectMap({
      'src/auth.ts': `export function login(user: string) {\n  return true;\n}`,
    });

    await ragIndexer.index(tmpDir, projectMap);

    const results = await ragIndexer.searchCode('login', 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!).toHaveProperty('filePath');
    expect(results[0]!).toHaveProperty('chunkText');
    expect(results[0]!).toHaveProperty('score');
  });

  it('updateFiles re-embeds only changed files', async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ragindexer-test-'));
    await fsp.mkdir(path.join(tmpDir, '.nova'), { recursive: true });

    const embeddingService = mockEmbeddingService();
    const vectorStore = new VectorStore();
    const ragIndexer = new RagIndexer(embeddingService, vectorStore);

    const projectMap = makeProjectMap({
      'src/a.ts': `export function a() { return 1; }`,
      'src/b.ts': `export function b() { return 2; }`,
    });

    await ragIndexer.index(tmpDir, projectMap);

    // Update only one file
    (embeddingService.embed as ReturnType<typeof vi.fn>).mockClear();
    await ragIndexer.updateFiles(['src/a.ts'], projectMap, tmpDir);
    expect(embeddingService.embed).toHaveBeenCalledTimes(1);
  });
});

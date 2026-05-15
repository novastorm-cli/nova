import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdtemp, cp, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProjectIndexer } from '../ProjectIndexer.js';
import { NoopLogger } from '../../logging/NoopLogger.js';

const fixturesDir = path.resolve(__dirname, '../../../../../tests/fixtures');

describe('ProjectIndexer', () => {
  const indexer = new ProjectIndexer(new NoopLogger());
  let tmpDir: string;

  /** Copy fixture to a temp dir so parallel tests don't conflict on .nova/ */
  async function copyFixture(name: string): Promise<string> {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), `nova-indexer-test-${name}-`));
    const src = path.join(fixturesDir, name);
    await cp(src, tmpDir, { recursive: true });
    return tmpDir;
  }

  beforeEach(async () => {
    tmpDir = '';
  });

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ── index() ───────────────────────────────────────────────────

  describe('index()', () => {
    it('should return a ProjectMap with stack, routes, components, and endpoints for nextjs-app', async () => {
      const projectPath = await copyFixture('nextjs-app');

      const map = await indexer.index(projectPath);

      // Stack
      expect(map.stack).toBeDefined();
      expect(map.stack.framework).toBe('next.js');
      expect(map.stack.typescript).toBe(true);

      // Routes
      expect(map.routes).toBeDefined();
      expect(Array.isArray(map.routes)).toBe(true);
      expect(map.routes.length).toBeGreaterThan(0);
      // Should have the root page route
      expect(map.routes.some((r) => r.path === '/' && r.type === 'page')).toBe(true);

      // Components
      expect(map.components).toBeDefined();
      expect(Array.isArray(map.components)).toBe(true);
      expect(map.components.length).toBeGreaterThan(0);

      // Endpoints
      expect(map.endpoints).toBeDefined();
      expect(Array.isArray(map.endpoints)).toBe(true);
      expect(map.endpoints.length).toBeGreaterThan(0);
      // Should have the /api/users endpoint
      expect(map.endpoints.some((e) => e.path === '/api/users')).toBe(true);
    });

    it('should save graph.json in the .nova/ directory', async () => {
      const projectPath = await copyFixture('nextjs-app');

      await indexer.index(projectPath);

      const graphPath = path.join(projectPath, '.nova', 'graph.json');
      expect(existsSync(graphPath)).toBe(true);

      const graphContent = readFileSync(graphPath, 'utf-8');
      const parsed: unknown = JSON.parse(graphContent);
      expect(Array.isArray(parsed)).toBe(true);
      expect((parsed as unknown[]).length).toBeGreaterThan(0);
    });

    it('should return a non-empty compressedContext string', async () => {
      const projectPath = await copyFixture('nextjs-app');

      const map = await indexer.index(projectPath);

      expect(map.compressedContext).toBeDefined();
      expect(typeof map.compressedContext).toBe('string');
      expect(map.compressedContext.length).toBeGreaterThan(0);
    });

    // ── new: hash cache ───────────────────────────────────────────

    it('should save index-hash.json after indexing', async () => {
      const projectPath = await copyFixture('nextjs-app');

      await indexer.index(projectPath);

      const hashPath = path.join(projectPath, '.nova', 'index-hash.json');
      expect(existsSync(hashPath)).toBe(true);

      const content = JSON.parse(readFileSync(hashPath, 'utf-8'));
      expect(content.hash).toBeDefined();
      expect(typeof content.hash).toBe('string');
      expect(content.hash.length).toBe(64); // SHA256 hex
      expect(content.fileCount).toBeGreaterThan(0);
      expect(content.timestamp).toBeGreaterThan(0);
    });

    it('should skip content reads on warm start (hash cache hit)', async () => {
      const projectPath = await copyFixture('nextjs-app');

      // First run — cold, reads files
      const freshIndexer = new ProjectIndexer(new NoopLogger());
      const map1 = await freshIndexer.index(projectPath);
      const firstHash = JSON.parse(
        readFileSync(path.join(projectPath, '.nova', 'index-hash.json'), 'utf-8'),
      ).hash;

      // Second run — warm, should hit hash cache
      const warmIndexer = new ProjectIndexer(new NoopLogger());
      const start = Date.now();
      const map2 = await warmIndexer.index(projectPath);
      const elapsed = Date.now() - start;

      // Both maps should have the same structure
      expect(map2.stack.framework).toBe(map1.stack.framework);
      expect(map2.routes.length).toBeGreaterThan(0);
      expect(map2.components.length).toBeGreaterThan(0);

      // The hash should be the same
      const secondHash = JSON.parse(
        readFileSync(path.join(projectPath, '.nova', 'index-hash.json'), 'utf-8'),
      ).hash;
      expect(secondHash).toBe(firstHash);

      // Warm start should be fast (under 500ms for this small fixture)
      // Note: extractors still run, so some time is expected
      expect(elapsed).toBeLessThan(3000); // generous bound for CI
    });

    it('should re-read content when hash changes (cold start)', async () => {
      const projectPath = await copyFixture('nextjs-app');

      // First run
      const indexer1 = new ProjectIndexer(new NoopLogger());
      await indexer1.index(projectPath);

      // Modify a file to change the hash
      const pageFile = path.join(projectPath, 'app', 'page.tsx');
      const originalContent = readFileSync(pageFile, 'utf-8');
      await writeFile(pageFile, originalContent + '\n// modified\n', 'utf-8');

      // Second run — should detect hash change and re-read
      const indexer2 = new ProjectIndexer(new NoopLogger());
      const map2 = await indexer2.index(projectPath);

      // The modified file should appear in dependencies
      expect(map2.dependencies.has('app/page.tsx')).toBe(true);

      // Restore
      await writeFile(pageFile, originalContent, 'utf-8');
    });
  });

  // ── gitignore respect ─────────────────────────────────────────

  describe('gitignore', () => {
    it('should not index files in gitignored directories', async () => {
      const projectPath = await copyFixture('nextjs-app');

      // Create a .gitignore with an entry for a new directory
      // (the fixture may or may not already have a .gitignore)
      const gitignorePath = path.join(projectPath, '.gitignore');
      let gitignoreContent = '';
      try {
        gitignoreContent = readFileSync(gitignorePath, 'utf-8');
      } catch {
        // .gitignore doesn't exist yet — that's fine
      }
      await writeFile(gitignorePath, gitignoreContent + '\nignored-dir/\n');

      // Create a file in the ignored directory
      await mkdir(path.join(projectPath, 'ignored-dir'), { recursive: true });
      await writeFile(
        path.join(projectPath, 'ignored-dir', 'secret.ts'),
        'export const SECRET = "do-not-index";\n',
      );

      const map = await indexer.index(projectPath);

      // The ignored file should NOT be in dependencies
      for (const [filePath] of map.dependencies) {
        expect(filePath).not.toContain('ignored-dir');
      }

      // The ignored file should NOT be in file contexts
      for (const [filePath] of map.fileContexts) {
        expect(filePath).not.toContain('ignored-dir');
      }
    });
  });

  // ── node_modules pruning ─────────────────────────────────────

  describe('node_modules pruning', () => {
    it('should not index files in node_modules', async () => {
      const projectPath = await copyFixture('nextjs-app');

      // Create a fake node_modules with a source file
      await mkdir(path.join(projectPath, 'node_modules', 'some-pkg', 'src'), { recursive: true });
      await writeFile(
        path.join(projectPath, 'node_modules', 'some-pkg', 'src', 'index.ts'),
        'export const foo = 1;\n',
      );

      const map = await indexer.index(projectPath);

      // The node_modules file should NOT appear anywhere
      for (const [filePath] of map.dependencies) {
        expect(filePath).not.toContain('node_modules');
      }
      for (const [filePath] of map.fileContexts) {
        expect(filePath).not.toContain('node_modules');
      }
    });
  });

  // ── update() ──────────────────────────────────────────────────

  describe('update()', () => {
    it('should update the graph for a changed file', async () => {
      const projectPath = await copyFixture('nextjs-app');

      // First, do a full index
      await indexer.index(projectPath);

      const graphPathBefore = path.join(projectPath, '.nova', 'graph.json');
      const contentBefore = readFileSync(graphPathBefore, 'utf-8');

      // Update with the route file (it exists, so the node should be refreshed)
      const changedFile = path.join(projectPath, 'app', 'api', 'users', 'route.ts');
      await indexer.update([changedFile]);

      const contentAfter = readFileSync(graphPathBefore, 'utf-8');
      // Graph file should still exist and be valid JSON
      const parsed: unknown = JSON.parse(contentAfter);
      expect(Array.isArray(parsed)).toBe(true);
      expect((parsed as unknown[]).length).toBeGreaterThan(0);

      // The updated file should still be present in the graph
      const nodes = parsed as Array<{ filePath: string }>;
      expect(nodes.some((n) => n.filePath.includes('api/users/route'))).toBe(true);
    });
  });

  // ── LRU cache ───────────────────────────────────────────────────

  describe('content cache (LRU)', () => {
    it('should populate LRU cache during indexing', async () => {
      const projectPath = await copyFixture('nextjs-app');
      const idx = new ProjectIndexer(new NoopLogger());

      await idx.index(projectPath);

      // After indexing, the LRU cache should have some entries
      expect(idx.contentCache.size).toBeGreaterThan(0);
    });

    it('should return file content via getFileContent', async () => {
      const projectPath = await copyFixture('nextjs-app');
      const idx = new ProjectIndexer(new NoopLogger());

      await idx.index(projectPath);

      // Read a known file via the LRU-backed method
      const pageFile = path.join(projectPath, 'app', 'page.tsx');
      const content = await idx.getFileContent(pageFile, 'app/page.tsx');
      expect(content).toBeTruthy();
      expect(content).toContain('export');
    });
  });

  // ── cappedAt field ────────────────────────────────────────────

  describe('cappedAt', () => {
    it('should not set cappedAt for small projects', async () => {
      const projectPath = await copyFixture('nextjs-app');

      const map = await indexer.index(projectPath);

      expect(map.cappedAt).toBeUndefined();
    });
  });
});

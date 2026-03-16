import { describe, it, expect, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ProjectIndexer } from '../ProjectIndexer.js';

const fixturesDir = path.resolve(__dirname, '../../../../../tests/fixtures');

function fixturePath(name: string): string {
  return path.join(fixturesDir, name);
}

describe('ProjectIndexer', () => {
  const indexer = new ProjectIndexer();
  const novaCleanupPaths: string[] = [];

  afterEach(async () => {
    for (const p of novaCleanupPaths) {
      await rm(path.join(p, '.nova'), { recursive: true, force: true });
      // Also clean up .gitignore modifications
      const gitignorePath = path.join(p, '.gitignore');
      if (existsSync(gitignorePath)) {
        await rm(gitignorePath, { force: true });
      }
    }
    novaCleanupPaths.length = 0;
  });

  // ── index() ───────────────────────────────────────────────────

  describe('index()', () => {
    it('should return a ProjectMap with stack, routes, components, and endpoints for nextjs-app', async () => {
      const projectPath = fixturePath('nextjs-app');
      novaCleanupPaths.push(projectPath);

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
      const projectPath = fixturePath('nextjs-app');
      novaCleanupPaths.push(projectPath);

      await indexer.index(projectPath);

      const graphPath = path.join(projectPath, '.nova', 'graph.json');
      expect(existsSync(graphPath)).toBe(true);

      const graphContent = readFileSync(graphPath, 'utf-8');
      const parsed: unknown = JSON.parse(graphContent);
      expect(Array.isArray(parsed)).toBe(true);
      expect((parsed as unknown[]).length).toBeGreaterThan(0);
    });

    it('should return a non-empty compressedContext string', async () => {
      const projectPath = fixturePath('nextjs-app');
      novaCleanupPaths.push(projectPath);

      const map = await indexer.index(projectPath);

      expect(map.compressedContext).toBeDefined();
      expect(typeof map.compressedContext).toBe('string');
      expect(map.compressedContext.length).toBeGreaterThan(0);
    });
  });

  // ── update() ──────────────────────────────────────────────────

  describe('update()', () => {
    it('should update the graph for a changed file', async () => {
      const projectPath = fixturePath('nextjs-app');
      novaCleanupPaths.push(projectPath);

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
});

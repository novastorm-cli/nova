import { describe, it, expect, afterEach } from 'vitest';
import { rm, mkdtemp, cp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ContextDistiller } from '../ContextDistiller.js';
import { ProjectIndexer } from '../ProjectIndexer.js';

const fixturesDir = path.resolve(__dirname, '../../../../../tests/fixtures');

/** Copy fixture to a temp dir so parallel tests don't conflict on .nova/ */
async function copyFixture(name: string): Promise<string> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), `nova-distiller-test-${name}-`));
  const src = path.join(fixturesDir, name);
  await cp(src, tmpDir, { recursive: true });
  return tmpDir;
}

describe('ContextDistiller', () => {
  const distiller = new ContextDistiller();
  const indexer = new ProjectIndexer();
  let cleanupDirs: string[] = [];

  afterEach(async () => {
    for (const p of cleanupDirs) {
      await rm(p, { recursive: true, force: true });
    }
    cleanupDirs = [];
  });

  describe('distill()', () => {
    it('should return a string containing the framework name', async () => {
      const projectPath = await copyFixture('nextjs-app');
      cleanupDirs.push(projectPath);

      const map = await indexer.index(projectPath);
      const result = distiller.distill(map);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(result.toLowerCase()).toContain('next.js');
    });

    it('should return a string mentioning route count', async () => {
      const projectPath = await copyFixture('nextjs-app');
      cleanupDirs.push(projectPath);

      const map = await indexer.index(projectPath);
      const result = distiller.distill(map);

      // The Structure line should contain a page count, e.g. "1 pages"
      const pageRoutes = map.routes.filter((r) => r.type === 'page');
      expect(result).toContain(`${pageRoutes.length} page`);
    });

    it('should produce a result shorter than 3000 characters', async () => {
      const projectPath = await copyFixture('nextjs-app');
      cleanupDirs.push(projectPath);

      const map = await indexer.index(projectPath);
      const result = distiller.distill(map);

      expect(result.length).toBeLessThan(3000);
    });
  });
});

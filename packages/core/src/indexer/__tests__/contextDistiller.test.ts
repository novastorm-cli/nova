import { describe, it, expect, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ContextDistiller } from '../ContextDistiller.js';
import { ProjectIndexer } from '../ProjectIndexer.js';

const fixturesDir = path.resolve(__dirname, '../../../../../tests/fixtures');

function fixturePath(name: string): string {
  return path.join(fixturesDir, name);
}

describe('ContextDistiller', () => {
  const distiller = new ContextDistiller();
  const indexer = new ProjectIndexer();
  const novaCleanupPaths: string[] = [];

  afterEach(async () => {
    for (const p of novaCleanupPaths) {
      await rm(path.join(p, '.nova'), { recursive: true, force: true });
      const gitignorePath = path.join(p, '.gitignore');
      if (existsSync(gitignorePath)) {
        await rm(gitignorePath, { force: true });
      }
    }
    novaCleanupPaths.length = 0;
  });

  describe('distill()', () => {
    it('should return a string containing the framework name', async () => {
      const projectPath = fixturePath('nextjs-app');
      novaCleanupPaths.push(projectPath);

      const map = await indexer.index(projectPath);
      const result = distiller.distill(map);

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      expect(result.toLowerCase()).toContain('next.js');
    });

    it('should return a string mentioning route count', async () => {
      const projectPath = fixturePath('nextjs-app');
      novaCleanupPaths.push(projectPath);

      const map = await indexer.index(projectPath);
      const result = distiller.distill(map);

      // The Structure line should contain a page count, e.g. "1 pages"
      const pageRoutes = map.routes.filter((r) => r.type === 'page');
      expect(result).toContain(`${pageRoutes.length} page`);
    });

    it('should produce a result shorter than 3000 characters', async () => {
      const projectPath = fixturePath('nextjs-app');
      novaCleanupPaths.push(projectPath);

      const map = await indexer.index(projectPath);
      const result = distiller.distill(map);

      expect(result.length).toBeLessThan(3000);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { FileWalker } from '../FileWalker.js';
import { NoopLogger } from '../../logging/NoopLogger.js';

describe('FileWalker', () => {
  let tmpDir: string;
  let walker: FileWalker;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), 'nova-file-walker-test-'));
    walker = new FileWalker(new NoopLogger());
  });

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  describe('walk()', () => {
    it('should discover source files', async () => {
      await writeFile(join(tmpDir, 'index.ts'), 'export const x = 1;\n');
      await writeFile(join(tmpDir, 'app.tsx'), 'export default function App() {}\n');

      const result = await walker.walk(tmpDir);
      const relPaths = result.files.map((f) => f.relPath);

      expect(relPaths).toContain('index.ts');
      expect(relPaths).toContain('app.tsx');
    });

    it('should prune node_modules', async () => {
      await writeFile(join(tmpDir, 'good.ts'), 'export {};\n');
      await mkdir(join(tmpDir, 'node_modules', 'pkg'), { recursive: true });
      await writeFile(join(tmpDir, 'node_modules', 'pkg', 'index.js'), 'module.exports = {};\n');

      const result = await walker.walk(tmpDir);
      const relPaths = result.files.map((f) => f.relPath);

      expect(relPaths).toContain('good.ts');
      expect(relPaths.some((p) => p.includes('node_modules'))).toBe(false);
    });

    it('should prune .git directory', async () => {
      await writeFile(join(tmpDir, 'good.ts'), 'export {};\n');
      await mkdir(join(tmpDir, '.git', 'objects'), { recursive: true });
      await writeFile(join(tmpDir, '.git', 'config.ts'), 'export {};\n');

      const result = await walker.walk(tmpDir);
      const relPaths = result.files.map((f) => f.relPath);

      expect(relPaths.some((p) => p.includes('.git'))).toBe(false);
    });

    it('should prune dist directory', async () => {
      await writeFile(join(tmpDir, 'good.ts'), 'export {};\n');
      await mkdir(join(tmpDir, 'dist'), { recursive: true });
      await writeFile(join(tmpDir, 'dist', 'output.js'), '// built\n');

      const result = await walker.walk(tmpDir);
      const relPaths = result.files.map((f) => f.relPath);

      expect(relPaths.some((p) => p.includes('dist'))).toBe(false);
    });

    it('should prune .next directory', async () => {
      await writeFile(join(tmpDir, 'good.ts'), 'export {};\n');
      await mkdir(join(tmpDir, '.next', 'server'), { recursive: true });
      await writeFile(join(tmpDir, '.next', 'server', 'page.js'), '// compiled\n');

      const result = await walker.walk(tmpDir);
      const relPaths = result.files.map((f) => f.relPath);

      expect(relPaths.some((p) => p.includes('.next'))).toBe(false);
    });

    it('should prune .turbo directory', async () => {
      await writeFile(join(tmpDir, 'good.ts'), 'export {};\n');
      await mkdir(join(tmpDir, '.turbo'), { recursive: true });
      await writeFile(join(tmpDir, '.turbo', 'cookies.ts'), 'export {};\n');

      const result = await walker.walk(tmpDir);
      const relPaths = result.files.map((f) => f.relPath);

      expect(relPaths.some((p) => p.includes('.turbo'))).toBe(false);
    });

    it('should prune .cache directory', async () => {
      await writeFile(join(tmpDir, 'good.ts'), 'export {};\n');
      await mkdir(join(tmpDir, '.cache'), { recursive: true });
      await writeFile(join(tmpDir, '.cache', 'data.ts'), 'export {};\n');

      const result = await walker.walk(tmpDir);
      const relPaths = result.files.map((f) => f.relPath);

      expect(relPaths.some((p) => p.includes('.cache'))).toBe(false);
    });

    it('should only include scannable extensions', async () => {
      await writeFile(join(tmpDir, 'good.ts'), 'export {};\n');
      await writeFile(join(tmpDir, 'good.tsx'), 'export {};\n');
      await writeFile(join(tmpDir, 'good.js'), 'export {};\n');
      await writeFile(join(tmpDir, 'good.jsx'), 'export {};\n');
      await writeFile(join(tmpDir, 'good.mjs'), 'export {};\n');
      await writeFile(join(tmpDir, 'good.cjs'), 'export {};\n');
      await writeFile(join(tmpDir, 'not-source.css'), 'body {}\n');
      await writeFile(join(tmpDir, 'not-source.json'), '{}');
      await writeFile(join(tmpDir, 'not-source.md'), '# README\n');

      const result = await walker.walk(tmpDir);
      const relPaths = result.files.map((f) => f.relPath);

      expect(relPaths).toContain('good.ts');
      expect(relPaths).toContain('good.tsx');
      expect(relPaths).toContain('good.js');
      expect(relPaths).toContain('good.jsx');
      expect(relPaths).toContain('good.mjs');
      expect(relPaths).toContain('good.cjs');
      expect(relPaths).not.toContain('not-source.css');
      expect(relPaths).not.toContain('not-source.json');
      expect(relPaths).not.toContain('not-source.md');
    });

    it('should include file metadata (mtimeMs, size)', async () => {
      await writeFile(join(tmpDir, 'file.ts'), 'export const x = "hello world";\n');

      const result = await walker.walk(tmpDir);
      expect(result.files.length).toBe(1);

      const entry = result.files[0]!;
      expect(entry.absPath).toBeTruthy();
      expect(entry.relPath).toBe('file.ts');
      expect(entry.mtimeMs).toBeGreaterThan(0);
      expect(entry.size).toBeGreaterThan(0);
    });
  });

  describe('5000-file cap', () => {
    it('should cap files and set cappedAt with a warning', async () => {
      // Create a walker with a very low cap for testing
      const smallWalker = new FileWalker(new NoopLogger(), 5);

      // Create 10 files
      for (let i = 0; i < 10; i++) {
        await writeFile(join(tmpDir, `file-${i}.ts`), 'export {};\n');
      }

      const result = await smallWalker.walk(tmpDir);

      // Should cap at 5
      expect(result.files.length).toBe(5);
      expect(result.cappedAt).toBe(10);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DiffError } from '../../contracts/IExecutor.js';
import type { IDiffApplier } from '../../contracts/IExecutor.js';

// Dynamic import so the module resolves at test time
const { DiffApplier } = await import('../DiffApplier.js');

describe('DiffApplier', () => {
  let tmpDir: string;
  let applier: IDiffApplier;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-applier-test-'));
    applier = new DiffApplier();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── apply() ──────────────────────────────────────────────────

  describe('apply()', () => {
    it('applies a valid unified diff and modifies the file correctly', async () => {
      const filePath = path.join(tmpDir, 'style.css');
      fs.writeFileSync(filePath, 'body {\n  color: red;\n  margin: 0;\n}\n', 'utf-8');

      const diff = [
        `--- a/style.css`,
        `+++ b/style.css`,
        `@@ -1,4 +1,4 @@`,
        ` body {`,
        `-  color: red;`,
        `+  color: blue;`,
        `   margin: 0;`,
        ` }`,
      ].join('\n');

      await applier.apply(filePath, diff);

      const result = fs.readFileSync(filePath, 'utf-8');
      expect(result).toContain('color: blue');
      expect(result).not.toContain('color: red');
      expect(result).toContain('margin: 0');
    });

    it('throws DiffError when context lines do not match', async () => {
      const filePath = path.join(tmpDir, 'app.ts');
      fs.writeFileSync(filePath, 'const x = 1;\nconst y = 2;\n', 'utf-8');

      // Context line says "const x = 99" but file has "const x = 1"
      const diff = [
        `--- a/app.ts`,
        `+++ b/app.ts`,
        `@@ -1,2 +1,2 @@`,
        ` const x = 99;`,
        `-const y = 2;`,
        `+const y = 3;`,
      ].join('\n');

      await expect(applier.apply(filePath, diff)).rejects.toThrow(DiffError);
    });

    it('throws DiffError for invalid diff format', async () => {
      const filePath = path.join(tmpDir, 'file.txt');
      fs.writeFileSync(filePath, 'hello\n', 'utf-8');

      const invalidDiff = 'this is not a valid diff format at all';

      await expect(applier.apply(filePath, invalidDiff)).rejects.toThrow(DiffError);
    });

    it('throws DiffError when the target file does not exist', async () => {
      const filePath = path.join(tmpDir, 'nonexistent.txt');

      const diff = [
        `--- a/nonexistent.txt`,
        `+++ b/nonexistent.txt`,
        `@@ -1,1 +1,1 @@`,
        `-old line`,
        `+new line`,
      ].join('\n');

      await expect(applier.apply(filePath, diff)).rejects.toThrow(DiffError);
    });
  });

  // ── generate() ───────────────────────────────────────────────

  describe('generate()', () => {
    it('returns a valid unified diff string', () => {
      const before = 'line 1\nline 2\nline 3\n';
      const after = 'line 1\nline two\nline 3\n';

      const diff = applier.generate(before, after, 'example.txt');

      expect(typeof diff).toBe('string');
      expect(diff).toContain('---');
      expect(diff).toContain('+++');
      expect(diff).toContain('@@');
      expect(diff).toContain('-line 2');
      expect(diff).toContain('+line two');
    });
  });
});

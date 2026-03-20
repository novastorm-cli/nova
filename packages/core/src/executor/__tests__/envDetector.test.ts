import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { EnvDetector } from '../EnvDetector.js';

describe('EnvDetector', () => {
  let tmpDir: string;
  let detector: EnvDetector;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'env-detector-test-'));
    detector = new EnvDetector();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('detectMissing', () => {
    it('detects process.env references in file contents', () => {
      const contents = [
        'const key = process.env.STRIPE_SECRET_KEY;',
        'const db = process.env.DATABASE_URL;',
      ];

      const missing = detector.detectMissing(tmpDir, contents);

      expect(missing).toContain('STRIPE_SECRET_KEY');
      expect(missing).toContain('DATABASE_URL');
    });

    it('excludes common non-secret vars like NODE_ENV and PORT', () => {
      const contents = [
        'const env = process.env.NODE_ENV;',
        'const port = process.env.PORT;',
        'const key = process.env.API_KEY;',
      ];

      const missing = detector.detectMissing(tmpDir, contents);

      expect(missing).not.toContain('NODE_ENV');
      expect(missing).not.toContain('PORT');
      expect(missing).toContain('API_KEY');
    });

    it('excludes NEXT_PUBLIC_* vars', () => {
      const contents = [
        'const url = process.env.NEXT_PUBLIC_API_URL;',
        'const key = process.env.RESEND_API_KEY;',
      ];

      const missing = detector.detectMissing(tmpDir, contents);

      expect(missing).not.toContain('NEXT_PUBLIC_API_URL');
      expect(missing).toContain('RESEND_API_KEY');
    });

    it('excludes vars already defined in .env.local', async () => {
      await writeFile(join(tmpDir, '.env.local'), 'STRIPE_SECRET_KEY=sk_test_123\n', 'utf-8');

      const contents = [
        'const key = process.env.STRIPE_SECRET_KEY;',
        'const db = process.env.DATABASE_URL;',
      ];

      const missing = detector.detectMissing(tmpDir, contents);

      expect(missing).not.toContain('STRIPE_SECRET_KEY');
      expect(missing).toContain('DATABASE_URL');
    });

    it('returns empty array when no env vars are referenced', () => {
      const contents = ['const x = 42;', 'console.log("hello");'];

      const missing = detector.detectMissing(tmpDir, contents);

      expect(missing).toEqual([]);
    });

    it('deduplicates vars referenced in multiple files', () => {
      const contents = [
        'const a = process.env.API_KEY;',
        'const b = process.env.API_KEY;',
      ];

      const missing = detector.detectMissing(tmpDir, contents);

      expect(missing.filter(v => v === 'API_KEY')).toHaveLength(1);
    });
  });

  describe('readEnvLocal', () => {
    it('returns empty object when .env.local does not exist', () => {
      const result = detector.readEnvLocal(tmpDir);
      expect(result).toEqual({});
    });

    it('parses key=value pairs correctly', async () => {
      await writeFile(join(tmpDir, '.env.local'), 'KEY1=value1\nKEY2=value2\n', 'utf-8');

      const result = detector.readEnvLocal(tmpDir);

      expect(result).toEqual({ KEY1: 'value1', KEY2: 'value2' });
    });

    it('skips comments and empty lines', async () => {
      const content = '# Comment\n\nKEY=val\n\n# Another comment\n';
      await writeFile(join(tmpDir, '.env.local'), content, 'utf-8');

      const result = detector.readEnvLocal(tmpDir);

      expect(result).toEqual({ KEY: 'val' });
    });
  });

  describe('writeEnvLocal', () => {
    it('creates .env.local if it does not exist', async () => {
      detector.writeEnvLocal(tmpDir, { API_KEY: 'test123' });

      const content = await readFile(join(tmpDir, '.env.local'), 'utf-8');
      expect(content).toBe('API_KEY=test123\n');
    });

    it('appends new vars to existing .env.local', async () => {
      await writeFile(join(tmpDir, '.env.local'), 'EXISTING=value\n', 'utf-8');

      detector.writeEnvLocal(tmpDir, { NEW_KEY: 'new_value' });

      const content = await readFile(join(tmpDir, '.env.local'), 'utf-8');
      expect(content).toContain('EXISTING=value');
      expect(content).toContain('NEW_KEY=new_value');
    });

    it('does not duplicate existing keys', async () => {
      await writeFile(join(tmpDir, '.env.local'), 'API_KEY=old\n', 'utf-8');

      detector.writeEnvLocal(tmpDir, { API_KEY: 'new' });

      const content = await readFile(join(tmpDir, '.env.local'), 'utf-8');
      expect(content).toBe('API_KEY=old\n');
    });
  });

  describe('ensureGitignored', () => {
    it('creates .gitignore with .env.local if it does not exist', () => {
      detector.ensureGitignored(tmpDir);

      const exists = existsSync(join(tmpDir, '.gitignore'));
      expect(exists).toBe(true);
    });

    it('appends .env.local to existing .gitignore', async () => {
      await writeFile(join(tmpDir, '.gitignore'), 'node_modules\n', 'utf-8');

      detector.ensureGitignored(tmpDir);

      const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
      expect(content).toContain('node_modules');
      expect(content).toContain('.env.local');
    });

    it('does not add .env.local if already present', async () => {
      await writeFile(join(tmpDir, '.gitignore'), 'node_modules\n.env.local\n', 'utf-8');

      detector.ensureGitignored(tmpDir);

      const content = await readFile(join(tmpDir, '.gitignore'), 'utf-8');
      const count = content.split('.env.local').length - 1;
      expect(count).toBe(1);
    });
  });
});

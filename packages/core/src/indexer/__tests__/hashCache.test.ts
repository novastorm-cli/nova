import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import { HashCache } from '../HashCache.js';

describe('HashCache', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(os.tmpdir(), 'nova-hash-cache-test-'));
  });

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  describe('computeHash', () => {
    it('should compute a sha256 hex hash', () => {
      const files = [
        { relPath: 'src/index.ts', mtimeMs: 1000, size: 200 },
        { relPath: 'src/app.tsx', mtimeMs: 2000, size: 500 },
      ];

      const hash = HashCache.computeHash(files);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce the same hash for the same input', () => {
      const files = [
        { relPath: 'a.ts', mtimeMs: 100, size: 10 },
        { relPath: 'b.ts', mtimeMs: 200, size: 20 },
      ];

      const hash1 = HashCache.computeHash(files);
      const hash2 = HashCache.computeHash([...files]);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different paths', () => {
      const files1 = [{ relPath: 'a.ts', mtimeMs: 100, size: 10 }];
      const files2 = [{ relPath: 'b.ts', mtimeMs: 100, size: 10 }];

      expect(HashCache.computeHash(files1)).not.toBe(HashCache.computeHash(files2));
    });

    it('should produce different hashes for different mtimes', () => {
      const files1 = [{ relPath: 'a.ts', mtimeMs: 100, size: 10 }];
      const files2 = [{ relPath: 'a.ts', mtimeMs: 200, size: 10 }];

      expect(HashCache.computeHash(files1)).not.toBe(HashCache.computeHash(files2));
    });

    it('should produce different hashes for different sizes', () => {
      const files1 = [{ relPath: 'a.ts', mtimeMs: 100, size: 10 }];
      const files2 = [{ relPath: 'a.ts', mtimeMs: 100, size: 20 }];

      expect(HashCache.computeHash(files1)).not.toBe(HashCache.computeHash(files2));
    });

    it('should be deterministic regardless of input order', () => {
      const hash1 = HashCache.computeHash([
        { relPath: 'b.ts', mtimeMs: 200, size: 20 },
        { relPath: 'a.ts', mtimeMs: 100, size: 10 },
      ]);
      const hash2 = HashCache.computeHash([
        { relPath: 'a.ts', mtimeMs: 100, size: 10 },
        { relPath: 'b.ts', mtimeMs: 200, size: 20 },
      ]);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different file counts', () => {
      const hash1 = HashCache.computeHash([{ relPath: 'a.ts', mtimeMs: 100, size: 10 }]);
      const hash2 = HashCache.computeHash([
        { relPath: 'a.ts', mtimeMs: 100, size: 10 },
        { relPath: 'b.ts', mtimeMs: 200, size: 20 },
      ]);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('save and load', () => {
    it('should save and load a hash cache entry', async () => {
      const cache = new HashCache(tmpDir);
      const entry = {
        hash: 'abc123def456',
        fileCount: 42,
        timestamp: Date.now(),
      };

      await cache.save(entry);
      const loaded = await cache.load();

      expect(loaded).not.toBeNull();
      expect(loaded!.hash).toBe('abc123def456');
      expect(loaded!.fileCount).toBe(42);
      expect(loaded!.timestamp).toBe(entry.timestamp);
    });

    it('should return null when no cache file exists', async () => {
      const cache = new HashCache(tmpDir);
      const loaded = await cache.load();
      expect(loaded).toBeNull();
    });

    it('should persist to .nova/index-hash.json', async () => {
      const cache = new HashCache(tmpDir);
      await cache.save({ hash: 'test', fileCount: 1, timestamp: 1000 });

      const { readFileSync } = await import('node:fs');
      const raw = readFileSync(join(tmpDir, 'index-hash.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.hash).toBe('test');
    });
  });
});

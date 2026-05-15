import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface HashCacheEntry {
  /** SHA256 hex digest */
  hash: string;
  /** Number of files used to compute hash */
  fileCount: number;
  /** Unix timestamp when the hash was computed */
  timestamp: number;
}

const HASH_FILE = 'index-hash.json';

/**
 * Persists a content hash to `.nova/index-hash.json`.
 *
 * The hash is computed from file metadata (relative path, mtimeMs, size)
 * for every file in the project. On warm restart, if the hash matches,
 * we skip re-reading file contents.
 */
export class HashCache {
  private readonly novaPath: string;

  constructor(novaPath: string) {
    this.novaPath = novaPath;
  }

  private get hashFilePath(): string {
    return join(this.novaPath, HASH_FILE);
  }

  /**
   * Computes a deterministic SHA256 from file metadata entries.
   * Each entry is formatted as `relPath:mtimeMs:size`.
   * Entries are sorted by path for determinism.
   */
  static computeHash(files: Array<{ relPath: string; mtimeMs: number; size: number }>): string {
    const hash = createHash('sha256');

    // Sort by path for deterministic ordering
    const sorted = [...files].sort((a, b) => a.relPath.localeCompare(b.relPath));

    for (const f of sorted) {
      hash.update(`${f.relPath}:${f.mtimeMs}:${f.size}\n`);
    }

    return hash.digest('hex');
  }

  /**
   * Saves the hash cache to disk.
   */
  async save(entry: HashCacheEntry): Promise<void> {
    await mkdir(dirname(this.hashFilePath), { recursive: true });
    await writeFile(this.hashFilePath, JSON.stringify(entry, null, 2), 'utf-8');
  }

  /**
   * Loads the hash cache from disk.
   * Returns null if the file does not exist or is invalid.
   */
  async load(): Promise<HashCacheEntry | null> {
    try {
      const raw = await readFile(this.hashFilePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === 'object' &&
        'hash' in parsed &&
        'fileCount' in parsed &&
        'timestamp' in parsed
      ) {
        return parsed as HashCacheEntry;
      }
      return null;
    } catch {
      return null;
    }
  }
}

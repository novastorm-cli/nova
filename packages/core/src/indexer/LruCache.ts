/**
 * LRU (Least Recently Used) cache for file contents.
 * Max 256 entries; evicts by recency on overflow.
 */
export class LruCache {
  private readonly max: number;
  private readonly cache = new Map<string, string>();

  constructor(max = 256) {
    this.max = max;
  }

  /**
   * Returns the cached content for the given key, or undefined.
   * Each get bumps the entry to most-recently-used.
   */
  get(key: string): string | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Bump to end (most-recently-used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  /**
   * Stores content under the given key.
   * If the cache is full, evicts the least-recently-used entry.
   */
  set(key: string, value: string): void {
    // Delete first to bump it to end if already present
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.max) {
      // Evict LRU — the first key in insertion order
      const lruKey = this.cache.keys().next().value;
      if (lruKey !== undefined) {
        this.cache.delete(lruKey);
      }
    }
    this.cache.set(key, value);
  }

  /**
   * Returns the current number of entries in the cache.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Returns the configured maximum capacity.
   */
  get capacity(): number {
    return this.max;
  }

  /**
   * Returns whether the cache contains the given key.
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Removes all entries from the cache.
   */
  clear(): void {
    this.cache.clear();
  }
}

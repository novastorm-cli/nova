import { describe, it, expect, beforeEach } from 'vitest';
import { LruCache } from '../LruCache.js';

describe('LruCache', () => {
  let cache: LruCache;

  beforeEach(() => {
    cache = new LruCache(3);
  });

  it('should store and retrieve values', () => {
    cache.set('a', 'value-a');
    expect(cache.get('a')).toBe('value-a');
  });

  it('should return undefined for missing keys', () => {
    expect(cache.get('missing')).toBeUndefined();
  });

  it('should evict least recently used entry when capacity is reached', () => {
    cache.set('a', 'value-a');
    cache.set('b', 'value-b');
    cache.set('c', 'value-c');
    cache.set('d', 'value-d'); // evicts 'a'

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('value-b');
    expect(cache.get('c')).toBe('value-c');
    expect(cache.get('d')).toBe('value-d');
  });

  it('should bump entry to most-recently-used on get', () => {
    cache.set('a', 'value-a');
    cache.set('b', 'value-b');
    cache.set('c', 'value-c');

    // Access 'a' to make it most recently used
    cache.get('a');

    // Now adding 'd' should evict 'b' (not 'a')
    cache.set('d', 'value-d');

    expect(cache.get('a')).toBe('value-a');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('value-c');
    expect(cache.get('d')).toBe('value-d');
  });

  it('should bump entry to most-recently-used on set (update)', () => {
    cache.set('a', 'value-a');
    cache.set('b', 'value-b');
    cache.set('c', 'value-c');

    // Update 'a' to make it most recently used
    cache.set('a', 'value-a-updated');

    cache.set('d', 'value-d'); // should evict 'b'

    expect(cache.get('a')).toBe('value-a-updated');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('value-c');
  });

  it('should report correct size', () => {
    expect(cache.size).toBe(0);
    cache.set('a', 'val');
    expect(cache.size).toBe(1);
    cache.set('b', 'val');
    expect(cache.size).toBe(2);
  });

  it('should report capacity', () => {
    expect(cache.capacity).toBe(3);
    const bigCache = new LruCache(256);
    expect(bigCache.capacity).toBe(256);
  });

  it('should check existence with has()', () => {
    cache.set('x', 'y');
    expect(cache.has('x')).toBe(true);
    expect(cache.has('z')).toBe(false);
  });

  it('should clear all entries', () => {
    cache.set('a', '1');
    cache.set('b', '2');
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });

  it('should default to max 256', () => {
    const defaultCache = new LruCache();
    expect(defaultCache.capacity).toBe(256);
  });
});

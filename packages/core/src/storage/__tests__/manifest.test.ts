import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir } from 'node:fs/promises';
import { ManifestStore } from '../ManifestStore.js';
import type { ManifestService, ManifestDatabase, ManifestEntity } from '../../models/manifest.js';

describe('ManifestStore', () => {
  let tmpDir: string;
  let store: ManifestStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'manifest-test-'));
    await mkdir(join(tmpDir, '.nova'), { recursive: true });
    store = new ManifestStore();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no manifest exists', async () => {
    const result = await store.load(tmpDir);
    expect(result).toBeNull();
  });

  it('adds and loads a service', async () => {
    const service: ManifestService = { name: 'web', type: 'frontend', path: 'apps/web' };
    await store.addService(tmpDir, service);

    const manifest = await store.load(tmpDir);
    expect(manifest).not.toBeNull();
    expect(manifest!.services).toHaveLength(1);
    expect(manifest!.services[0].name).toBe('web');
    expect(manifest!.services[0].type).toBe('frontend');
  });

  it('adds and loads a database', async () => {
    const db: ManifestDatabase = { name: 'main-db', engine: 'postgresql', connection_env: 'DATABASE_URL' };
    await store.addDatabase(tmpDir, db);

    const manifest = await store.load(tmpDir);
    expect(manifest!.databases).toHaveLength(1);
    expect(manifest!.databases[0].engine).toBe('postgresql');
  });

  it('adds and loads an entity', async () => {
    const entity: ManifestEntity = { name: 'Stripe', type: 'external-service', description: 'Payment SDK' };
    await store.addEntity(tmpDir, entity);

    const manifest = await store.load(tmpDir);
    expect(manifest!.entities).toHaveLength(1);
    expect(manifest!.entities[0].name).toBe('Stripe');
  });

  it('removes by name', async () => {
    await store.addService(tmpDir, { name: 'api', type: 'backend', path: 'services/api' });
    await store.addDatabase(tmpDir, { name: 'cache', engine: 'redis' });

    const removed = await store.removeByName(tmpDir, 'api');
    expect(removed).toBe(true);

    const manifest = await store.load(tmpDir);
    expect(manifest!.services).toHaveLength(0);
    expect(manifest!.databases).toHaveLength(1);
  });

  it('returns false when removing non-existent name', async () => {
    await store.addService(tmpDir, { name: 'web', type: 'frontend', path: 'apps/web' });
    const removed = await store.removeByName(tmpDir, 'nonexistent');
    expect(removed).toBe(false);
  });

  it('rejects absolute paths', async () => {
    await expect(
      store.addService(tmpDir, { name: 'bad', type: 'backend', path: '/etc/passwd' }),
    ).rejects.toThrow('Absolute paths not allowed');
  });

  it('rejects path traversal', async () => {
    await expect(
      store.addService(tmpDir, { name: 'bad', type: 'backend', path: '../../etc' }),
    ).rejects.toThrow('Path traversal not allowed');
  });

  it('updates existing service by name', async () => {
    await store.addService(tmpDir, { name: 'api', type: 'backend', path: 'old/path' });
    await store.addService(tmpDir, { name: 'api', type: 'backend', path: 'new/path' });

    const manifest = await store.load(tmpDir);
    expect(manifest!.services).toHaveLength(1);
    expect(manifest!.services[0].path).toBe('new/path');
  });

  it('sets boundaries', async () => {
    await store.setBoundaries(tmpDir, {
      writable: ['src/**'],
      readonly: ['migrations/**'],
      ignored: ['.github/**'],
    });

    const manifest = await store.load(tmpDir);
    expect(manifest!.boundaries.writable).toEqual(['src/**']);
    expect(manifest!.boundaries.readonly).toEqual(['migrations/**']);
    expect(manifest!.boundaries.ignored).toEqual(['.github/**']);
  });
});

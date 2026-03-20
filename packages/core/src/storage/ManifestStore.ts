import { readFile, writeFile } from 'node:fs/promises';
import { join, isAbsolute, normalize } from 'node:path';
import TOML from '@iarna/toml';
import type { IManifestStore } from '../contracts/IManifestStore.js';
import type { Manifest, ManifestService, ManifestDatabase, ManifestEntity, ManifestBoundaries } from '../models/manifest.js';
import { parseManifest } from '../models/manifestSchema.js';

const MANIFEST_FILE = 'manifest.toml';

export class ManifestStore implements IManifestStore {
  private getManifestPath(projectPath: string): string {
    return join(projectPath, '.nova', MANIFEST_FILE);
  }

  private validatePath(p: string): void {
    if (isAbsolute(p)) throw new Error(`Absolute paths not allowed: "${p}"`);
    const normalized = normalize(p);
    if (normalized.startsWith('..')) throw new Error(`Path traversal not allowed: "${p}"`);
  }

  async load(projectPath: string): Promise<Manifest | null> {
    try {
      const raw = await readFile(this.getManifestPath(projectPath), 'utf-8');
      const parsed = TOML.parse(raw);
      return parseManifest(parsed);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async save(projectPath: string, manifest: Manifest): Promise<void> {
    const tomlStr = TOML.stringify(manifest as unknown as TOML.JsonMap);
    await writeFile(this.getManifestPath(projectPath), tomlStr, 'utf-8');
  }

  async addService(projectPath: string, service: ManifestService): Promise<void> {
    this.validatePath(service.path);
    const manifest = (await this.load(projectPath)) ?? { project: { name: '' }, services: [], databases: [], entities: [], boundaries: {} };
    const idx = manifest.services.findIndex(s => s.name === service.name);
    if (idx >= 0) manifest.services[idx] = service;
    else manifest.services.push(service);
    await this.save(projectPath, manifest);
  }

  async addDatabase(projectPath: string, database: ManifestDatabase): Promise<void> {
    if (database.schema_path) this.validatePath(database.schema_path);
    const manifest = (await this.load(projectPath)) ?? { project: { name: '' }, services: [], databases: [], entities: [], boundaries: {} };
    const idx = manifest.databases.findIndex(d => d.name === database.name);
    if (idx >= 0) manifest.databases[idx] = database;
    else manifest.databases.push(database);
    await this.save(projectPath, manifest);
  }

  async addEntity(projectPath: string, entity: ManifestEntity): Promise<void> {
    if (entity.files) entity.files.forEach(f => this.validatePath(f));
    const manifest = (await this.load(projectPath)) ?? { project: { name: '' }, services: [], databases: [], entities: [], boundaries: {} };
    const idx = manifest.entities.findIndex(e => e.name === entity.name);
    if (idx >= 0) manifest.entities[idx] = entity;
    else manifest.entities.push(entity);
    await this.save(projectPath, manifest);
  }

  async removeByName(projectPath: string, name: string): Promise<boolean> {
    const manifest = await this.load(projectPath);
    if (!manifest) return false;

    const origLen = manifest.services.length + manifest.databases.length + manifest.entities.length;
    manifest.services = manifest.services.filter(s => s.name !== name);
    manifest.databases = manifest.databases.filter(d => d.name !== name);
    manifest.entities = manifest.entities.filter(e => e.name !== name);
    const newLen = manifest.services.length + manifest.databases.length + manifest.entities.length;

    if (newLen === origLen) return false;
    await this.save(projectPath, manifest);
    return true;
  }

  async setBoundaries(projectPath: string, boundaries: ManifestBoundaries): Promise<void> {
    const manifest = (await this.load(projectPath)) ?? { project: { name: '' }, services: [], databases: [], entities: [], boundaries: {} };
    manifest.boundaries = boundaries;
    await this.save(projectPath, manifest);
  }
}

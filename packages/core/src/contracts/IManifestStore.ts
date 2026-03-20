import type { Manifest, ManifestService, ManifestDatabase, ManifestEntity, ManifestBoundaries } from '../models/manifest.js';

export interface IManifestStore {
  load(projectPath: string): Promise<Manifest | null>;
  save(projectPath: string, manifest: Manifest): Promise<void>;
  addService(projectPath: string, service: ManifestService): Promise<void>;
  addDatabase(projectPath: string, database: ManifestDatabase): Promise<void>;
  addEntity(projectPath: string, entity: ManifestEntity): Promise<void>;
  removeByName(projectPath: string, name: string): Promise<boolean>;
  setBoundaries(projectPath: string, boundaries: ManifestBoundaries): Promise<void>;
}

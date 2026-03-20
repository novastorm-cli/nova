export type ServiceType = 'frontend' | 'backend' | 'worker' | 'gateway';
export type EntityType = 'module' | 'external-service' | 'library' | 'shared-package';

export interface ManifestProject {
  name: string;
  description?: string;
}

export interface ManifestService {
  name: string;
  type: ServiceType;
  path: string;
  framework?: string;
  language?: string;
}

export interface ManifestDatabase {
  name: string;
  engine: string;
  schema_path?: string;
  connection_env?: string;
}

export interface ManifestEntity {
  name: string;
  type: EntityType;
  description?: string;
  files?: string[];
}

export interface ManifestBoundaries {
  writable?: string[];
  readonly?: string[];
  ignored?: string[];
}

export interface Manifest {
  project: ManifestProject;
  services: ManifestService[];
  databases: ManifestDatabase[];
  entities: ManifestEntity[];
  boundaries: ManifestBoundaries;
}

export const EMPTY_MANIFEST: Manifest = {
  project: { name: '' },
  services: [],
  databases: [],
  entities: [],
  boundaries: {},
};

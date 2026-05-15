export type ServiceType = 'frontend' | 'backend' | 'worker' | 'gateway';
export type EntityType = 'module' | 'external-service' | 'library' | 'shared-package';

export interface ManifestProject {
  name: string;
  description?: string | undefined;
}

export interface ManifestService {
  name: string;
  type: ServiceType;
  path: string;
  framework?: string | undefined;
  language?: string | undefined;
}

export interface ManifestDatabase {
  name: string;
  engine: string;
  schema_path?: string | undefined;
  connection_env?: string | undefined;
}

export interface ManifestEntity {
  name: string;
  type: EntityType;
  description?: string | undefined;
  files?: string[] | undefined;
}

export interface ManifestBoundaries {
  writable?: string[] | undefined;
  readonly?: string[] | undefined;
  ignored?: string[] | undefined;
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

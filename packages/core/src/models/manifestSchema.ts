import { z } from 'zod';
import type { Manifest } from './manifest.js';

const ManifestProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

const ManifestServiceSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['frontend', 'backend', 'worker', 'gateway']),
  path: z.string().min(1),
  framework: z.string().optional(),
  language: z.string().optional(),
});

const ManifestDatabaseSchema = z.object({
  name: z.string().min(1),
  engine: z.string().min(1),
  schema_path: z.string().optional(),
  connection_env: z.string().optional(),
});

const ManifestEntitySchema = z.object({
  name: z.string().min(1),
  type: z.enum(['module', 'external-service', 'library', 'shared-package']),
  description: z.string().optional(),
  files: z.array(z.string()).optional(),
});

const ManifestBoundariesSchema = z.object({
  writable: z.array(z.string()).optional(),
  readonly: z.array(z.string()).optional(),
  ignored: z.array(z.string()).optional(),
});

export const ManifestSchema = z.object({
  project: ManifestProjectSchema,
  services: z.array(ManifestServiceSchema).default([]),
  databases: z.array(ManifestDatabaseSchema).default([]),
  entities: z.array(ManifestEntitySchema).default([]),
  boundaries: ManifestBoundariesSchema.default({}),
}) satisfies z.ZodType<Manifest>;

export function parseManifest(raw: unknown): Manifest {
  return ManifestSchema.parse(raw);
}

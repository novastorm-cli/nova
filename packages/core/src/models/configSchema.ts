import { z } from 'zod';
import type { NovaConfig } from './config.js';

export const NovaConfigSchema = z.object({
  project: z.object({
    devCommand: z.string(),
    port: z.number().int().min(0).max(65535),
    frontend: z.string().optional(),
    backends: z.array(z.string()).optional(),
  }),
  models: z.object({
    micro: z.string(),
    standard: z.string(),
    strong: z.string(),
    local: z.boolean(),
  }),
  apiKeys: z.object({
    provider: z.enum(['openrouter', 'anthropic', 'openai', 'ollama', 'claude-cli']),
    key: z.string().optional(),
  }),
  behavior: z.object({
    autoCommit: z.boolean(),
    branchPrefix: z.string(),
    passiveSuggestions: z.boolean(),
  }),
  voice: z.object({
    enabled: z.boolean(),
    engine: z.enum(['web', 'whisper']),
  }),
  telemetry: z.object({
    enabled: z.boolean(),
  }),
  license: z.object({
    key: z.string().optional(),
  }).optional(),
}) satisfies z.ZodType<NovaConfig>;

export function parseNovaConfig(raw: unknown): NovaConfig {
  return NovaConfigSchema.parse(raw);
}

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import TOML from '@iarna/toml';
import {
  type IConfigReader,
  ConfigError,
  type NovaConfig,
  DEFAULT_CONFIG,
} from '@novastorm-ai/core';
import { DEPRECATION, MIGRATION } from './strings.js';

const NOVA_TOML = 'nova.toml';
const LOCAL_CONFIG_PATH = path.join('.nova', 'config.toml');

/**
 * Deep-merge `source` into `target`, returning a new object.
 * Source values take priority over target values.
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const srcVal = source[key];
    if (srcVal === undefined) continue;
    const tgtVal = result[key];
    if (
      typeof srcVal === 'object' &&
      srcVal !== null &&
      !Array.isArray(srcVal) &&
      typeof tgtVal === 'object' &&
      tgtVal !== null &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      ) as T[keyof T];
    } else {
      result[key] = srcVal as T[keyof T];
    }
  }
  return result;
}

/**
 * Parse a TOML file, returning an empty object if the file does not exist.
 * Throws ConfigError for invalid TOML syntax.
 */
async function readTomlFile(filePath: string): Promise<Record<string, unknown>> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    return {};
  }
  try {
    return TOML.parse(content);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`Invalid TOML in ${filePath}: ${message}`);
  }
}

/**
 * Validate a merged config and throw ConfigError for invalid values.
 */
function validateRelativePath(value: string, field: string): void {
  if (value.includes('..')) {
    throw new ConfigError(`Path traversal not allowed in ${field}: "${value}"`, field);
  }
  if (path.isAbsolute(value)) {
    throw new ConfigError(
      `Absolute paths not allowed in ${field}: "${value}". Use a relative path.`,
      field,
    );
  }
}

function validate(config: NovaConfig): void {
  if (config.project.port < 0 || config.project.port > 65535) {
    throw new ConfigError(
      `Invalid port number: ${config.project.port}. Must be between 0 and 65535.`,
      'project.port',
    );
  }

  const validProviders = [
    'openrouter',
    'anthropic',
    'openai',
    'ollama',
    'claude-cli',
    'deepseek',
  ] as const;
  if (!validProviders.includes(config.apiKeys.provider)) {
    throw new ConfigError(
      `Invalid provider: ${config.apiKeys.provider}. Must be one of: ${validProviders.join(', ')}`,
      'apiKeys.provider',
    );
  }

  const validEngines = ['web', 'whisper'] as const;
  if (!validEngines.includes(config.voice.engine)) {
    throw new ConfigError(
      `Invalid voice engine: ${config.voice.engine}. Must be one of: ${validEngines.join(', ')}`,
      'voice.engine',
    );
  }

  if (typeof config.telemetry.enabled !== 'boolean') {
    throw new ConfigError(`Invalid telemetry.enabled: must be a boolean.`, 'telemetry.enabled');
  }

  if (config.project.frontend !== undefined) {
    validateRelativePath(config.project.frontend, 'project.frontend');
  }

  if (config.project.backends !== undefined) {
    if (!Array.isArray(config.project.backends)) {
      throw new ConfigError('project.backends must be an array of strings.', 'project.backends');
    }
    for (const backend of config.project.backends) {
      if (typeof backend !== 'string') {
        throw new ConfigError(
          'Each entry in project.backends must be a string.',
          'project.backends',
        );
      }
      validateRelativePath(backend, 'project.backends');
    }
  }
}

/**
 * Build a partial config object that only contains fields differing from defaults.
 */
function diffFromDefaults(config: Partial<NovaConfig>): Record<string, unknown> {
  const result: Record<string, Record<string, unknown>> = {};
  const defaults = DEFAULT_CONFIG as unknown as Record<string, Record<string, unknown>>;
  const input = config as Record<string, Record<string, unknown> | undefined>;

  for (const section of Object.keys(input)) {
    const sectionValues = input[section];
    if (!sectionValues || typeof sectionValues !== 'object') continue;
    const defaultSection = defaults[section] as Record<string, unknown> | undefined;
    const diff: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(sectionValues)) {
      if (defaultSection && defaultSection[key] === value) continue;
      diff[key] = value;
    }

    if (Object.keys(diff).length > 0) {
      result[section] = diff;
    }
  }

  return result;
}

// ── Well-known top-level sections in the canonical schema ──────────
const KNOWN_SECTIONS = [
  'project',
  'models',
  'apiKeys',
  'behavior',
  'voice',
  'telemetry',
  'license',
  'git',
] as const;

// ── Well-known provider names (must match the apiKeys.provider union) ──
const KNOWN_PROVIDERS = [
  'openrouter',
  'anthropic',
  'openai',
  'ollama',
  'claude-cli',
  'deepseek',
] as const;

/**
 * Compute Levenshtein (edit) distance between two strings.
 * Standard dynamic-programming implementation, O(m×n).
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Use a single-row DP buffer for memory efficiency.
  // We keep two rows at a time: prev and curr.
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = new Array<number>(n + 1);
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j]! + 1, // deletion
        curr[j - 1]! + 1, // insertion
        prev[j - 1]! + substitutionCost, // substitution
      );
    }
    prev = curr;
  }
  return prev[n]!;
}

/**
 * Find the closest known section name within Levenshtein distance ≤ 2.
 * Returns the match or `null` if nothing is close enough.
 */
function findClosestSection(raw: string): string | null {
  let bestMatch: string | null = null;
  let bestDist = Infinity;

  for (const known of KNOWN_SECTIONS) {
    const dist = levenshteinDistance(raw, known);
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = known;
    }
  }

  return bestDist <= 2 ? bestMatch : null;
}

/**
 * Migrate a legacy `[providers]` section to `[apiKeys]`.
 *
 * Legacy format:
 *   [providers]
 *   deepseek_key = "sk-..."
 *
 * Current format:
 *   [apiKeys]
 *   provider = "deepseek"
 *   key = "sk-..."
 *
 * Returns the migrated `apiKeys` partial (provider + key) or `null`
 * if no legacy migration was applicable for this data blob.
 */
function migrateLegacyProviders(data: Record<string, unknown>): Record<string, unknown> | null {
  const providers = data['providers'] as Record<string, unknown> | undefined;
  if (!providers || typeof providers !== 'object') return null;

  // Look for <provider>_key entries in the [providers] block
  for (const provider of KNOWN_PROVIDERS) {
    const keyField = `${provider}_key`;
    if (keyField in providers) {
      const key = providers[keyField];
      // Build the apiKeys record.
      const apiKeys: Record<string, unknown> = {
        provider,
      };
      if (key !== undefined && key !== null) {
        apiKeys['key'] = key;
      }
      return apiKeys;
    }
  }

  return null;
}

export class ConfigReader implements IConfigReader {
  /** Path to the ~/.nova/ directory where persisted marker files live. */
  private readonly novaHomeDir: string;
  /** Tracks whether the `[providers]` migration info log has been emitted this session. */
  private _providersMigratedWarned = false;

  /**
   * @param novaHomeDir - optional path to the ~/.nova/ directory.
   *   Defaults to `path.join(os.homedir(), '.nova')`.
   *   Useful for testing to isolate marker files.
   */
  constructor(novaHomeDir?: string) {
    this.novaHomeDir = novaHomeDir ?? path.join(os.homedir(), '.nova');
  }

  async read(projectPath: string): Promise<NovaConfig> {
    const projectTomlPath = path.join(projectPath, NOVA_TOML);
    const localTomlPath = path.join(projectPath, LOCAL_CONFIG_PATH);

    const projectData = await readTomlFile(projectTomlPath);
    const localData = await readTomlFile(localTomlPath);

    // ── Legacy [providers] → [apiKeys] migration ──────────────────
    // Check both project and local data for legacy [providers] block.
    // Migration happens per-data-source so that explicit [apiKeys] in
    // the same file still takes precedence.
    for (const data of [projectData, localData]) {
      const migrated = migrateLegacyProviders(data);
      if (migrated) {
        // Merge migrated apiKeys into any existing apiKeys in the data.
        // Migrated values serve as defaults; explicit [apiKeys] wins.
        const existingApiKeys = (data['apiKeys'] as Record<string, unknown>) ?? {};
        data['apiKeys'] = { ...migrated, ...existingApiKeys };

        // Clean up the legacy section so it doesn't leak or cause
        // an unrecognized-section warning.
        delete data['providers'];

        // One-time INFO log per ConfigReader session.
        if (!this._providersMigratedWarned) {
          this._providersMigratedWarned = true;
          console.info(MIGRATION.legacyProvidersMigrated);
        }
      }
    }

    // ── Backward compat: [models] fast → [models] standard ─────────
    // Check both project and local data for legacy `fast` key.
    let fastFound = false;
    for (const data of [projectData, localData]) {
      const models = data['models'] as Record<string, unknown> | undefined;
      if (models && models['fast'] !== undefined) {
        fastFound = true;
        // Use fast value as standard only if standard isn't already set
        // by this same data source.
        if (models['standard'] === undefined) {
          models['standard'] = models['fast'];
        }
        // Delete the legacy key after aliasing so it doesn't leak into
        // the merged config object.
        delete models['fast'];
      }
    }

    // One-time deprecation warning: persisted across all CLI sessions
    // via a marker file at ~/.nova/.fast-model-acknowledged.
    if (fastFound) {
      const markerPath = path.join(this.novaHomeDir, '.fast-model-acknowledged');
      try {
        await fs.access(markerPath);
        // Marker file exists — user has already been warned, skip.
      } catch {
        // Marker does not exist — emit warning and create it.
        console.warn(DEPRECATION.modelsFastWarning);
        try {
          await fs.mkdir(path.dirname(markerPath), { recursive: true });
          await fs.writeFile(markerPath, '', 'utf-8');
        } catch {
          // Best-effort: if we can't write the marker (e.g., permissions),
          // at least we emitted the warning this session.
        }
      }
    }

    // Merge: defaults <- project <- local
    let merged = deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, projectData);
    merged = deepMerge(merged, localData);

    // Apply environment variable overrides
    const envApiKey = process.env['NOVA_API_KEY'];
    if (envApiKey !== undefined) {
      const apiKeys = merged['apiKeys'] as Record<string, unknown>;
      apiKeys['key'] = envApiKey;
    }

    // ── Unrecognized section / typo detection ─────────────────────
    // After merging, scan the raw data for top-level sections that are
    // NOT in the canonical schema and warn the user.
    const allRawSections = new Set<string>();
    for (const data of [projectData, localData]) {
      for (const key of Object.keys(data)) {
        allRawSections.add(key);
      }
    }

    for (const section of allRawSections) {
      if ((KNOWN_SECTIONS as readonly string[]).includes(section)) continue;
      // Legacy [providers] was already migrated and cleaned up, but
      // defensively skip it in case a migration edge-case leaves it.
      if (section === 'providers') continue;

      const closest = findClosestSection(section);
      if (closest) {
        console.warn(MIGRATION.typoSuggestion.replace('%s', section).replace('%s', closest));
      } else {
        console.warn(MIGRATION.unrecognizedSection.replace('%s', section));
      }
    }

    const config = merged as unknown as NovaConfig;
    validate(config);

    return config;
  }

  async write(projectPath: string, config: Partial<NovaConfig>): Promise<void> {
    const diff = diffFromDefaults(config);
    const tomlString = TOML.stringify(diff as TOML.JsonMap);
    const filePath = path.join(projectPath, NOVA_TOML);
    await fs.writeFile(filePath, tomlString, 'utf-8');
  }

  async writeLocal(projectPath: string, config: Partial<NovaConfig>): Promise<void> {
    const diff = diffFromDefaults(config);
    const tomlString = TOML.stringify(diff as TOML.JsonMap);
    const filePath = path.join(projectPath, LOCAL_CONFIG_PATH);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, tomlString, 'utf-8');
  }

  async exists(projectPath: string): Promise<boolean> {
    try {
      await fs.stat(path.join(projectPath, NOVA_TOML));
      return true;
    } catch {
      return false;
    }
  }
}

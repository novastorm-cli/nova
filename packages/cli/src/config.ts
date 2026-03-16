import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import TOML from '@iarna/toml';
import {
  type IConfigReader,
  ConfigError,
  type NovaConfig,
  DEFAULT_CONFIG,
} from '@nova-architect/core';

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
    return TOML.parse(content) as unknown as Record<string, unknown>;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`Invalid TOML in ${filePath}: ${message}`);
  }
}

/**
 * Validate a merged config and throw ConfigError for invalid values.
 */
function validate(config: NovaConfig): void {
  if (config.project.port < 0 || config.project.port > 65535) {
    throw new ConfigError(
      `Invalid port number: ${config.project.port}. Must be between 0 and 65535.`,
      'project.port',
    );
  }

  const validProviders = ['openrouter', 'anthropic', 'openai', 'ollama'] as const;
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

export class ConfigReader implements IConfigReader {
  async read(projectPath: string): Promise<NovaConfig> {
    const projectTomlPath = path.join(projectPath, NOVA_TOML);
    const localTomlPath = path.join(projectPath, LOCAL_CONFIG_PATH);

    const projectData = await readTomlFile(projectTomlPath);
    const localData = await readTomlFile(localTomlPath);

    // Merge: defaults <- project <- local
    let merged = deepMerge(
      DEFAULT_CONFIG as unknown as Record<string, unknown>,
      projectData,
    );
    merged = deepMerge(merged, localData);

    // Apply environment variable overrides
    const envApiKey = process.env['NOVA_API_KEY'];
    if (envApiKey !== undefined) {
      const apiKeys = merged['apiKeys'] as Record<string, unknown>;
      apiKeys['key'] = envApiKey;
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

  async exists(projectPath: string): Promise<boolean> {
    try {
      await fs.stat(path.join(projectPath, NOVA_TOML));
      return true;
    } catch {
      return false;
    }
  }
}

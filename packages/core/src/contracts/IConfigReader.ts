import type { NovaConfig } from '../models/config.js';

export interface IConfigReader {
  /**
   * Reads and merges configuration from all sources.
   *
   * Priority (highest wins):
   * 1. Environment variables: NOVA_API_KEY, NOVA_LICENSE_KEY
   * 2. Local config: .nova/config.toml (API keys, local prefs)
   * 3. Project config: nova.toml (committed to repo)
   * 4. Default values from DEFAULT_CONFIG
   *
   * @param projectPath - absolute path to project root
   * @returns merged NovaConfig
   * @throws {ConfigError} if nova.toml has invalid TOML syntax (message includes line number)
   * @throws {ConfigError} if required field has invalid value (e.g. port < 0)
   *
   * Behavior:
   * - If nova.toml doesn't exist → uses defaults for all project fields
   * - If .nova/config.toml doesn't exist → skips local overrides
   * - Missing optional fields → filled from DEFAULT_CONFIG
   * - NOVA_API_KEY env overrides apiKeys.key from any config file
   */
  read(projectPath: string): Promise<NovaConfig>;

  /**
   * Writes a nova.toml file with the given config.
   * Only writes fields that differ from DEFAULT_CONFIG.
   *
   * @param projectPath - absolute path to project root
   * @param config - config to write
   */
  write(projectPath: string, config: Partial<NovaConfig>): Promise<void>;

  /**
   * Checks if nova.toml exists in the given directory.
   */
  exists(projectPath: string): Promise<boolean>;
}

export class ConfigError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

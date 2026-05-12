/**
 * User-facing strings for the Nova CLI.
 *
 * All brand references, deprecation messages, and other strings
 * that appear in CLI output live here so they can be updated in
 * one place.
 */
export const BRAND = {
  /** The product name. */
  product: 'Novastorm' as const,
  /** The URL for documentation / landing. */
  url: 'https://cli.novastorm.ai' as const,
} as const;

export const DEPRECATION = {
  /**
   * Warning printed when [models] fast is used in config.
   * Emitted once per ConfigReader session (in-memory tracking).
   */
  modelsFastWarning:
    '[models] fast is deprecated; use [models] standard. Removal in v2.0.' as const,

  /** Deprecation messages for removed commands. */
  removedCommands: {
    chat: "'nova chat' was removed in v1.0. Use 'nova' (interactive chat is now built into the main command)." as const,
    tasks:
      "'nova tasks' was removed in v1.0. Task management is now built into the overlay panel." as const,
    watch:
      "'nova watch' was removed in v1.0. File watching is now integrated into the main command." as const,
    review:
      "'nova review' was removed in v1.0. Code review functionality is deprecated, no replacement." as const,
  },
} as const;

export const MIGRATION = {
  /**
   * Info log printed once per ConfigReader session when a legacy
   * [providers] block is found and auto-migrated to [apiKeys].
   */
  legacyProvidersMigrated:
    '[providers] block has been auto-migrated to [apiKeys]. Edit your config file to remove the legacy section.' as const,

  /**
   * Warning template for an unrecognized top-level config section.
   * First %s = the unrecognized section name.
   */
  unrecognizedSection: 'Unrecognized top-level config section [%s] — Nova will ignore it.' as const,

  /**
   * Warning template for a typo detection suggesting a close match.
   * First %s = the unrecognized name, second %s = the suggested match.
   */
  typoSuggestion: 'Unrecognized section [%s] — did you mean [%s]?' as const,
} as const;

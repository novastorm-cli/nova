export interface NovaConfig {
  project: {
    devCommand: string;
    port: number;
    frontend?: string | undefined;
    backends?: string[] | undefined;
  };
  models: {
    micro: string;
    standard: string;
    strong: string;
    local: boolean;
    /** Optional orchestrator model — falls back to strong when not set. */
    orchestrator?: string | undefined;
  };
  apiKeys: {
    provider: 'openrouter' | 'anthropic' | 'openai' | 'ollama' | 'claude-cli' | 'deepseek';
    key?: string | undefined; // resolved from env or .nova/config.toml
  };
  behavior: {
    autoCommit: boolean;
    confirmTasks: boolean;
    branchPrefix: string;
    passiveSuggestions: boolean;
  };
  voice: {
    enabled: boolean;
    engine: 'web' | 'whisper';
  };
  telemetry: {
    enabled: boolean;
  };
  license?:
    | {
        key?: string | undefined;
      }
    | undefined;
  git?:
    | {
        allowProtectedBranchCommits?: boolean | undefined;
      }
    | undefined;
  rag?:
    | {
        embeddingProvider?: 'openai' | 'ollama' | 'tfidf' | undefined;
      }
    | undefined;
  mission?:
    | {
        enabled: boolean;
        autoApprove: boolean;
        maxIterations: number;
      }
    | undefined;
}

export const DEFAULT_CONFIG: NovaConfig = {
  project: { devCommand: '', port: 3000 },
  models: {
    micro: 'claude-haiku-4-5-20251001',
    standard: 'claude-sonnet-4-6',
    strong: 'claude-opus-4-6',
    local: false,
    orchestrator: 'claude-opus-4-6',
  },
  apiKeys: { provider: 'openrouter' },
  behavior: {
    autoCommit: false,
    confirmTasks: true,
    branchPrefix: 'nova/',
    passiveSuggestions: true,
  },
  voice: { enabled: true, engine: 'web' },
  telemetry: { enabled: true },
  mission: {
    enabled: true,
    autoApprove: false,
    maxIterations: 5,
  },
};

/**
 * Provider-specific model defaults.
 * When the user configures a provider but does not explicitly override models.*,
 * these values replace the Anthropic-centric DEFAULT_CONFIG.models so that the
 * chosen provider receives models it actually supports.
 */
export const PROVIDER_MODEL_DEFAULTS: Record<
  string,
  { micro: string; standard: string; strong: string }
> = {
  deepseek: {
    micro: 'deepseek-v4-flash',
    standard: 'deepseek-v4-pro',
    strong: 'deepseek-v4-pro',
  },
};

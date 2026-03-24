export interface NovaConfig {
  project: {
    devCommand: string;
    port: number;
    frontend?: string;
    backends?: string[];
  };
  models: {
    micro: string;
    standard: string;
    strong: string;
    local: boolean;
  };
  apiKeys: {
    provider: 'openrouter' | 'anthropic' | 'openai' | 'ollama' | 'claude-cli';
    key?: string;  // resolved from env or .nova/config.toml
  };
  behavior: {
    autoCommit: boolean;
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
  license?: {
    key?: string;
  };
}

export const DEFAULT_CONFIG: NovaConfig = {
  project: { devCommand: '', port: 3000 },
  models: { micro: 'claude-haiku-4-5-20251001', standard: 'claude-sonnet-4-6', strong: 'claude-opus-4-6', local: false },
  apiKeys: { provider: 'openrouter' },
  behavior: { autoCommit: false, branchPrefix: 'nova/', passiveSuggestions: true },
  voice: { enabled: true, engine: 'web' },
  telemetry: { enabled: true },
};

export interface NovaConfig {
  project: {
    devCommand: string;
    port: number;
  };
  models: {
    fast: string;
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
}

export const DEFAULT_CONFIG: NovaConfig = {
  project: { devCommand: '', port: 3000 },
  models: { fast: 'anthropic/claude-haiku-4-5-20251001', strong: 'anthropic/claude-sonnet-4-6', local: false },
  apiKeys: { provider: 'openrouter' },
  behavior: { autoCommit: false, branchPrefix: 'nova/', passiveSuggestions: true },
  voice: { enabled: true, engine: 'web' },
};

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
    provider: 'openrouter' | 'anthropic' | 'openai' | 'ollama';
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
  models: { fast: 'openrouter/qwen-2.5-coder-7b', strong: 'anthropic/claude-sonnet-4', local: false },
  apiKeys: { provider: 'openrouter' },
  behavior: { autoCommit: false, branchPrefix: 'nova/', passiveSuggestions: true },
  voice: { enabled: true, engine: 'web' },
};

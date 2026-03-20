import { describe, it, expect } from 'vitest';
import { parseNovaConfig } from '../configSchema.js';
import { DEFAULT_CONFIG } from '../config.js';

describe('NovaConfigSchema', () => {
  it('should accept valid default config', () => {
    expect(() => parseNovaConfig(DEFAULT_CONFIG)).not.toThrow();
  });

  it('should accept config with all optional fields', () => {
    const config = {
      ...DEFAULT_CONFIG,
      project: { ...DEFAULT_CONFIG.project, frontend: 'frontend', backends: ['api'] },
      license: { key: 'NOVA-ABC-1234' },
    };
    expect(() => parseNovaConfig(config)).not.toThrow();
  });

  it('should reject invalid port', () => {
    const config = { ...DEFAULT_CONFIG, project: { ...DEFAULT_CONFIG.project, port: 99999 } };
    expect(() => parseNovaConfig(config)).toThrow();
  });

  it('should reject invalid provider', () => {
    const config = { ...DEFAULT_CONFIG, apiKeys: { provider: 'invalid' } };
    expect(() => parseNovaConfig(config)).toThrow();
  });

  it('should reject invalid voice engine', () => {
    const config = { ...DEFAULT_CONFIG, voice: { enabled: true, engine: 'invalid' } };
    expect(() => parseNovaConfig(config)).toThrow();
  });

  it('should reject non-boolean telemetry.enabled', () => {
    const config = { ...DEFAULT_CONFIG, telemetry: { enabled: 'yes' } };
    expect(() => parseNovaConfig(config)).toThrow();
  });

  it('should reject completely invalid input', () => {
    expect(() => parseNovaConfig('not an object')).toThrow();
    expect(() => parseNovaConfig(null)).toThrow();
    expect(() => parseNovaConfig(42)).toThrow();
  });
});

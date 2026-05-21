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

describe('NovaConfigSchema — models.orchestrator', () => {
  it('should accept config with orchestrator model', () => {
    const config = {
      ...DEFAULT_CONFIG,
      models: { ...DEFAULT_CONFIG.models, orchestrator: 'claude-opus-4-6' },
    };
    expect(() => parseNovaConfig(config)).not.toThrow();
    const parsed = parseNovaConfig(config);
    expect(parsed.models.orchestrator).toBe('claude-opus-4-6');
  });

  it('should accept config without orchestrator model (optional)', () => {
    const modelsWithoutOrchestrator = { ...DEFAULT_CONFIG.models };
    delete (modelsWithoutOrchestrator as Record<string, unknown>).orchestrator;
    const config = { ...DEFAULT_CONFIG, models: modelsWithoutOrchestrator };
    expect(() => parseNovaConfig(config)).not.toThrow();
  });

  it('should default orchestrator to strong model in DEFAULT_CONFIG', () => {
    expect(DEFAULT_CONFIG.models.orchestrator).toBe(DEFAULT_CONFIG.models.strong);
  });
});

describe('NovaConfigSchema — [mission] section', () => {
  it('should accept config with valid mission section', () => {
    const config = {
      ...DEFAULT_CONFIG,
      mission: { enabled: true, autoApprove: false, maxIterations: 5 },
    };
    expect(() => parseNovaConfig(config)).not.toThrow();
  });

  it('should accept config without mission section (optional)', () => {
    const configWithoutMission = { ...DEFAULT_CONFIG };
    delete (configWithoutMission as Record<string, unknown>).mission;
    expect(() => parseNovaConfig(configWithoutMission)).not.toThrow();
  });

  it('should use defaults when mission section is missing', () => {
    const configWithoutMission = { ...DEFAULT_CONFIG };
    delete (configWithoutMission as Record<string, unknown>).mission;
    const parsed = parseNovaConfig(configWithoutMission);
    // Zod .optional() means the field is optional on the parsed output
    expect(parsed.mission).toBeUndefined();
  });

  it('should accept maxIterations at boundary 1', () => {
    const config = {
      ...DEFAULT_CONFIG,
      mission: { enabled: true, autoApprove: false, maxIterations: 1 },
    };
    expect(() => parseNovaConfig(config)).not.toThrow();
  });

  it('should accept maxIterations at boundary 20', () => {
    const config = {
      ...DEFAULT_CONFIG,
      mission: { enabled: true, autoApprove: false, maxIterations: 20 },
    };
    expect(() => parseNovaConfig(config)).not.toThrow();
  });

  it('should accept maxIterations at 10', () => {
    const config = {
      ...DEFAULT_CONFIG,
      mission: { enabled: true, autoApprove: false, maxIterations: 10 },
    };
    expect(() => parseNovaConfig(config)).not.toThrow();
  });

  it('should reject maxIterations: 0 (below min)', () => {
    const config = {
      ...DEFAULT_CONFIG,
      mission: { enabled: true, autoApprove: false, maxIterations: 0 },
    };
    expect(() => parseNovaConfig(config)).toThrow();
  });

  it('should reject maxIterations: 100 (above max)', () => {
    const config = {
      ...DEFAULT_CONFIG,
      mission: { enabled: true, autoApprove: false, maxIterations: 100 },
    };
    expect(() => parseNovaConfig(config)).toThrow();
  });

  it('should reject invalid enabled type (non-boolean)', () => {
    const config = {
      ...DEFAULT_CONFIG,
      mission: { enabled: 'yes', autoApprove: false, maxIterations: 5 },
    };
    expect(() => parseNovaConfig(config)).toThrow();
  });

  it('should accept config with unknown mission sub-keys (passthrough)', () => {
    const config = {
      ...DEFAULT_CONFIG,
      mission: {
        enabled: true,
        autoApprove: false,
        maxIterations: 5,
        unknownField: 'some value',
      },
    };
    // Should not throw — unknown keys pass through
    expect(() => parseNovaConfig(config)).not.toThrow();
  });
});

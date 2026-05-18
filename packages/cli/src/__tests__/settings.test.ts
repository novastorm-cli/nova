import { describe, it, expect, vi } from 'vitest';
import type { NovaConfig } from '@novastorm-ai/core';
import { formatSettings, handleSettingsCommand } from '../settings.js';
import type { ConfigReader } from '../config.js';

const minimalConfig: NovaConfig = {
  apiKeys: { provider: 'openai', key: 'sk-test-key-1234567890' },
  models: { micro: 'gpt-4o-mini', standard: 'gpt-4o', strong: 'gpt-4o', local: false },
  project: { devCommand: '', port: 3000, frontend: undefined, backends: [] },
  behavior: {
    autoCommit: true,
    confirmTasks: true,
    branchPrefix: 'nova/',
    passiveSuggestions: false,
  },
  voice: { enabled: false, engine: 'web' },
  telemetry: { enabled: false },
} as NovaConfig;

function mockConfigReader(): ConfigReader {
  return {
    read: vi.fn(),
    write: vi.fn().mockResolvedValue(undefined),
    writeLocal: vi.fn().mockResolvedValue(undefined),
    getProjectConfig: vi.fn(),
    detectPackageManager: vi.fn(),
    scanProject: vi.fn(),
  } as unknown as ConfigReader;
}

describe('formatSettings', () => {
  it('returns a string with section headers', () => {
    const result = formatSettings(minimalConfig);
    expect(typeof result).toBe('string');
    expect(result).toContain('Nova Settings');
    expect(result).toContain('[apiKeys]');
  });

  it('shows "(not set)" for undefined values', () => {
    const config: NovaConfig = {
      ...minimalConfig,
      apiKeys: { provider: 'openai' } as NovaConfig['apiKeys'],
    };
    const result = formatSettings(config);
    expect(result).toContain('(not set)');
  });

  it('obscures API keys', () => {
    const result = formatSettings(minimalConfig);
    expect(result).toContain('...');
    expect(result).not.toContain('sk-test-key-1234567890');
  });

  it('shows options for fields with options', () => {
    const result = formatSettings(minimalConfig);
    expect(result).toContain('options:');
  });

  it('shows usage hints', () => {
    const result = formatSettings(minimalConfig);
    expect(result).toContain('Usage: /settings');
    expect(result).toContain('Example:');
  });
});

describe('handleSettingsCommand', () => {
  it('shows all settings when no args', async () => {
    const reader = mockConfigReader();
    const result = await handleSettingsCommand('', minimalConfig, reader, '/tmp');
    expect(result).toContain('Nova Settings');
    expect(vi.mocked(reader.write)).not.toHaveBeenCalled();
  });

  it('shows single setting when key without value', async () => {
    const reader = mockConfigReader();
    const result = await handleSettingsCommand('models.standard', minimalConfig, reader, '/tmp');
    expect(result).toContain('gpt-4o');
  });

  it('returns error for unknown key', async () => {
    const reader = mockConfigReader();
    const result = await handleSettingsCommand('unknown.key', minimalConfig, reader, '/tmp');
    expect(result).toContain('Unknown');
  });

  it('validates option fields', async () => {
    const reader = mockConfigReader();
    const result = await handleSettingsCommand(
      'apiKeys.provider invalid-provider',
      minimalConfig,
      reader,
      '/tmp',
    );
    expect(result).toContain('Invalid');
  });

  it('sets a string value and saves', async () => {
    const reader = mockConfigReader();
    const result = await handleSettingsCommand(
      'models.standard gpt-4o',
      minimalConfig,
      reader,
      '/tmp',
    );
    expect(result).toContain('gpt-4o');
    expect(result).toContain('saved');
    expect(vi.mocked(reader.write)).toHaveBeenCalled();
  });

  it('sets a boolean value', async () => {
    const reader = mockConfigReader();
    const result = await handleSettingsCommand(
      'behavior.autoCommit false',
      minimalConfig,
      reader,
      '/tmp',
    );
    expect(result).toContain('false');
    expect(vi.mocked(reader.write)).toHaveBeenCalled();
  });

  it('rejects invalid boolean', async () => {
    const reader = mockConfigReader();
    const result = await handleSettingsCommand(
      'behavior.autoCommit maybe',
      minimalConfig,
      reader,
      '/tmp',
    );
    expect(result).toContain('Invalid boolean');
  });

  it('sets a number value', async () => {
    const reader = mockConfigReader();
    const result = await handleSettingsCommand('project.port 8080', minimalConfig, reader, '/tmp');
    expect(result).toContain('8080');
    expect(vi.mocked(reader.write)).toHaveBeenCalled();
  });

  it('rejects invalid number', async () => {
    const reader = mockConfigReader();
    const result = await handleSettingsCommand('project.port abc', minimalConfig, reader, '/tmp');
    expect(result).toContain('Invalid number');
  });

  it('sets a string[] value', async () => {
    const config: NovaConfig = {
      ...minimalConfig,
      project: { ...minimalConfig.project, backends: [] },
    };
    const reader = mockConfigReader();
    const result = await handleSettingsCommand(
      'project.backends api,worker',
      config,
      reader,
      '/tmp',
    );
    expect(result).toContain('api');
    expect(vi.mocked(reader.write)).toHaveBeenCalled();
  });

  it('saves secret fields to local config', async () => {
    const reader = mockConfigReader();
    const result = await handleSettingsCommand(
      'apiKeys.key sk-new-key-12345678',
      minimalConfig,
      reader,
      '/tmp',
    );
    expect(result).toContain('saved');
    // API key value should be partially hidden in success message
    expect(result).toContain('...');
  });

  it('handles save errors gracefully', async () => {
    const reader = mockConfigReader();
    vi.mocked(reader.write).mockRejectedValue(new Error('permission denied'));
    const result = await handleSettingsCommand(
      'models.standard gpt-4o',
      minimalConfig,
      reader,
      '/tmp',
    );
    expect(result).toContain('Failed to save');
  });
});

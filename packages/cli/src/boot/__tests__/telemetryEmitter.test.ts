import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock telemetry helpers
const mockResolveTelemetryEnabled = vi.fn();
const mockGetMachineId = vi.fn();
vi.mock('../../telemetry.js', () => ({
  resolveTelemetryEnabled: (...args: unknown[]) => mockResolveTelemetryEnabled(...args),
  getMachineId: (...args: unknown[]) => mockGetMachineId(...args),
}));

// Mock child_process to avoid real git operations
vi.mock('node:child_process', () => ({
  execFile: (_cmd: string, _args: string[], _opts: unknown, cb: Function) =>
    cb(new Error('no git')),
}));

import { sendBootTelemetry } from '../TelemetryEmitter.js';

describe('TelemetryEmitter', () => {
  const defaultConfig = {
    telemetry: { enabled: true },
    license: {},
    apiKeys: { provider: 'deepseek', key: '' },
  };
  const defaultLicense = { valid: true, devCount: 2, tier: 'free' as const };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not send telemetry when disabled via resolveTelemetryEnabled', async () => {
    mockResolveTelemetryEnabled.mockResolvedValue(false);
    await sendBootTelemetry({}, defaultConfig as any, defaultLicense, '/tmp/test');
    expect(mockGetMachineId).not.toHaveBeenCalled();
  });

  it('calls resolveTelemetryEnabled with correct args', async () => {
    mockResolveTelemetryEnabled.mockResolvedValue(false);
    const opts = { noTelemetry: true };
    await sendBootTelemetry(opts, defaultConfig as any, defaultLicense, '/tmp/test');
    expect(mockResolveTelemetryEnabled).toHaveBeenCalledWith(opts, true);
  });

  it('is a function with expected arity', () => {
    expect(typeof sendBootTelemetry).toBe('function');
    expect(sendBootTelemetry.length).toBe(4);
  });
});

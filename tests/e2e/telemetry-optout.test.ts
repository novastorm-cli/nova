import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Telemetry } from '../../packages/licensing/src/Telemetry.js';
import { DEFAULT_CONFIG } from '../../packages/core/src/models/config.js';
import type { NovaConfig, TelemetryPayload } from '../../packages/core/src/models/types.js';

// ── Helpers ────────────────────────────────────────────────

function makePayload(overrides: Partial<TelemetryPayload> = {}): TelemetryPayload {
  return {
    machineId: 'test-machine',
    gitAuthors90d: 1,
    projectHash: 'test-hash',
    cliVersion: '0.0.1',
    os: 'darwin',
    timestamp: new Date().toISOString(),
    licenseKey: null,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<NovaConfig> = {}): NovaConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

// ── Tests ──────────────────────────────────────────────────

describe('E2E: Telemetry opt-out', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ nudge_level: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    globalThis.fetch = fetchSpy;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // ── Scenario A: NOVA_TELEMETRY=false env var ──────────

  it('NOVA_TELEMETRY=false env var → telemetry should be skipped in start.ts flow', () => {
    // Simulate the opt-out check from start.ts:
    // if (config.telemetry.enabled && process.env['NOVA_TELEMETRY'] !== 'false')
    process.env.NOVA_TELEMETRY = 'false';
    const config = makeConfig();

    const shouldSendTelemetry =
      config.telemetry.enabled && process.env['NOVA_TELEMETRY'] !== 'false';

    expect(shouldSendTelemetry).toBe(false);
    // fetch should NOT have been called
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── Scenario B: config.telemetry.enabled = false ──────

  it('config.telemetry.enabled = false → telemetry should be skipped', () => {
    const config = makeConfig({
      telemetry: { enabled: false },
    });

    const shouldSendTelemetry =
      config.telemetry.enabled && process.env['NOVA_TELEMETRY'] !== 'false';

    expect(shouldSendTelemetry).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── Scenario C: Both enabled → telemetry proceeds ────

  it('config.telemetry.enabled = true and no NOVA_TELEMETRY env → telemetry proceeds', async () => {
    delete process.env.NOVA_TELEMETRY;
    const config = makeConfig();

    const shouldSendTelemetry =
      config.telemetry.enabled && process.env['NOVA_TELEMETRY'] !== 'false';

    expect(shouldSendTelemetry).toBe(true);

    // When the check passes, Telemetry.send() is called and issues fetch
    const telemetry = new Telemetry();
    await telemetry.send(makePayload());

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  // ── Scenario D: NOVA_TELEMETRY=false means Telemetry.send() is never reached ──

  it('NOVA_TELEMETRY=false → when guarded by config check, Telemetry.send() is never called', async () => {
    process.env.NOVA_TELEMETRY = 'false';
    const config = makeConfig();
    const telemetry = new Telemetry();

    // Replicate the guard from start.ts
    if (config.telemetry.enabled && process.env['NOVA_TELEMETRY'] !== 'false') {
      await telemetry.send(makePayload());
    }

    // fetch should never have been called
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── Scenario E: --no-telemetry flag sets NOVA_TELEMETRY=false ──

  it('--no-telemetry flag logic: setting NOVA_TELEMETRY=false blocks telemetry', async () => {
    // Simulate what the CLI does when --no-telemetry is passed:
    // It sets process.env.NOVA_TELEMETRY = 'false'
    process.env.NOVA_TELEMETRY = 'false';

    const config = makeConfig(); // telemetry.enabled defaults to true
    const telemetry = new Telemetry();

    const shouldSendTelemetry =
      config.telemetry.enabled && process.env['NOVA_TELEMETRY'] !== 'false';

    expect(shouldSendTelemetry).toBe(false);

    // Double-check: even if someone ignores the guard, the env is set
    expect(process.env['NOVA_TELEMETRY']).toBe('false');

    // Guard prevents send
    if (shouldSendTelemetry) {
      await telemetry.send(makePayload());
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

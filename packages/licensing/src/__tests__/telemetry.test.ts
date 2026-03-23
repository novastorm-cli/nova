import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Telemetry } from '../Telemetry.js';
import type { TelemetryPayload } from '@novastorm-ai/core';

function makePayload(overrides: Partial<TelemetryPayload> = {}): TelemetryPayload {
  return {
    machineId: 'abc123',
    gitAuthors90d: 2,
    projectHash: 'def456',
    cliVersion: '0.0.1',
    os: 'darwin',
    timestamp: '2026-03-20T12:00:00.000Z',
    licenseKey: null,
    ...overrides,
  };
}

describe('Telemetry', () => {
  let telemetry: Telemetry;
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    telemetry = new Telemetry();

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
    vi.restoreAllMocks();
  });

  // ── Basic send behavior ──────────────────────────────────

  describe('send()', () => {
    it('should call fetch with POST and correct payload', async () => {
      const payload = makePayload({ licenseKey: 'NOVA-KEY-abcd' });
      await telemetry.send(payload);

      expect(fetchSpy).toHaveBeenCalledOnce();

      const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe('https://api.nova-architect.dev/v1/telemetry');
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body as string);
      expect(body).toEqual(
        expect.objectContaining({
          machineId: 'abc123',
          gitAuthors90d: 2,
          projectHash: 'def456',
          cliVersion: '0.0.1',
          os: 'darwin',
          licenseKey: 'NOVA-KEY-abcd',
        }),
      );
    });

    it('should pass null licenseKey through to payload', async () => {
      await telemetry.send(makePayload({ licenseKey: null }));

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);

      expect(body.licenseKey).toBeNull();
    });

    it('should return TelemetryResponse with nudgeLevel when server responds', async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({ nudge_level: 2 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await telemetry.send(makePayload());

      expect(result).toEqual({ nudgeLevel: 2 });
    });

    it('should return nudgeLevel 0 when server omits nudge_level', async () => {
      fetchSpy.mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const result = await telemetry.send(makePayload());

      expect(result).toEqual({ nudgeLevel: 0 });
    });

    it('should return null when server returns non-ok status', async () => {
      fetchSpy.mockResolvedValue(new Response('error', { status: 500 }));

      const result = await telemetry.send(makePayload());

      expect(result).toBeNull();
    });
  });

  // ── Error resilience ─────────────────────────────────────

  describe('error handling', () => {
    it('should not propagate exceptions when fetch throws', async () => {
      fetchSpy.mockRejectedValue(new Error('network failure'));

      const result = await telemetry.send(makePayload());

      expect(result).toBeNull();
    });

    it('should not propagate exceptions on fetch timeout', async () => {
      fetchSpy.mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(
              () => reject(new DOMException('The operation was aborted', 'AbortError')),
              10,
            );
          }),
      );

      const result = await telemetry.send(makePayload());

      expect(result).toBeNull();
    });
  });
});

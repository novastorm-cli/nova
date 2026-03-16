import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { Telemetry } from '../Telemetry.js';

describe('Telemetry', () => {
  let telemetry: Telemetry;
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    telemetry = new Telemetry();

    fetchSpy = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    globalThis.fetch = fetchSpy;

    // Ensure telemetry is enabled by default
    delete process.env.NOVA_TELEMETRY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // ── Basic send behavior ──────────────────────────────────

  describe('send()', () => {
    it('should call fetch with POST and correct payload shape', async () => {
      await telemetry.send('NOVA-KEY-abcd', 2, '/projects/test');

      expect(fetchSpy).toHaveBeenCalledOnce();

      const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe('https://api.nova-architect.dev/telemetry');
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body as string);
      expect(body).toEqual(
        expect.objectContaining({
          licenseKey: 'NOVA-KEY-abcd',
          devCount: 2,
          projectHash: expect.any(String),
          version: expect.any(String),
        }),
      );
    });

    it('should hash projectPath with sha256 for projectHash', async () => {
      const projectPath = '/my/project/path';
      const expectedHash = crypto.createHash('sha256').update(projectPath).digest('hex');

      await telemetry.send(null, 1, projectPath);

      expect(fetchSpy).toHaveBeenCalledOnce();

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);

      expect(body.projectHash).toBe(expectedHash);
    });

    it('should pass null licenseKey through to payload', async () => {
      await telemetry.send(null, 1, '/path');

      const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);

      expect(body.licenseKey).toBeNull();
    });
  });

  // ── Disabled via env ─────────────────────────────────────

  describe('NOVA_TELEMETRY=false', () => {
    it('should NOT call fetch when NOVA_TELEMETRY is set to "false"', async () => {
      process.env.NOVA_TELEMETRY = 'false';

      await telemetry.send('key', 1, '/path');

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  // ── Error resilience ─────────────────────────────────────

  describe('error handling', () => {
    it('should not propagate exceptions when fetch throws', async () => {
      fetchSpy.mockRejectedValue(new Error('network failure'));

      await expect(telemetry.send('key', 1, '/path')).resolves.toBeUndefined();
    });

    it('should not propagate exceptions on fetch timeout', async () => {
      fetchSpy.mockImplementation(
        () => new Promise((_, reject) => {
          setTimeout(() => reject(new DOMException('The operation was aborted', 'AbortError')), 10);
        }),
      );

      await expect(telemetry.send('key', 1, '/path')).resolves.toBeUndefined();
    });
  });
});

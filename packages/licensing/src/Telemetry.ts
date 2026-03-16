import { createHash } from 'node:crypto';
import type { ITelemetry } from '@nova-architect/core';

const TELEMETRY_ENDPOINT = 'https://api.nova-architect.dev/telemetry';
const TIMEOUT_MS = 3_000;
const VERSION = '0.0.1';

export class Telemetry implements ITelemetry {
  async send(
    licenseKey: string | null,
    devCount: number,
    projectPath: string,
  ): Promise<void> {
    if (process.env['NOVA_TELEMETRY'] === 'false') {
      return;
    }

    try {
      const projectHash = createHash('sha256')
        .update(projectPath)
        .digest('hex');

      const payload = JSON.stringify({
        licenseKey,
        devCount,
        projectHash,
        version: VERSION,
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        await fetch(TELEMETRY_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // Silently swallow all errors — fire-and-forget
    }
  }
}

import type { ITelemetry } from '@novastorm-ai/core';
import type { TelemetryPayload, TelemetryResponse, NudgeLevel } from '@novastorm-ai/core';

const TELEMETRY_ENDPOINT = 'https://api.nova-architect.dev/v1/telemetry';
const TIMEOUT_MS = 3_000;

export class Telemetry implements ITelemetry {
  async send(payload: TelemetryPayload): Promise<TelemetryResponse | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetch(TELEMETRY_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (response.ok) {
          const data = (await response.json()) as { nudge_level?: number };
          return { nudgeLevel: (data.nudge_level ?? 0) as NudgeLevel };
        }
        return null;
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // Fire-and-forget -- silently swallow all errors
      return null;
    }
  }
}

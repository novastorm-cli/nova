import type {
  LicenseStatus,
  NovaConfig,
  TelemetryPayload,
  TelemetryResponse,
} from '../models/index.js';

export interface ILicenseChecker {
  /**
   * Checks if the current project requires a paid license.
   *
   * Logic:
   * 1. Count unique commit authors (by email) via TeamDetector (90-day window, bots filtered)
   * 2. If devCount <= 3 -> { valid: true, tier: 'free' }
   * 3. If devCount > 3 AND NOVA_LICENSE_KEY (env or config) exists -> validate key format + checksum
   * 4. If devCount > 3 AND no key -> { valid: false, tier: 'company', message: "Company license required..." }
   *
   * License key format: "NOVA-{base32}-{checksum}" where checksum = first 4 chars of sha256(body)
   *
   * @returns LicenseStatus
   * Does NOT throw -- always returns a status.
   * If git is not available -> assumes devCount = 1 -> free.
   */
  check(projectPath: string, config: NovaConfig): Promise<LicenseStatus>;
}

export interface ITelemetry {
  /**
   * Sends anonymous telemetry ping. Fire-and-forget -- never throws, never blocks.
   *
   * Payload: TelemetryPayload
   * Endpoint: POST https://cli-api.novastorm.ai/v1/telemetry
   *
   * Disabled when: NOVA_TELEMETRY=false env var is set or config.telemetry.enabled is false
   * Timeout: 3 seconds, then silently abandons
   *
   * Returns a TelemetryResponse with nudge_level if the server responds, null otherwise.
   */
  send(payload: TelemetryPayload): Promise<TelemetryResponse | null>;
}

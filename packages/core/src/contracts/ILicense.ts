import type { LicenseStatus, NovaConfig } from '../models/index.js';

export interface ILicenseChecker {
  /**
   * Checks if the current project requires a paid license.
   *
   * Logic:
   * 1. Count unique commit authors (by email) via `git log --format='%ae' | sort -u`
   * 2. If devCount <= 3 → { valid: true, tier: 'free' }
   * 3. If devCount > 3 AND NOVA_LICENSE_KEY (env or config) exists → validate key format + checksum
   * 4. If devCount > 3 AND no key → { valid: false, tier: 'company', message: "Company license required..." }
   *
   * License key format: "NOVA-{base32}-{checksum}" where checksum = first 4 chars of sha256(body)
   *
   * @returns LicenseStatus
   * Does NOT throw — always returns a status.
   * If git is not available → assumes devCount = 1 → free.
   */
  check(projectPath: string, config: NovaConfig): Promise<LicenseStatus>;
}

export interface ITelemetry {
  /**
   * Sends anonymous telemetry ping. Fire-and-forget — never throws, never blocks.
   *
   * Payload: { licenseKey: string | null, devCount: number, projectHash: string, version: string }
   * projectHash = sha256(projectPath), NOT project content
   * Endpoint: POST https://api.nova-architect.dev/telemetry
   *
   * Disabled when: NOVA_TELEMETRY=false env var is set
   * Timeout: 3 seconds, then silently abandons
   */
  send(licenseKey: string | null, devCount: number, projectPath: string): Promise<void>;
}

import * as path from 'node:path';
import * as os from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { confirm } from '@inquirer/prompts';
import TOML from '@iarna/toml';
import type { StartOptions } from './index.js';

/**
 * Resolve whether telemetry should be enabled for this run.
 *
 * Disable mechanisms (checked in order — first match wins):
 *   1. `--no-telemetry` CLI flag
 *   2. `NOVA_TELEMETRY=false` environment variable
 *   3. `[telemetry] enabled = false` in `~/.nova/config.toml`
 *   4. Prior telemetry consent in `~/.nova/config.toml`
 *
 * If no prior consent exists and the session is interactive,
 * a one-time opt-in prompt is shown (default: no).
 * In non-interactive mode the default is disabled.
 */
export async function resolveTelemetryEnabled(
  options: StartOptions,
  projectEnabled: boolean,
): Promise<boolean> {
  // ── Hard disables (earliest entry point — before any sendEvent) ───
  if (options.noTelemetry) return false;
  if (process.env['NOVA_TELEMETRY'] === 'false') return false;

  // ── User-level config: ~/.nova/config.toml ──────────────────────
  const userConfigPath = path.join(os.homedir(), '.nova', 'config.toml');

  let hasConsent = false;
  let consentValue = false;

  try {
    const raw = await readFile(userConfigPath, 'utf-8');
    const parsed = TOML.parse(raw) as unknown as Record<string, unknown>;
    const telemetry = parsed['telemetry'] as Record<string, unknown> | undefined;

    // Explicit disable in user config
    if (telemetry && telemetry['enabled'] === false) return false;

    // Check for existing consent
    if (telemetry && typeof telemetry['enabled'] === 'boolean') {
      hasConsent = true;
      consentValue = telemetry['enabled'] === true;
    }
  } catch {
    // File doesn't exist — no user-level consent yet
  }

  if (hasConsent) {
    // Prior consent exists — respect it
    return consentValue;
  }

  // ── No prior consent ────────────────────────────────────────────

  // Also check project-level config
  if (!projectEnabled) return false;

  // Non-interactive: default to disabled (no prompt)
  if (isNonInteractive(options)) {
    await saveTelemetryConsent(false);
    return false;
  }

  // Interactive first run: prompt for opt-in
  const answer = await confirm({
    message: 'Help improve Nova by sharing anonymous usage telemetry?',
    default: false,
  });

  await saveTelemetryConsent(answer);
  return answer;
}

/**
 * Get (or create) the machine identifier.
 *
 * Reads from `~/.nova/install-id`. Creates a v4 UUID via
 * `crypto.randomUUID()` if the file is missing (legacy install).
 */
export async function getMachineId(): Promise<string> {
  const installIdPath = path.join(os.homedir(), '.nova', 'install-id');
  try {
    const id = await readFile(installIdPath, 'utf-8');
    const trimmed = id.trim();
    if (trimmed) return trimmed;
  } catch {
    // File doesn't exist — create it
  }
  const id = crypto.randomUUID();
  await mkdir(path.dirname(installIdPath), { recursive: true });
  await writeFile(installIdPath, id + '\n', 'utf-8');
  return id;
}

/**
 * Persist telemetry consent to `~/.nova/config.toml`.
 */
export async function saveTelemetryConsent(enabled: boolean): Promise<void> {
  const userNovaDir = path.join(os.homedir(), '.nova');
  const userConfigPath = path.join(userNovaDir, 'config.toml');

  await mkdir(userNovaDir, { recursive: true });

  let userConfig: Record<string, unknown> = {};
  try {
    const raw = await readFile(userConfigPath, 'utf-8');
    userConfig = TOML.parse(raw);
  } catch {
    // Start fresh
  }

  userConfig['telemetry'] = { enabled };
  await writeFile(userConfigPath, TOML.stringify(userConfig as TOML.JsonMap), 'utf-8');
}

// ── Helpers ────────────────────────────────────────────────────────

function isNonInteractive(options: StartOptions): boolean {
  return process.env['NOVA_NON_INTERACTIVE'] === '1' || options.yes === true;
}

import { type ExecFileException, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Telemetry, NudgeRenderer } from '@novastorm-ai/licensing';
import type { NovaConfig, LicenseStatus } from '@novastorm-ai/core';
import { StructuredLogger } from '@novastorm-ai/core';
import { resolveTelemetryEnabled, getMachineId } from '../telemetry.js';
import type { StartOptions } from '../index.js';

const logger = new StructuredLogger({ isTTY: process.stderr?.isTTY ?? false });

/**
 * Fire-and-forget telemetry emitter for the boot sequence.
 *
 * Uses UUIDv4 install-id (from M1/F14), honours the opt-in gate, and
 * sends a single boot-ping to the telemetry backend.  Non-blocking —
 * callers should not `await` the returned promise.
 */
export async function sendBootTelemetry(
  options: StartOptions,
  config: NovaConfig,
  license: LicenseStatus,
  cwd: string,
): Promise<void> {
  const telemetryEnabled = await resolveTelemetryEnabled(options, config.telemetry.enabled);
  if (!telemetryEnabled) return;

  const machineId = await getMachineId();

  let projectHash: string;
  try {
    const remoteUrl = await new Promise<string>((resolve, reject) => {
      execFile('git', ['remote', 'get-url', 'origin'], { cwd }, (err: ExecFileException | null, stdout: string) => {
        if (err) reject(new Error(err.message));
        else resolve(stdout.trim());
      });
    });
    projectHash = createHash('sha256').update(remoteUrl).digest('hex');
  } catch {
    projectHash = createHash('sha256').update(cwd).digest('hex');
  }

  const telemetry = new Telemetry();
  const cliPkg = await import('../../package.json', { with: { type: 'json' } }).catch(() => ({
    default: { version: '0.0.1' },
  }));

  telemetry
    .send({
      machineId,
      gitAuthors90d: license.devCount,
      projectHash,
      cliVersion: cliPkg.default.version ?? '0.0.1',
      os: process.platform,
      timestamp: new Date().toISOString(),
      licenseKey: config.license?.key ?? process.env['NOVA_LICENSE_KEY'] ?? null,
    })
    .then((response) => {
      if (response && response.nudgeLevel > 0) {
        const nudgeRenderer = new NudgeRenderer();
        const nudgeMessage = nudgeRenderer.render({
          level: response.nudgeLevel,
          devCount: license.devCount,
          tier: license.tier,
          hasLicense: license.valid && license.tier !== 'free',
        });
        if (nudgeMessage) {
          logger.warn(`\n${nudgeMessage}\n`);
        }
      }
    })
    .catch(() => {}); // fire-and-forget
}

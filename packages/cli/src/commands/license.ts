import { LicenseChecker, TeamDetector } from '@novastorm-ai/licensing';
import { StructuredLogger } from '@novastorm-ai/core';
import { ConfigReader } from '../config.js';

const logger = new StructuredLogger({ isTTY: process.stderr?.isTTY ?? false });

const KEY_PATTERN = /^NOVA-([A-Z2-7]+)-([a-f0-9]{4})$/;
const VALIDATE_ENDPOINT = 'https://cli-api.novastorm.ai/v1/license/validate';
const TIMEOUT_MS = 5_000;

export async function licenseCommand(
  subcommand?: string,
  key?: string,
): Promise<void> {
  const cwd = process.cwd();
  const configReader = new ConfigReader();
  const config = await configReader.read(cwd);

  if (!subcommand || subcommand === 'status') {
    await showStatus(cwd, config);
  } else if (subcommand === 'activate') {
    if (!key) {
      logger.error('Usage: nova license activate <key>');
      process.exit(1);
    }
    await activateKey(cwd, configReader, key);
  } else {
    logger.error(`Unknown subcommand: ${subcommand}`);
    logger.info('Usage: nova license [status|activate <key>]');
    process.exit(1);
  }
}

async function showStatus(
  cwd: string,
  config: import('@novastorm-ai/core').NovaConfig,
): Promise<void> {
  const licenseChecker = new LicenseChecker();
  const teamDetector = new TeamDetector();

  const [license, teamInfo] = await Promise.all([
    licenseChecker.check(cwd, config),
    teamDetector.detect(cwd),
  ]);

  const configKey = config.license?.key;
  const envKey = process.env['NOVA_LICENSE_KEY'];
  const activeKey = configKey ?? envKey ?? null;

  logger.info('\nNovastorm License Status\n');
  logger.info(`  Tier:           ${license.tier}`);
  logger.info(`  Valid:          ${license.valid ? 'yes' : 'no'}`);
  logger.info(`  Developers:     ${String(teamInfo.devCount)} (${teamInfo.windowDays}-day window)`);
  logger.info(`  Bots filtered:  ${String(teamInfo.botsFiltered)}`);
  logger.info(`  License key:    ${activeKey ? 'configured' : 'not set'}`);
  if (activeKey) {
    const source = configKey ? 'config (nova.toml)' : 'environment (NOVA_LICENSE_KEY)';
    logger.info(`  Key source:     ${source}`);
  }
  if (license.message) {
    logger.warn(`\n  ${license.message}`);
  }
  logger.info('');
}

async function activateKey(
  cwd: string,
  configReader: ConfigReader,
  key: string,
): Promise<void> {
  // Validate format locally
  if (!KEY_PATTERN.test(key)) {
    logger.error('Invalid key format. Expected: NOVA-{BASE32}-{CHECKSUM}');
    process.exit(1);
  }

  // Try to validate with server
  logger.debug('Validating license key...');
  let serverValid = true;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(VALIDATE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
        signal: controller.signal,
      });
      if (response.ok) {
        const data = (await response.json()) as { valid?: boolean };
        serverValid = data.valid !== false;
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Server unreachable -- accept key based on local format validation
    logger.debug('Server unreachable, accepting key based on local validation.');
  }

  if (!serverValid) {
    logger.error('License key rejected by server.');
    process.exit(1);
  }

  // Read existing config, add license key, write back
  const config = await configReader.read(cwd);
  await configReader.write(cwd, {
    ...config,
    license: { key },
  });

  logger.info('License key activated and saved to nova.toml.');
}

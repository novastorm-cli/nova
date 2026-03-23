import chalk from 'chalk';
import { LicenseChecker, TeamDetector } from '@novastorm-ai/licensing';
import { ConfigReader } from '../config.js';

const KEY_PATTERN = /^NOVA-([A-Z2-7]+)-([a-f0-9]{4})$/;
const VALIDATE_ENDPOINT = 'https://api.nova-architect.dev/v1/license/validate';
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
      console.error(chalk.red('Usage: nova license activate <key>'));
      process.exit(1);
    }
    await activateKey(cwd, configReader, key);
  } else {
    console.error(chalk.red(`Unknown subcommand: ${subcommand}`));
    console.log('Usage: nova license [status|activate <key>]');
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

  console.log(chalk.bold('\nNova Architect License Status\n'));
  console.log(`  Tier:           ${chalk.cyan(license.tier)}`);
  console.log(`  Valid:          ${license.valid ? chalk.green('yes') : chalk.red('no')}`);
  console.log(`  Developers:     ${chalk.cyan(String(teamInfo.devCount))} (${teamInfo.windowDays}-day window)`);
  console.log(`  Bots filtered:  ${chalk.dim(String(teamInfo.botsFiltered))}`);
  console.log(`  License key:    ${activeKey ? chalk.green('configured') : chalk.dim('not set')}`);
  if (activeKey) {
    const source = configKey ? 'config (nova.toml)' : 'environment (NOVA_LICENSE_KEY)';
    console.log(`  Key source:     ${chalk.dim(source)}`);
  }
  if (license.message) {
    console.log(`\n  ${chalk.yellow(license.message)}`);
  }
  console.log('');
}

async function activateKey(
  cwd: string,
  configReader: ConfigReader,
  key: string,
): Promise<void> {
  // Validate format locally
  if (!KEY_PATTERN.test(key)) {
    console.error(chalk.red('Invalid key format. Expected: NOVA-{BASE32}-{CHECKSUM}'));
    process.exit(1);
  }

  // Try to validate with server
  console.log(chalk.dim('Validating license key...'));
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
    console.log(chalk.dim('Server unreachable, accepting key based on local validation.'));
  }

  if (!serverValid) {
    console.error(chalk.red('License key rejected by server.'));
    process.exit(1);
  }

  // Read existing config, add license key, write back
  const config = await configReader.read(cwd);
  await configReader.write(cwd, {
    ...config,
    license: { key },
  });

  console.log(chalk.green('License key activated and saved to nova.toml.'));
}

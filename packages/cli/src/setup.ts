import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { select, password, confirm } from '@inquirer/prompts';
import TOML from '@iarna/toml';
import { ConfigReader } from './config.js';
import {
  DEFAULT_CONFIG,
  ProviderFactory,
  StructuredLogger,
  type NovaConfig,
} from '@novastorm-ai/core';
import { doctorCommand } from './commands/doctor.js';

const logger = new StructuredLogger({ isTTY: process.stderr?.isTTY ?? false });

const NOVA_DIR = '.nova';
const LOCAL_CONFIG = 'config.toml';

/** Get user-level Nova directory: ~/.nova */
function getUserNovaDir(): string {
  return path.join(os.homedir(), '.nova');
}
function getUserConfigPath(): string {
  return path.join(getUserNovaDir(), 'config.toml');
}
function getInstallIdPath(): string {
  return path.join(getUserNovaDir(), 'install-id');
}

type Provider = NovaConfig['apiKeys']['provider'];

/** Non-local providers that require API key validation. */
const NON_LOCAL_PROVIDERS: ReadonlySet<Provider> = new Set([
  'anthropic',
  'openai',
  'openrouter',
  'deepseek',
]);

/** Remedy URLs shown when key validation fails. */
const REMEDY_URLS: Record<string, string> = {
  deepseek: 'https://platform.deepseek.com/api_keys',
  anthropic: 'https://console.anthropic.com/',
  openai: 'https://platform.openai.com/api-keys',
  openrouter: 'https://openrouter.ai/keys',
};

export interface SetupOptions {
  /** If true, skip all interactive prompts and use safe defaults. */
  nonInteractive?: boolean;
}

/**
 * Check if the process is running in non-interactive mode.
 */
function isNonInteractive(opts: SetupOptions): boolean {
  return process.env['NOVA_NON_INTERACTIVE'] === '1' || opts.nonInteractive === true;
}

// ── TOML serialisation helper ────────────────────────────────────────────

function tomlStringify(obj: Record<string, unknown>): string {
  return TOML.stringify(obj as TOML.JsonMap);
}

/**
 * Build a simple local config object for the project .nova/config.toml.
 */
function buildLocalConfig(
  provider: string,
  apiKey?: string,
): Record<string, Record<string, string>> {
  const cfg: Record<string, Record<string, string>> = {
    apiKeys: { provider },
  };
  if (apiKey) {
    cfg['apiKeys']!['key'] = apiKey;
  }
  return cfg;
}

// ── Install ID ──────────────────────────────────────────────────────────

/**
 * Generate (if missing) and return the install-id (v4 UUID).
 * The file lives at ~/.nova/install-id.
 */
async function ensureInstallId(): Promise<string> {
  await fs.mkdir(getUserNovaDir(), { recursive: true });
  try {
    const existing = await fs.readFile(getInstallIdPath(), 'utf-8');
    const trimmed = existing.trim();
    if (trimmed.length > 0) return trimmed;
  } catch {
    // File doesn't exist — create it
  }
  const id = crypto.randomUUID();
  await fs.writeFile(getInstallIdPath(), id + '\n', 'utf-8');
  return id;
}

// ── Telemetry ───────────────────────────────────────────────────────────

/**
 * Prompt for telemetry opt-in exactly once (when no prior consent exists).
 */
async function promptTelemetry(): Promise<void> {
  await fs.mkdir(getUserNovaDir(), { recursive: true });

  // Check for existing telemetry setting in ~/.nova/config.toml
  let hasExisting = false;
  try {
    const raw = await fs.readFile(getUserConfigPath(), 'utf-8');
    const parsed = TOML.parse(raw) as Record<string, unknown>;
    if (parsed['telemetry'] && typeof parsed['telemetry'] === 'object') {
      hasExisting = true;
    }
  } catch {
    // File doesn't exist or can't be parsed — proceed with prompt
  }

  if (hasExisting) return;

  const answer = await confirm({
    message: 'Help improve Nova by sharing anonymous usage telemetry?',
    default: false,
  });

  // Read or create user config
  const userConfig = await readUserConfig();
  userConfig['telemetry'] = { enabled: answer };

  await fs.writeFile(getUserConfigPath(), tomlStringify(userConfig), {
    encoding: 'utf-8',
    mode: 0o600,
  });
}

async function readUserConfig(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(getUserConfigPath(), 'utf-8');
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    return TOML.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeUserConfig(cfg: Record<string, unknown>): Promise<void> {
  await fs.writeFile(getUserConfigPath(), tomlStringify(cfg), 'utf-8');
}

// ── Key validation ──────────────────────────────────────────────────────

/**
 * Validate a provider API key with a 1-token chat.
 * Returns true if the key is valid, false otherwise.
 */
async function validateApiKey(provider: Provider, apiKey: string): Promise<boolean> {
  try {
    const factory = new ProviderFactory();
    const client = factory.create(provider, apiKey);
    await client.chat([{ role: 'user', content: 'say ok' }], { maxTokens: 1 });
    return true;
  } catch {
    return false;
  }
}

// ── Main setup entry point ──────────────────────────────────────────────

/**
 * Interactive first-run setup.
 *
 * 1. Asks for provider (including deepseek)
 * 2. For non-local providers: collects + validates the API key
 * 3. Generates ~/.nova/install-id (v4 UUID via crypto.randomUUID())
 * 4. Prompts for telemetry opt-in once
 * 5. Saves config and prints next-step hint
 *
 * @param projectPath - path to the project directory (defaults to cwd)
 * @param opts - setup options
 */
export async function runSetup(
  projectPath?: string,
  opts: SetupOptions = {},
): Promise<void> {
  const cwd = projectPath ?? process.cwd();
  const nonInteractive = isNonInteractive(opts);

  // ── Non-interactive path ──────────────────────────────────────────
  if (nonInteractive) {
    logger.debug('Non-interactive mode -- using default provider (ollama).');
    const provider: Provider = 'ollama';

    const novaDir = path.join(cwd, NOVA_DIR);
    await fs.mkdir(novaDir, { recursive: true });

    const localConfigPath = path.join(novaDir, LOCAL_CONFIG);
    await fs.writeFile(
      localConfigPath,
      tomlStringify(buildLocalConfig(provider)),
      { encoding: 'utf-8', mode: 0o600 },
    );
    logger.debug(`Saved ${provider} config to ${localConfigPath}`);

    const configReader = new ConfigReader();
    const exists = await configReader.exists(cwd);
    if (!exists) {
      await configReader.write(cwd, DEFAULT_CONFIG);
      logger.debug(`Created ${path.join(cwd, 'nova.toml')} with default configuration.`);
    }

    // Install-id + telemetry for non-interactive
    await ensureInstallId();
    // In non-interactive, don't prompt — just set telemetry to off
    await ensureTelemetryOff();

    logger.debug('\nSetup complete (non-interactive).');
    logger.debug("Next step: cd into a project and run 'nova'");

    logger.debug('\nRunning diagnostics...');
    await doctorCommand({ cwd });
    return;
  }

  // ── Interactive path ──────────────────────────────────────────────
  logger.info('Welcome to Novastorm setup!\n');

  let provider: Provider;
  let apiKey: string | undefined;

  try {
    // ── Step 1: Select provider ─────────────────────────────────────
    provider = await select<Provider>({
      message: 'Select your AI provider:',
      choices: [
        {
          name: 'Claude CLI (uses your Claude Max/Pro subscription)',
          value: 'claude-cli' as const,
        },
        {
          name: 'OpenRouter (recommended -- access to all models)',
          value: 'openrouter' as const,
        },
        { name: 'Anthropic', value: 'anthropic' as const },
        { name: 'OpenAI', value: 'openai' as const },
        { name: 'DeepSeek', value: 'deepseek' as const },
        { name: 'Ollama (free, local)', value: 'ollama' as const },
      ],
    });

    logger.info(`Selected provider: ${provider}`);

    // ── Step 2: Collect & validate API key (non-local only) ─────────
    if (NON_LOCAL_PROVIDERS.has(provider)) {
      apiKey = await collectAndValidateKey(provider);
    }
  } catch {
    // User pressed Ctrl+C during prompts
    logger.info('\nSetup cancelled.');
    return;
  }

  // ── Step 3: Save project-level config ─────────────────────────────
  const novaDir = path.join(cwd, NOVA_DIR);
  await fs.mkdir(novaDir, { recursive: true });

  const localConfigPath = path.join(novaDir, LOCAL_CONFIG);
  await fs.writeFile(
    localConfigPath,
    tomlStringify(buildLocalConfig(provider, apiKey)),
    { encoding: 'utf-8', mode: 0o600 },
  );
  logger.info(`\nSaved provider config to ${localConfigPath}`);

  // Create nova.toml if it doesn't exist
  const configReader = new ConfigReader();
  const exists = await configReader.exists(cwd);
  if (!exists) {
    await configReader.write(cwd, DEFAULT_CONFIG);
    logger.info(`Created ${path.join(cwd, 'nova.toml')} with default configuration.`);
  }

  // ── Step 4: Install ID + Telemetry ────────────────────────────────
  await ensureInstallId();
  await promptTelemetry();

  // ── Step 5: Done ──────────────────────────────────────────────────
  logger.info('\nSetup complete!');
  logger.debug("\nNext step: cd into a project and run 'nova'");

  // Auto-run doctor for immediate feedback
  logger.debug('\nRunning diagnostics...');
  await doctorCommand({ cwd });
}

// ── Key collection loop ─────────────────────────────────────────────────

/**
 * Collect an API key for a non-local provider, validate it with a 1-token
 * chat, and loop until the user enters a valid key or chooses to skip.
 */
async function collectAndValidateKey(provider: Provider): Promise<string | undefined> {
  const remedyUrl = REMEDY_URLS[provider] ?? '';

  for (;;) {
    const key = await password({
      message: `Enter your ${provider} API key:`,
      mask: '*',
    });

    // Empty key — reject
    if (!key || key.trim().length === 0) {
      logger.warn(
        `An API key is required for ${provider}. Please enter a valid key or cancel (Ctrl+C).`,
      );
      continue;
    }

    // Validate
    logger.debug('Validating API key...');
    const valid = await validateApiKey(provider, key.trim());

    if (valid) {
      logger.info('  Provider verified');
      return key.trim();
    }

    // Invalid — show remedy and offer retry/skip
    logger.error(`  Invalid API key for ${provider}.`);
    if (remedyUrl) {
      logger.debug(`  Get a valid key at: ${remedyUrl}`);
    }

    const retry = await confirm({
      message: 'Would you like to try again?',
      default: true,
    });

    if (!retry) {
      logger.warn(
        `  Skipping key validation for ${provider}. You can set the key later in .nova/config.toml`,
      );
      return undefined;
    }
  }
}

// ── Non-interactive telemetry default ───────────────────────────────────

/**
 * Ensure telemetry is disabled in ~/.nova/config.toml when in
 * non-interactive mode (don't prompt).
 */
async function ensureTelemetryOff(): Promise<void> {
  await fs.mkdir(getUserNovaDir(), { recursive: true });

  const userConfig = await readUserConfig();

  // Only write if not already present
  if (userConfig['telemetry'] === undefined) {
    userConfig['telemetry'] = { enabled: false };
    await writeUserConfig(userConfig);
  }
}

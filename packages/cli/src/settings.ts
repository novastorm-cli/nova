import chalk from 'chalk';
import type { NovaConfig } from '@novastorm-ai/core';
import type { ConfigReader } from './config.js';

type SettablePath = {
  path: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'string[]';
  options?: string[];
  secret?: boolean;
};

const SETTABLE_FIELDS: SettablePath[] = [
  { path: 'apiKeys.provider', description: 'LLM provider', type: 'string', options: ['openrouter', 'anthropic', 'openai', 'ollama', 'claude-cli'] },
  { path: 'apiKeys.key', description: 'API key (saved to .nova/config.toml)', type: 'string', secret: true },
  { path: 'models.fast', description: 'Fast model', type: 'string' },
  { path: 'models.strong', description: 'Strong model', type: 'string' },
  { path: 'models.local', description: 'Use local models', type: 'boolean' },
  { path: 'project.devCommand', description: 'Dev command', type: 'string' },
  { path: 'project.port', description: 'Dev server port', type: 'number' },
  { path: 'project.frontend', description: 'Frontend directory', type: 'string' },
  { path: 'project.backends', description: 'Backend directories', type: 'string[]' },
  { path: 'behavior.autoCommit', description: 'Auto-commit changes', type: 'boolean' },
  { path: 'behavior.branchPrefix', description: 'Git branch prefix', type: 'string' },
  { path: 'behavior.passiveSuggestions', description: 'Passive suggestions', type: 'boolean' },
  { path: 'voice.enabled', description: 'Voice enabled', type: 'boolean' },
  { path: 'voice.engine', description: 'Voice engine', type: 'string', options: ['web', 'whisper'] },
  { path: 'telemetry.enabled', description: 'Telemetry enabled', type: 'boolean' },
];

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

export function formatSettings(config: NovaConfig): string {
  const lines: string[] = [chalk.bold('\nNova Settings\n')];

  let lastSection = '';
  for (const field of SETTABLE_FIELDS) {
    const section = field.path.split('.')[0];
    if (section !== lastSection) {
      lines.push(chalk.dim(`  [${section}]`));
      lastSection = section;
    }

    const value = getNestedValue(config as unknown as Record<string, unknown>, field.path);
    const displayValue = value === undefined ? chalk.dim('(not set)')
      : typeof value === 'string' && field.path.includes('key') && value.length > 8
        ? chalk.yellow(value.slice(0, 4) + '...' + value.slice(-4))
        : chalk.green(JSON.stringify(value));

    lines.push(`  ${chalk.cyan(field.path.padEnd(28))} ${displayValue}  ${chalk.dim(field.description)}`);

    if (field.options) {
      lines.push(`  ${''.padEnd(28)} ${chalk.dim(`options: ${field.options.join(', ')}`)}`);
    }
  }

  lines.push('');
  lines.push(chalk.dim('  Usage: /settings <key> <value>'));
  lines.push(chalk.dim('  Example: /settings apiKeys.provider ollama'));
  lines.push(chalk.dim('  Example: /settings models.fast claude-sonnet-4-6'));
  lines.push('');

  return lines.join('\n');
}

export async function handleSettingsCommand(
  args: string,
  config: NovaConfig,
  configReader: ConfigReader,
  cwd: string,
): Promise<string> {
  // No args — show all settings
  if (!args) {
    return formatSettings(config);
  }

  // Parse: /settings key value
  const parts = args.split(/\s+/);
  const key = parts[0];
  const valueStr = parts.slice(1).join(' ');

  if (!valueStr) {
    // Show single setting
    const value = getNestedValue(config as unknown as Record<string, unknown>, key);
    if (value === undefined) {
      return chalk.red(`Unknown setting: ${key}`);
    }
    return `${chalk.cyan(key)} = ${chalk.green(JSON.stringify(value))}`;
  }

  // Find field definition
  const field = SETTABLE_FIELDS.find((f) => f.path === key);
  if (!field) {
    return chalk.red(`Unknown setting: ${key}\nAvailable: ${SETTABLE_FIELDS.map(f => f.path).join(', ')}`);
  }

  // Validate options
  if (field.options && !field.options.includes(valueStr)) {
    return chalk.red(`Invalid value for ${key}. Options: ${field.options.join(', ')}`);
  }

  // Parse value by type
  let parsedValue: unknown;
  switch (field.type) {
    case 'number': {
      parsedValue = parseInt(valueStr, 10);
      if (isNaN(parsedValue as number)) {
        return chalk.red(`Invalid number: ${valueStr}`);
      }
      break;
    }
    case 'boolean': {
      if (['true', '1', 'yes', 'on'].includes(valueStr.toLowerCase())) {
        parsedValue = true;
      } else if (['false', '0', 'no', 'off'].includes(valueStr.toLowerCase())) {
        parsedValue = false;
      } else {
        return chalk.red(`Invalid boolean: ${valueStr}. Use true/false`);
      }
      break;
    }
    case 'string[]': {
      parsedValue = valueStr.split(',').map((s) => s.trim());
      break;
    }
    default:
      parsedValue = valueStr;
  }

  // Apply to config in memory
  setNestedValue(config as unknown as Record<string, unknown>, key, parsedValue);

  // Save: secret fields go to .nova/config.toml, rest to nova.toml
  try {
    if (field.secret) {
      // Build partial config with only the secret field
      const secretConfig: Record<string, unknown> = {};
      setNestedValue(secretConfig, key, parsedValue);
      await configReader.writeLocal(cwd, secretConfig as Partial<NovaConfig>);
      return chalk.green(`${key} = ${JSON.stringify(parsedValue).slice(0, 4)}... (saved to .nova/config.toml)`);
    }
    await configReader.write(cwd, config);
    return chalk.green(`${key} = ${JSON.stringify(parsedValue)} (saved to nova.toml)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return chalk.red(`Failed to save: ${msg}`);
  }
}

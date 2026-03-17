import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { select, password } from '@inquirer/prompts';
import TOML from '@iarna/toml';
import { ConfigReader } from './config.js';
import { DEFAULT_CONFIG, type NovaConfig } from '@nova-architect/core';

const NOVA_DIR = '.nova';
const LOCAL_CONFIG = 'config.toml';

type Provider = NovaConfig['apiKeys']['provider'];

/**
 * Interactive first-run setup.
 * Asks the user for their preferred provider and API key,
 * saves credentials to .nova/config.toml, and creates nova.toml if missing.
 */
export async function runSetup(projectPath?: string): Promise<void> {
  const cwd = projectPath ?? process.cwd();

  console.log('Welcome to Nova Architect setup!\n');

  let provider: Provider;
  let apiKey: string | undefined;

  try {
    provider = await select<Provider>({
      message: 'Select your AI provider:',
      choices: [
        { name: 'Claude CLI (uses your Claude Max/Pro subscription)', value: 'claude-cli' as const },
        { name: 'OpenRouter (recommended — access to all models)', value: 'openrouter' as const },
        { name: 'Anthropic', value: 'anthropic' as const },
        { name: 'OpenAI', value: 'openai' as const },
        { name: 'Ollama (free, local)', value: 'ollama' as const },
      ],
    });

    console.log(`Selected provider: ${provider}`);

    if (provider !== 'ollama' && provider !== 'claude-cli') {
      apiKey = await password({
        message: `Enter your ${provider} API key:`,
        mask: '*',
      });
      if (!apiKey || apiKey.trim().length === 0) {
        console.log('No API key provided. You can set it later in .nova/config.toml');
        apiKey = undefined;
      }
    }
  } catch {
    // User pressed Ctrl+C during prompts
    console.log('\nSetup cancelled.');
    return;
  }

  // Ensure .nova directory exists
  const novaDir = path.join(cwd, NOVA_DIR);
  await fs.mkdir(novaDir, { recursive: true });

  // Build local config TOML
  const localConfig: Record<string, Record<string, string>> = {
    apiKeys: { provider },
  };
  if (apiKey) {
    localConfig['apiKeys']!['key'] = apiKey;
  }

  const localConfigPath = path.join(novaDir, LOCAL_CONFIG);
  await fs.writeFile(localConfigPath, TOML.stringify(localConfig as unknown as TOML.JsonMap), 'utf-8');
  console.log(`\nSaved provider config to ${localConfigPath}`);

  // Create nova.toml if it doesn't exist
  const configReader = new ConfigReader();
  const exists = await configReader.exists(cwd);
  if (!exists) {
    await configReader.write(cwd, DEFAULT_CONFIG);
    console.log(`Created ${path.join(cwd, 'nova.toml')} with default configuration.`);
  }

  console.log('\nSetup complete!');
}

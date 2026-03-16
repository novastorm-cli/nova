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

  const provider = await select<Provider>({
    message: 'Select your AI provider:',
    choices: [
      { name: 'OpenRouter (recommended — access to all models)', value: 'openrouter' },
      { name: 'Anthropic', value: 'anthropic' },
      { name: 'OpenAI', value: 'openai' },
      { name: 'Ollama (free, local)', value: 'ollama' },
    ],
  });

  let apiKey: string | undefined;
  if (provider !== 'ollama') {
    apiKey = await password({
      message: `Enter your ${provider} API key:`,
      mask: '*',
      validate: (input: string) =>
        input.trim().length > 0 || 'API key is required.',
    });
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

import * as path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ConfigReader } from '../config.js';
import { DEFAULT_CONFIG, type NovaConfig } from '@novastorm-ai/core';

export async function initCommand(): Promise<void> {
  const cwd = process.cwd();
  const configReader = new ConfigReader();

  const exists = await configReader.exists(cwd);
  if (exists) {
    console.log('nova.toml already exists in this directory.');
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  const config: Partial<NovaConfig> = { ...DEFAULT_CONFIG };

  try {
    const frontend = await rl.question('Where is your frontend? (default: ./) ');
    const frontendPath = frontend.trim() || undefined;
    if (frontendPath && frontendPath !== './') {
      config.project = { ...config.project!, frontend: frontendPath };
    }

    const backendsInput = await rl.question('Do you have backend services? Specify paths separated by commas (leave empty to skip): ');
    const backendsRaw = backendsInput.trim();
    if (backendsRaw) {
      const backends = backendsRaw.split(',').map(s => s.trim()).filter(Boolean);
      if (backends.length > 0) {
        config.project = { ...config.project!, backends };
      }
    }
  } finally {
    rl.close();
  }

  await configReader.write(cwd, config);
  console.log(`Created ${path.join(cwd, 'nova.toml')} with default configuration.`);
}

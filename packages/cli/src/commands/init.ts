import * as path from 'node:path';
import { ConfigReader } from '../config.js';
import { DEFAULT_CONFIG } from '@nova-architect/core';

export async function initCommand(): Promise<void> {
  const cwd = process.cwd();
  const configReader = new ConfigReader();

  const exists = await configReader.exists(cwd);
  if (exists) {
    console.log('nova.toml already exists in this directory.');
    return;
  }

  await configReader.write(cwd, DEFAULT_CONFIG);
  console.log(`Created ${path.join(cwd, 'nova.toml')} with default configuration.`);
}

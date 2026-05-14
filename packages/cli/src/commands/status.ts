import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { StructuredLogger } from '@novastorm-ai/core';
import { ConfigReader } from '../config.js';

const logger = new StructuredLogger({ isTTY: process.stderr?.isTTY ?? false });

export async function statusCommand(): Promise<void> {
  const cwd = process.cwd();
  const configReader = new ConfigReader();

  const exists = await configReader.exists(cwd);
  if (!exists) {
    logger.info('No nova.toml found. Run "nova init" to create one.');
    return;
  }

  const config = await configReader.read(cwd);

  logger.info('--- Novastorm Status ---');
  logger.info('');
  logger.info(`Stack:    provider=${config.apiKeys.provider}, micro=${config.models.micro}, standard=${config.models.standard}, strong=${config.models.strong}`);
  logger.info(`Port:     ${config.project.port}`);
  logger.info(`Dev cmd:  ${config.project.devCommand || '(not set)'}`);
  logger.info('');

  // Check .nova/ directory for index and tasks
  const novaDir = path.join(cwd, '.nova');
  let indexStatus = 'not created';
  let pendingTasks = 'none';

  try {
    await fs.stat(path.join(novaDir, 'index.json'));
    indexStatus = 'exists';
  } catch {
    // index not created yet
  }

  try {
    const tasksRaw = await fs.readFile(path.join(novaDir, 'tasks.json'), 'utf-8');
    const tasks = JSON.parse(tasksRaw) as Array<{ status: string }>;
    const pending = tasks.filter((t) => t.status === 'pending');
    pendingTasks = pending.length > 0 ? `${pending.length} pending` : 'none';
  } catch {
    // tasks file doesn't exist yet
  }

  logger.info(`Index:    ${indexStatus}`);
  logger.info(`Tasks:    ${pendingTasks}`);
}

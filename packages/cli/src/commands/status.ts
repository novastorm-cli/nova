import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ConfigReader } from '../config.js';

export async function statusCommand(): Promise<void> {
  const cwd = process.cwd();
  const configReader = new ConfigReader();

  const exists = await configReader.exists(cwd);
  if (!exists) {
    console.log('No nova.toml found. Run "nova init" to create one.');
    return;
  }

  const config = await configReader.read(cwd);

  console.log('--- Nova Architect Status ---');
  console.log('');
  console.log(`Stack:    provider=${config.apiKeys.provider}, fast=${config.models.fast}, strong=${config.models.strong}`);
  console.log(`Port:     ${config.project.port}`);
  console.log(`Dev cmd:  ${config.project.devCommand || '(not set)'}`);
  console.log('');

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

  console.log(`Index:    ${indexStatus}`);
  console.log(`Tasks:    ${pendingTasks}`);
}

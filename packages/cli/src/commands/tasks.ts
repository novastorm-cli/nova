import { DEPRECATION } from '../strings.js';

export async function tasksCommand(): Promise<void> {
  console.error(DEPRECATION.removedCommands.tasks);
  process.exit(2);
}

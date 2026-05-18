import { DEPRECATION } from '../strings.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function tasksCommand(): Promise<void> {
  console.error(DEPRECATION.removedCommands.tasks);
  process.exit(2);
}

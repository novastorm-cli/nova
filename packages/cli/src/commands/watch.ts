import { DEPRECATION } from '../strings.js';

export async function watchCommand(): Promise<void> {
  console.error(DEPRECATION.removedCommands.watch);
  process.exit(2);
}

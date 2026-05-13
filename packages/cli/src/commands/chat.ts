import { DEPRECATION } from '../strings.js';

export async function chatCommand(): Promise<void> {
  console.error(DEPRECATION.removedCommands.chat);
  process.exit(2);
}

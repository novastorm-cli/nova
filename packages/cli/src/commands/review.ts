import { DEPRECATION } from '../strings.js';

export async function reviewCommand(): Promise<void> {
  console.error(DEPRECATION.removedCommands.review);
  process.exit(2);
}

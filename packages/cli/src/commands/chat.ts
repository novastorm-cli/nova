import { DEPRECATION } from '../strings.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function chatCommand(): Promise<void> {
  console.error(DEPRECATION.removedCommands.chat);
  process.exit(2);
}

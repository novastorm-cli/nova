import { DEPRECATION } from '../strings.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function reviewCommand(): Promise<void> {
  console.error(DEPRECATION.removedCommands.review);
  process.exit(2);
}

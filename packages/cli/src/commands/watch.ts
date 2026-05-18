import { DEPRECATION } from '../strings.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function watchCommand(): Promise<void> {
  console.error(DEPRECATION.removedCommands.watch);
  process.exit(2);
}

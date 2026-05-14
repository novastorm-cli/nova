import type { ILogger } from '@novastorm-ai/core';
import { StructuredLogger } from '@novastorm-ai/core';
import open from 'open';

/**
 * Cross-platform browser opener.
 *
 * Uses the `open` npm package which honours the `$BROWSER` environment
 * variable on all platforms.  Respects `--no-open` (skips entirely).
 */
export async function openBrowser(
  url: string,
  options: { noOpen?: boolean; logger?: ILogger } = {},
): Promise<void> {
  const logger = options.logger ?? new StructuredLogger({ isTTY: process.stderr?.isTTY ?? false });

  if (options.noOpen) {
    logger.debug(`Proxy ready at ${url} (browser not opened: --no-open)`);
    return;
  }

  logger.debug('Opening browser...');

  try {
    // `open` honours $BROWSER, falls back to the OS default
    await open(url);
  } catch {
    // Best-effort — don't fail startup if the browser can't open
    logger.debug(`Could not open browser. Visit ${url} manually.`);
  }
}

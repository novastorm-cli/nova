import chalk from 'chalk';
import open from 'open';

/**
 * Cross-platform browser opener.
 *
 * Uses the `open` npm package which honours the `$BROWSER` environment
 * variable on all platforms.  Respects `--no-open` (skips entirely).
 */
export async function openBrowser(
  url: string,
  options: { noOpen?: boolean } = {},
): Promise<void> {
  if (options.noOpen) {
    console.log(
      chalk.dim(`Proxy ready at ${chalk.green(url)} (browser not opened: --no-open)`),
    );
    return;
  }

  console.log(chalk.dim('Opening browser...'));

  try {
    // `open` honours $BROWSER, falls back to the OS default
    await open(url);
  } catch {
    // Best-effort — don't fail startup if the browser can't open
    console.log(chalk.dim(`Could not open browser. Visit ${chalk.green(url)} manually.`));
  }
}

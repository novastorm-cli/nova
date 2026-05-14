import type { StartOptions } from '../index.js';

/**
 * Check if the process is running in non-interactive mode.
 * Non-interactive means: NOVA_NON_INTERACTIVE=1 or --yes flag.
 */
export function isNonInteractive(options: StartOptions): boolean {
  return process.env['NOVA_NON_INTERACTIVE'] === '1' || options.yes === true;
}

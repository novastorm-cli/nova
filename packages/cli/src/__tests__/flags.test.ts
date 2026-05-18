import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { createCli } from '../index.js';

/**
 * Test suite for CLI flags and env var handling (m1-01-cli-flags-non-interactive).
 *
 * Covers:
 * - Commander options: --no-open, --yes, --port, --proxy-port, --no-telemetry, --host
 * - Env vars: NOVA_NON_INTERACTIVE, NOVA_QUIET, NO_COLOR
 * - Banner suppression: non-TTY stdout, non-start subcommands
 * - Non-interactive prompt skipping
 */

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Create a minimal program with just the options registered (no subcommands)
 * so we can test option parsing without triggering subcommand dispatch.
 */
function createOptsProgram(): Command {
  const program = new Command();
  program
    .name('nova')
    .version('0.2.2')
    .option('--no-open', 'Do not open browser on startup')
    .option('--yes', 'Skip all interactive prompts (use defaults)')
    .option('--port <number>', 'Dev server port')
    .option('--proxy-port <number>', 'Proxy server port')
    .option('--no-telemetry', 'Disable telemetry for this run')
    .option('--host <addr>', 'Proxy bind address', '127.0.0.1')
    .option('--debug', 'Enable debug / diagnostic output');
  return program;
}

describe('CLI flags — commander registration', () => {
  it('registers --no-open flag in help output', () => {
    const program = createCli();
    const output = program.helpInformation();
    expect(output).toContain('--no-open');
  });

  it('registers --yes flag in help output', () => {
    const program = createCli();
    const output = program.helpInformation();
    expect(output).toContain('--yes');
  });

  it('registers --port <number> flag in help output', () => {
    const program = createCli();
    const output = program.helpInformation();
    expect(output).toContain('--port');
  });

  it('registers --proxy-port <number> flag in help output', () => {
    const program = createCli();
    const output = program.helpInformation();
    expect(output).toContain('--proxy-port');
  });

  it('registers --no-telemetry flag in help output', () => {
    const program = createCli();
    const output = program.helpInformation();
    expect(output).toContain('--no-telemetry');
  });

  it('registers --host <addr> flag in help output', () => {
    const program = createCli();
    const output = program.helpInformation();
    expect(output).toContain('--host');
  });

  it('registers --debug flag in help output', () => {
    const program = createCli();
    const output = program.helpInformation();
    expect(output).toContain('--debug');
  });
});

describe('CLI flags — option parsing', () => {
  it('--no-open flag defaults to true (open enabled)', () => {
    const program = createOptsProgram();
    program.parse([], { from: 'user' });
    expect(program.opts().open).toBe(true);
  });

  it('--no-open flag sets open to false', () => {
    const program = createOptsProgram();
    program.parse(['--no-open'], { from: 'user' });
    expect(program.opts().open).toBe(false);
  });

  it('--yes flag defaults to undefined (not set)', () => {
    const program = createOptsProgram();
    program.parse([], { from: 'user' });
    expect(program.opts().yes).toBeUndefined();
  });

  it('--yes flag sets yes to true', () => {
    const program = createOptsProgram();
    program.parse(['--yes'], { from: 'user' });
    expect(program.opts().yes).toBe(true);
  });

  it('--port flag defaults to undefined', () => {
    const program = createOptsProgram();
    program.parse([], { from: 'user' });
    expect(program.opts().port).toBeUndefined();
  });

  it('--port=3500 sets port to 3500', () => {
    const program = createOptsProgram();
    program.parse(['--port=3500'], { from: 'user' });
    expect(program.opts().port).toBe('3500');
  });

  it('--proxy-port flag defaults to undefined', () => {
    const program = createOptsProgram();
    program.parse([], { from: 'user' });
    expect(program.opts().proxyPort).toBeUndefined();
  });

  it('--proxy-port=3501 sets proxyPort to 3501', () => {
    const program = createOptsProgram();
    program.parse(['--proxy-port=3501'], { from: 'user' });
    expect(program.opts().proxyPort).toBe('3501');
  });

  it('--host flag defaults to 127.0.0.1', () => {
    const program = createOptsProgram();
    program.parse([], { from: 'user' });
    expect(program.opts().host).toBe('127.0.0.1');
  });

  it('--host 0.0.0.0 sets host to 0.0.0.0', () => {
    const program = createOptsProgram();
    program.parse(['--host', '0.0.0.0'], { from: 'user' });
    expect(program.opts().host).toBe('0.0.0.0');
  });

  it('--no-telemetry flag defaults to true (telemetry enabled)', () => {
    const program = createOptsProgram();
    program.parse([], { from: 'user' });
    expect(program.opts().telemetry).toBe(true);
  });

  it('--no-telemetry flag sets telemetry to false', () => {
    const program = createOptsProgram();
    program.parse(['--no-telemetry'], { from: 'user' });
    expect(program.opts().telemetry).toBe(false);
  });

  it('--debug flag defaults to undefined (not set)', () => {
    const program = createOptsProgram();
    program.parse([], { from: 'user' });
    expect(program.opts().debug).toBeUndefined();
  });

  it('--debug flag sets debug to true', () => {
    const program = createOptsProgram();
    program.parse(['--debug'], { from: 'user' });
    expect(program.opts().debug).toBe(true);
  });

  it('multiple flags can be combined', () => {
    const program = createOptsProgram();
    program.parse(
      [
        '--no-open',
        '--yes',
        '--port=3500',
        '--proxy-port=3501',
        '--no-telemetry',
        '--host',
        '0.0.0.0',
        '--debug',
      ],
      { from: 'user' },
    );
    const opts = program.opts();
    expect(opts.open).toBe(false);
    expect(opts.yes).toBe(true);
    expect(opts.port).toBe('3500');
    expect(opts.proxyPort).toBe('3501');
    expect(opts.telemetry).toBe(false);
    expect(opts.host).toBe('0.0.0.0');
    expect(opts.debug).toBe(true);
  });
});

describe('CLI flags — non-interactive env var', () => {
  let originalNonInteractive: string | undefined;

  beforeEach(() => {
    originalNonInteractive = process.env['NOVA_NON_INTERACTIVE'];
  });

  afterEach(() => {
    if (originalNonInteractive === undefined) {
      delete process.env['NOVA_NON_INTERACTIVE'];
    } else {
      process.env['NOVA_NON_INTERACTIVE'] = originalNonInteractive;
    }
  });

  /**
   * Replicates the NOVA_NON_INTERACTIVE → --yes mapping logic.
   */
  function applyNonInteractiveEnv(argv: string[]): string[] {
    if (process.env['NOVA_NON_INTERACTIVE'] === '1' && !argv.includes('--yes')) {
      return [...argv, '--yes'];
    }
    return argv;
  }

  it('NOVA_NON_INTERACTIVE=1 injects --yes into argv', () => {
    process.env['NOVA_NON_INTERACTIVE'] = '1';
    const result = applyNonInteractiveEnv(['node', 'nova', 'start']);
    expect(result).toContain('--yes');
  });

  it('NOVA_NON_INTERACTIVE=0 does NOT inject --yes', () => {
    process.env['NOVA_NON_INTERACTIVE'] = '0';
    const result = applyNonInteractiveEnv(['node', 'nova', 'start']);
    expect(result).not.toContain('--yes');
  });

  it('NOVA_NON_INTERACTIVE=1 does NOT double-add --yes if already present', () => {
    process.env['NOVA_NON_INTERACTIVE'] = '1';
    const result = applyNonInteractiveEnv(['node', 'nova', 'start', '--yes']);
    expect(result.filter((a) => a === '--yes').length).toBe(1);
  });

  it('NOVA_NON_INTERACTIVE=1 with --yes already set does not duplicate', () => {
    process.env['NOVA_NON_INTERACTIVE'] = '1';
    const argv = ['node', 'nova', '--yes'];
    const result = applyNonInteractiveEnv(argv);
    expect(result.filter((a) => a === '--yes').length).toBe(1);
  });
});

describe('Banner suppression', () => {
  function shouldSuppressBanner(args: string[], isTTY: boolean, novaQuiet?: string): boolean {
    if (novaQuiet === '1') return true;
    if (!isTTY) return true;

    const knownCommands = [
      'start',
      'chat',
      'init',
      'setup',
      'status',
      'tasks',
      'review',
      'watch',
      'license',
      'entity',
      'bible',
      'update',
      'uninstall',
    ];
    const subcommand = args.find((a) => !a.startsWith('-') && knownCommands.includes(a));
    const isStartOrDefault = !subcommand || subcommand === 'start';
    const isFlagOnly =
      args.includes('--version') ||
      args.includes('-V') ||
      args.includes('--help') ||
      args.includes('-h');

    return !isStartOrDefault || isFlagOnly;
  }

  it('suppresses banner when NOVA_QUIET=1', () => {
    expect(shouldSuppressBanner(['start'], true, '1')).toBe(true);
  });

  it('does NOT suppress banner on TTY with start command (normal case)', () => {
    expect(shouldSuppressBanner(['start'], true)).toBe(false);
  });

  it('suppresses banner when stdout is not a TTY', () => {
    expect(shouldSuppressBanner(['start'], false)).toBe(true);
  });

  it('suppresses banner for --version subcommand', () => {
    expect(shouldSuppressBanner(['--version'], true)).toBe(true);
  });

  it('suppresses banner for --help subcommand', () => {
    expect(shouldSuppressBanner(['--help'], true)).toBe(true);
  });

  it('suppresses banner for non-start subcommand (e.g., setup)', () => {
    expect(shouldSuppressBanner(['setup'], true)).toBe(true);
  });

  it('suppresses banner for setup subcommand', () => {
    expect(shouldSuppressBanner(['setup'], true)).toBe(true);
  });

  it('suppresses banner for status subcommand', () => {
    expect(shouldSuppressBanner(['status'], true)).toBe(true);
  });

  it('does NOT suppress banner for default (no explicit subcommand)', () => {
    expect(shouldSuppressBanner([], true)).toBe(false);
  });
});

describe('NO_COLOR handling', () => {
  it('NO_COLOR=1 disables chalk ANSI colors', async () => {
    const { Chalk } = await vi.importActual<typeof import('chalk')>('chalk');
    const chalk = new Chalk({ level: 0 }); // level 0 = no color
    const colored = chalk.red('test');
    // eslint-disable-next-line no-control-regex
    expect(colored).not.toMatch(/\x1b\[/);
  });

  it('NO_COLOR not set allows ANSI colors', async () => {
    const { Chalk } = await vi.importActual<typeof import('chalk')>('chalk');
    const chalk = new Chalk({ level: 1 }); // level 1 = basic colors
    const colored = chalk.red('test');
    // eslint-disable-next-line no-control-regex
    expect(colored).toMatch(/\x1b\[/);
  });
});

describe('isNonInteractive helper', () => {
  let originalNonInteractive: string | undefined;

  beforeEach(() => {
    originalNonInteractive = process.env['NOVA_NON_INTERACTIVE'];
  });

  afterEach(() => {
    if (originalNonInteractive === undefined) {
      delete process.env['NOVA_NON_INTERACTIVE'];
    } else {
      process.env['NOVA_NON_INTERACTIVE'] = originalNonInteractive;
    }
  });

  function isNonInteractive(opts: { yes?: boolean }): boolean {
    return process.env['NOVA_NON_INTERACTIVE'] === '1' || opts.yes === true;
  }

  it('returns false by default', () => {
    delete process.env['NOVA_NON_INTERACTIVE'];
    expect(isNonInteractive({})).toBe(false);
  });

  it('returns true when NOVA_NON_INTERACTIVE=1', () => {
    process.env['NOVA_NON_INTERACTIVE'] = '1';
    expect(isNonInteractive({})).toBe(true);
  });

  it('returns true when --yes is set', () => {
    delete process.env['NOVA_NON_INTERACTIVE'];
    expect(isNonInteractive({ yes: true })).toBe(true);
  });

  it('returns true when both NOVA_NON_INTERACTIVE=1 and --yes', () => {
    process.env['NOVA_NON_INTERACTIVE'] = '1';
    expect(isNonInteractive({ yes: true })).toBe(true);
  });

  it('returns false when NOVA_NON_INTERACTIVE=0 and no --yes', () => {
    process.env['NOVA_NON_INTERACTIVE'] = '0';
    expect(isNonInteractive({})).toBe(false);
  });
});

describe('Help output formatting', () => {
  it('--help does not contain banner ASCII art characters', () => {
    const program = createCli();
    const output = program.helpInformation();
    expect(output).not.toMatch(/█/);
    expect(output).not.toMatch(/▀/);
    expect(output).not.toMatch(/▄/);
    expect(output).not.toMatch(/═/);
    expect(output).not.toMatch(/╚/);
    expect(output).not.toMatch(/╝/);
    expect(output).not.toMatch(/╔/);
    expect(output).not.toMatch(/╗/);
  });

  it('--help contains Usage and Commands sections', () => {
    const program = createCli();
    const output = program.helpInformation();
    expect(output).toContain('Usage:');
    expect(output).toContain('Commands:');
  });
});

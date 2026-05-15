import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────

const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (
    ...args: [
      string,
      string[],
      { timeout: number },
      (error: Error | null, stdout: string, stderr: string) => void,
    ]
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  ) => mockExecFile(...args),
}));

const mockReadFileSync = vi.fn();
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: (
      ...args: Parameters<typeof actual.readFileSync>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    ) => mockReadFileSync(...args),
  };
});

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let consoleLogSpy: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let consoleErrorSpy: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processStderrSpy: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processExitSpy: any;

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Import the update module.
 */
async function importUpdateModule(): Promise<{
  updateCommand: () => Promise<void>;
  checkForUpdates: (v: string) => Promise<void>;
}> {
  const mod = await import('../commands/update.js');
  return mod;
}

function mockRegistryVersion(version: string) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ version }),
  });
}

function mockRegistryUnreachable() {
  mockFetch.mockRejectedValue(new Error('network error'));
}

function mockCurrentVersion(version: string) {
  mockReadFileSync.mockReturnValue(JSON.stringify({ version }));
}

function mockInstallSuccess() {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: { timeout: number },
      callback: (error: null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, 'installed', '');
    },
  );
}

function mockInstallEACCES(exitCode = 243) {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: { timeout: number },
      callback: (error: Error, stdout: string, stderr: string) => void,
    ) => {
      const err = Object.assign(new Error('EACCES: permission denied, access'), {
        code: exitCode,
        killed: false,
        signal: null,
        cmd: 'npm install -g @novastorm-ai/cli@latest',
      });
      callback(
        err,
        '',
        'EACCES: permission denied, access\nnpm ERR! Please try running as root/Administrator.',
      );
    },
  );
}

function mockInstallOtherFailure(exitCode = 1) {
  mockExecFile.mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: { timeout: number },
      callback: (error: Error, stdout: string, stderr: string) => void,
    ) => {
      const err = Object.assign(new Error('Command failed'), {
        code: exitCode,
        killed: false,
        signal: null,
        cmd: 'npm install -g @novastorm-ai/cli@latest',
      });
      callback(err, '', 'npm ERR! 404 Not Found');
    },
  );
}

/** Collect all output since mock setup (console + stderr) */
function allOutput(): string {
  const consoleOutput = [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls]
    .flat()
    .join('\n');
  const stderrOutput = processStderrSpy.mock.calls
    .map((call: unknown[]) => {
      const chunk = call[0];
      if (typeof chunk === 'string') return chunk;
      if (Buffer.isBuffer(chunk)) return chunk.toString('utf-8');
      if (chunk instanceof Uint8Array) return new TextDecoder().decode(chunk);
      return '';
    })
    .join('');
  return consoleOutput + stderrOutput;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('nova update — EACCES handling', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
    mockFetch.mockReset();
    mockReadFileSync.mockReset();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Capture stderr writes since the implementation uses StructuredLogger + ora
    // which both write to process.stderr, not console.log/error.
    processStderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((
      ..._args: unknown[]
    ): boolean => {
      // Call the callback if one is provided (Node.js overloaded write signature)
      const lastArg = _args[_args.length - 1];
      if (typeof lastArg === 'function') {
        (lastArg as (err?: Error | null) => void)();
      }
      return true;
    });
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }));
    // Default: current version is "0.1.0" so "1.0.0" triggers an update
    mockCurrentVersion('0.1.0');
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processStderrSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  // ── VAL-CLI-047: PM-specific remedy ─────────────────────────────────

  it('detects EACCES from npm and prints npm-specific remedy', async () => {
    mockRegistryVersion('1.0.0');
    mockInstallEACCES(243);

    const { updateCommand } = await importUpdateModule();

    try {
      await updateCommand();
    } catch {
      // process.exit throws
    }

    const output = allOutput();

    // npm install path gives generic path hint; must contain sudo suggestion
    expect(output).toContain('sudo npm install -g');
    expect(output).toContain('@novastorm-ai/cli@latest');
    expect(output).toMatch(/Node version manager|nvm|asdf|volta/);
    // Must identify npm as the PM
    expect(output).toMatch(/npm/);
  });

  it('detects EACCES from pnpm and prints pnpm-specific remedy', async () => {
    vi.stubEnv('_NOVA_TEST_PM', 'pnpm');

    mockRegistryVersion('1.0.0');
    mockInstallEACCES(243);

    const { updateCommand } = await importUpdateModule();

    try {
      await updateCommand();
    } catch {
      // process.exit throws
    }

    const output = allOutput();

    expect(output).toContain('pnpm');
    expect(output).toContain('@novastorm-ai/cli@latest');
    // Should show pnpm-specific suggestion
    expect(output).toMatch(/sudo pnpm|pnpm config|pnpm add -g/);
  });

  it('detects EACCES from yarn and prints yarn-specific remedy', async () => {
    vi.stubEnv('_NOVA_TEST_PM', 'yarn');

    mockRegistryVersion('1.0.0');
    mockInstallEACCES(243);

    const { updateCommand } = await importUpdateModule();

    try {
      await updateCommand();
    } catch {
      // process.exit throws
    }

    const output = allOutput();

    expect(output).toContain('yarn');
    expect(output).toContain('@novastorm-ai/cli@latest');
  });

  it('detects EACCES from volta and prints volta-specific remedy', async () => {
    vi.stubEnv('_NOVA_TEST_PM', 'volta');

    mockRegistryVersion('1.0.0');
    mockInstallEACCES(243);

    const { updateCommand } = await importUpdateModule();

    try {
      await updateCommand();
    } catch {
      // process.exit throws
    }

    const output = allOutput();

    expect(output).toContain('volta');
    expect(output).toContain('@novastorm-ai/cli@latest');
  });

  // ── VAL-CLI-048: No stack trace ────────────────────────────────────

  it('EACCES output does NOT contain a stack trace', async () => {
    mockRegistryVersion('1.0.0');
    mockInstallEACCES(243);

    const { updateCommand } = await importUpdateModule();

    try {
      await updateCommand();
    } catch {
      // process.exit throws
    }

    const output = allOutput();

    // No stack-frame lines like "    at foo.ts:123:45"
    expect(output).not.toMatch(/^\s+at\s+\S+\s+\(.+:\d+:\d+\)/m);
    // No "Error:" line followed by stack frames
    expect(output).not.toMatch(/^Error:/m);
  });

  it('EACCES output is a clean, human-readable message', async () => {
    mockRegistryVersion('1.0.0');
    mockInstallEACCES(243);

    const { updateCommand } = await importUpdateModule();

    try {
      await updateCommand();
    } catch {
      // process.exit throws
    }

    const output = allOutput();

    // Should contain a remedy suggestion
    expect(output).toMatch(/Run:|run:|sudo|permission/i);
    // Should reference the detected package manager
    expect(output).toMatch(/npm|pnpm|yarn|volta/);
  });

  // ── Exit code behavior ─────────────────────────────────────────────

  it('exits with the same exit code as the failing install command', async () => {
    mockRegistryVersion('1.0.0');
    mockInstallEACCES(243);

    const { updateCommand } = await importUpdateModule();

    try {
      await updateCommand();
    } catch {
      // process.exit throws
    }

    expect(processExitSpy).toHaveBeenCalledWith(243);
  });

  it('exits with the same non-EACCES exit code as the failing command', async () => {
    mockRegistryVersion('1.0.0');
    mockInstallOtherFailure(1);

    const { updateCommand } = await importUpdateModule();

    try {
      await updateCommand();
    } catch {
      // process.exit throws
    }

    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  // ── Non-EACCES errors still surface ────────────────────────────────

  it('non-EACCES errors still surface with their original output', async () => {
    mockRegistryVersion('1.0.0');
    mockInstallOtherFailure(1);

    const { updateCommand } = await importUpdateModule();

    try {
      await updateCommand();
    } catch {
      // process.exit throws
    }

    const output = allOutput();

    // Should contain the original error output
    expect(output).toContain('404 Not Found');
    // Should NOT contain EACCES-specific remedy
    expect(output).not.toMatch(/sudo|Node version manager/);
  });

  // ── Already up to date ─────────────────────────────────────────────

  it('exits cleanly when already on the latest version', async () => {
    mockCurrentVersion('0.2.2');
    mockRegistryVersion('0.2.2'); // same as current
    mockInstallSuccess();

    const { updateCommand } = await importUpdateModule();

    await updateCommand();

    // Should not have called process.exit
    expect(processExitSpy).not.toHaveBeenCalled();
    // Should not have called execFile (no install needed)
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  // ── Successful update ──────────────────────────────────────────────

  it('installs successfully when a newer version is available', async () => {
    mockRegistryVersion('1.0.0');
    mockInstallSuccess();

    const { updateCommand } = await importUpdateModule();

    await updateCommand();

    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  // ── Registry unreachable ───────────────────────────────────────────

  it('handles registry being unreachable gracefully', async () => {
    mockRegistryUnreachable();

    const { updateCommand } = await importUpdateModule();

    await updateCommand();

    // Should not exit with error, just report
    expect(processExitSpy).not.toHaveBeenCalled();
    // Should not attempt install
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});

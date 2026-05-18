import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────

const mockExecFile = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: (
    ...args: [
      string,
      string[],
      { timeout: number },
      (error: Error | null, stdout: string, stderr: string) => void,
    ]
  ) => mockExecFile(...args),
}));

vi.mock('@novastorm-ai/core', async () => {
  const actual = await vi.importActual('@novastorm-ai/core');
  return {
    ...actual,
    StructuredLogger: vi.fn().mockImplementation(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    })),
  };
});

vi.mock('ora', () => {
  const mockSpinner = {
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
  };
  return {
    default: vi.fn(() => mockSpinner),
  };
});

import { uninstallCommand } from '../commands/uninstall.js';

describe('uninstallCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uninstalls via npm successfully', async () => {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: { timeout: number },
        cb: (error: null, stdout: string) => void,
      ) => {
        cb(null, 'removed');
      },
    );

    await uninstallCommand();
    // Should call npm uninstall
    expect(mockExecFile).toHaveBeenCalled();
    const firstCall = mockExecFile.mock.calls[0]!;
    expect(firstCall[0]).toBe('npm');
    expect(firstCall[1]).toContain('uninstall');
  });

  it('falls back to pnpm when npm fails', async () => {
    let callCount = 0;
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: { timeout: number },
        cb: (error: Error | null, stdout: string) => void,
      ) => {
        callCount++;
        if (callCount === 1) {
          cb(new Error('npm not found'), '');
        } else {
          cb(null, 'removed via pnpm');
        }
      },
    );

    await uninstallCommand();
    // Should have been called twice (npm then pnpm)
    expect(mockExecFile).toHaveBeenCalledTimes(2);
    const secondCall = mockExecFile.mock.calls[1]!;
    expect(secondCall[0]).toBe('pnpm');
  });

  it('handles both npm and pnpm failures', async () => {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: { timeout: number },
        cb: (error: Error, stdout?: string) => void,
      ) => {
        cb(new Error('command not found'), '');
      },
    );

    await uninstallCommand();
    // Should have been called twice (npm then pnpm), both failed
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  it('handles npm success with stderr output', async () => {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: { timeout: number },
        cb: (error: null, stdout: string, stderr: string) => void,
      ) => {
        cb(null, '', 'some warning');
      },
    );

    await uninstallCommand();
    expect(mockExecFile).toHaveBeenCalled();
  });
});

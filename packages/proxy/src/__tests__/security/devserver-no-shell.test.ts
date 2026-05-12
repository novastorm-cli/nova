import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import os from 'node:os';

// Mock node:child_process — we control spawn/spawnSync, passthrough everything else
const { mockSpawn, mockSpawnSync } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockSpawnSync: vi.fn(),
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: mockSpawn,
    spawnSync: mockSpawnSync,
  };
});

import { DevServerRunner } from '../../DevServerRunner.js';

type SpawnArgs = [string, string[], Record<string, unknown>];

// Create a mock ChildProcess that we control
function createMockChildProcess(): ChildProcess {
  const mock = new EventEmitter() as unknown as Record<string, unknown>;
  mock.stdout = new EventEmitter();
  mock.stderr = new EventEmitter();
  mock.stdin = new EventEmitter();
  mock.pid = 12345;
  mock.kill = vi.fn();
  mock.exitCode = null;
  mock.signalCode = null;
  return mock as unknown as ChildProcess;
}

function createAcceptingMockChildProcess(): ChildProcess {
  const mock = createMockChildProcess();
  // After a tick, emit process started (don't exit)
  setImmediate(() => {
    (mock as unknown as Record<string, unknown>).stdout = mock.stdout;
    (mock.stdout as EventEmitter).emit('data', Buffer.from('Server started on port 3000\n'));
  });
  return mock;
}

describe('DevServerRunner - security', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
    mockSpawnSync.mockReset();
  });

  // === Shell metacharacter rejection tests ===

  it('should reject && (shell AND operator)', async () => {
    const runner = new DevServerRunner();
    await expect(runner.spawn('ls && rm -rf /', os.tmpdir(), 3000)).rejects.toThrow(
      /shell features.*not supported/i,
    );
  });

  it('should reject | (shell pipe)', async () => {
    const runner = new DevServerRunner();
    await expect(runner.spawn('cat /etc/passwd | grep root', os.tmpdir(), 3000)).rejects.toThrow(
      /shell features.*not supported/i,
    );
  });

  it('should reject > (output redirect)', async () => {
    const runner = new DevServerRunner();
    await expect(runner.spawn('echo hello > /tmp/test.txt', os.tmpdir(), 3000)).rejects.toThrow(
      /shell features.*not supported/i,
    );
  });

  it('should reject < (input redirect)', async () => {
    const runner = new DevServerRunner();
    await expect(runner.spawn('cat < /etc/passwd', os.tmpdir(), 3000)).rejects.toThrow(
      /shell features.*not supported/i,
    );
  });

  it('should reject $HOME (variable expansion)', async () => {
    const runner = new DevServerRunner();
    await expect(runner.spawn('echo $HOME', os.tmpdir(), 3000)).rejects.toThrow(
      /shell features.*not supported/i,
    );
  });

  it('should reject ${VAR} syntax', async () => {
    const runner = new DevServerRunner();
    await expect(runner.spawn('echo ${HOME}', os.tmpdir(), 3000)).rejects.toThrow(
      /shell features.*not supported/i,
    );
  });

  it('should reject backtick command substitution', async () => {
    const runner = new DevServerRunner();
    await expect(runner.spawn('echo `whoami`', os.tmpdir(), 3000)).rejects.toThrow(
      /shell features.*not supported/i,
    );
  });

  it('should reject ; (command separator)', async () => {
    const runner = new DevServerRunner();
    await expect(runner.spawn('npm run dev; rm -rf /', os.tmpdir(), 3000)).rejects.toThrow(
      /shell features.*not supported/i,
    );
  });

  it('should reject || (shell OR operator)', async () => {
    const runner = new DevServerRunner();
    await expect(runner.spawn('false || echo pwned', os.tmpdir(), 3000)).rejects.toThrow(
      /shell features.*not supported/i,
    );
  });

  it('should reject glob patterns', async () => {
    const runner = new DevServerRunner();
    await expect(runner.spawn('ls *.ts', os.tmpdir(), 3000)).rejects.toThrow(
      /shell features.*not supported/i,
    );
  });

  // === Accept valid commands ===

  it('should accept simple command with no shell metacharacters', async () => {
    const mockChild = createAcceptingMockChildProcess();
    mockSpawn.mockReturnValue(mockChild);

    const runner = new DevServerRunner();

    // Don't await — it will time out polling, but we only care about spawn call
    runner.spawn('node -e "console.log(1)"', os.tmpdir(), 3099).catch(() => {});

    // Give it a tick to call spawn
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const spawnArgs = mockSpawn.mock.calls[0] as unknown as SpawnArgs;

    // Verify spawn was called without shell
    expect(spawnArgs[0]).toBe('node');
    expect(spawnArgs[1]).toEqual(['-e', 'console.log(1)']);
    expect(spawnArgs[2]).toMatchObject({ shell: false });

    // Clean up
    mockChild.emit('exit', 0, null);
    void runner.kill();
  });

  it('should accept pnpm dev command', async () => {
    const mockChild = createAcceptingMockChildProcess();
    mockSpawn.mockReturnValue(mockChild);

    const runner = new DevServerRunner();
    runner.spawn('pnpm dev', os.tmpdir(), 3099).catch(() => {});

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const spawnArgs = mockSpawn.mock.calls[0] as unknown as SpawnArgs;
    expect(spawnArgs[0]).toBe('pnpm');
    expect(spawnArgs[1]).toEqual(['dev']);
    expect(spawnArgs[2]).toMatchObject({ shell: false });

    mockChild.emit('exit', 0, null);
    void runner.kill();
  });

  it('should accept npm run dev command', async () => {
    const mockChild = createAcceptingMockChildProcess();
    mockSpawn.mockReturnValue(mockChild);

    const runner = new DevServerRunner();
    runner.spawn('npm run dev', os.tmpdir(), 3099).catch(() => {});

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const spawnArgs = mockSpawn.mock.calls[0] as unknown as SpawnArgs;
    expect(spawnArgs[0]).toBe('npm');
    expect(spawnArgs[1]).toEqual(['run', 'dev']);
    expect(spawnArgs[2]).toMatchObject({ shell: false });

    mockChild.emit('exit', 0, null);
    void runner.kill();
  });

  // === Quoting tests ===

  it('should properly parse double-quoted arguments', async () => {
    const mockChild = createAcceptingMockChildProcess();
    mockSpawn.mockReturnValue(mockChild);

    const runner = new DevServerRunner();
    runner.spawn('node -e "process.exit(0)"', os.tmpdir(), 3099).catch(() => {});

    await new Promise((r) => setTimeout(r, 50));

    const spawnArgs = mockSpawn.mock.calls[0] as unknown as SpawnArgs;
    expect(spawnArgs[0]).toBe('node');
    expect(spawnArgs[1]).toEqual(['-e', 'process.exit(0)']);

    mockChild.emit('exit', 0, null);
    void runner.kill();
  });

  it('should properly parse single-quoted arguments', async () => {
    const mockChild = createAcceptingMockChildProcess();
    mockSpawn.mockReturnValue(mockChild);

    const runner = new DevServerRunner();
    runner.spawn("node -e 'process.exit(0)'", os.tmpdir(), 3099).catch(() => {});

    await new Promise((r) => setTimeout(r, 50));

    const spawnArgs = mockSpawn.mock.calls[0] as unknown as SpawnArgs;
    expect(spawnArgs[0]).toBe('node');
    expect(spawnArgs[1]).toEqual(['-e', 'process.exit(0)']);

    mockChild.emit('exit', 0, null);
    void runner.kill();
  });

  // === spawn options tests ===

  it('should pass cwd to spawn', async () => {
    const mockChild = createAcceptingMockChildProcess();
    mockSpawn.mockReturnValue(mockChild);

    const runner = new DevServerRunner();
    const cwd = '/tmp/test-project';
    runner.spawn('echo hello', cwd, 3099).catch(() => {});

    await new Promise((r) => setTimeout(r, 50));

    const spawnArgs = mockSpawn.mock.calls[0] as unknown as SpawnArgs;
    expect(spawnArgs[2]).toMatchObject({ cwd, shell: false });

    mockChild.emit('exit', 0, null);
    void runner.kill();
  });

  it('should pass env to spawn with PORT', async () => {
    const mockChild = createAcceptingMockChildProcess();
    mockSpawn.mockReturnValue(mockChild);

    const runner = new DevServerRunner();
    const port = 3456;
    runner.spawn('echo hello', os.tmpdir(), port).catch(() => {});

    await new Promise((r) => setTimeout(r, 50));

    const spawnArgs = mockSpawn.mock.calls[0] as unknown as SpawnArgs;
    const spawnEnv = spawnArgs[2].env as Record<string, string>;
    expect(spawnEnv).toBeDefined();
    expect(spawnEnv.PORT).toBe(String(port));

    mockChild.emit('exit', 0, null);
    void runner.kill();
  });

  it('should set shell to false', async () => {
    const mockChild = createAcceptingMockChildProcess();
    mockSpawn.mockReturnValue(mockChild);

    const runner = new DevServerRunner();
    runner.spawn('echo hello', os.tmpdir(), 3099).catch(() => {});

    await new Promise((r) => setTimeout(r, 50));

    const spawnArgs = mockSpawn.mock.calls[0] as unknown as SpawnArgs;
    expect(spawnArgs[2].shell).toBe(false);

    mockChild.emit('exit', 0, null);
    void runner.kill();
  });

  // === Error message content ===

  it('should include guidance in the error message', async () => {
    const runner = new DevServerRunner();
    await expect(runner.spawn('echo $HOME', os.tmpdir(), 3000)).rejects.toThrow(
      /wrap.*shell script/i,
    );
  });

  it('should name the error InvalidCommandError', async () => {
    const runner = new DevServerRunner();
    try {
      await runner.spawn('echo $HOME', os.tmpdir(), 3000);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe('InvalidCommandError');
    }
  });

  // === Empty / edge cases ===

  it('should reject empty command', async () => {
    const runner = new DevServerRunner();
    await expect(runner.spawn('', os.tmpdir(), 3000)).rejects.toThrow();
  });

  it('should reject whitespace-only command', async () => {
    const runner = new DevServerRunner();
    await expect(runner.spawn('   ', os.tmpdir(), 3000)).rejects.toThrow();
  });

  it('should accept command with escaped dollar sign (literal)', async () => {
    const mockChild = createAcceptingMockChildProcess();
    mockSpawn.mockReturnValue(mockChild);

    const runner = new DevServerRunner();
    runner.spawn('echo \\$HOME', os.tmpdir(), 3099).catch(() => {});

    await new Promise((r) => setTimeout(r, 50));

    // Backslash-escaped $ is literal, not shell expansion
    const spawnArgs = mockSpawn.mock.calls[0] as unknown as SpawnArgs;
    expect(spawnArgs[0]).toBe('echo');
    // shell-quote preserves the literal $HOME after backslash
    expect(spawnArgs[1]).toContain('$HOME');

    mockChild.emit('exit', 0, null);
    void runner.kill();
  });
});

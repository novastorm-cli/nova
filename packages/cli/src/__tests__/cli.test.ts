import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

const execFileAsync = promisify(execFile);

const CLI_BIN = path.resolve(
  import.meta.dirname,
  '../../bin/nova.ts',
);

/**
 * Run the CLI binary.
 *
 * Uses `npx tsx` to execute the TypeScript entry point directly.
 * Falls back to `node --import tsx/esm` if tsx is available as a dependency.
 */
async function runCli(
  args: string[],
  options: { cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('npx', ['tsx', CLI_BIN, ...args], {
    cwd: options.cwd ?? process.cwd(),
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
    },
    timeout: 30_000,
  });
}

describe('CLI binary (nova)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-cli-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('nova --version outputs version matching package.json', async () => {
    const pkgJson = JSON.parse(
      await fs.readFile(
        path.resolve(import.meta.dirname, '../../package.json'),
        'utf-8',
      ),
    );
    const { stdout } = await runCli(['--version']);
    expect(stdout.trim()).toBe(pkgJson.version);
  });

  it('nova --help output contains all registered commands', async () => {
    const { stdout } = await runCli(['--help']);
    const commands = [
      'start',
      'chat',
      'init',
      'status',
      'tasks',
      'review',
      'watch',
    ];
    for (const cmd of commands) {
      expect(stdout).toContain(cmd);
    }
  });

  it('nova init in a tmp directory creates nova.toml', async () => {
    await runCli(['init'], { cwd: tmpDir });
    const tomlPath = path.join(tmpDir, 'nova.toml');
    const exists = await fs
      .stat(tomlPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it('nova status does not crash and outputs something meaningful', async () => {
    // Create a minimal nova.toml so status has context
    await fs.writeFile(path.join(tmpDir, 'nova.toml'), '');

    const { stdout, stderr } = await runCli(['status'], { cwd: tmpDir });
    const output = stdout + stderr;
    expect(output.length).toBeGreaterThan(0);
  });
});

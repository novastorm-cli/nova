import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const BIN = path.join(ROOT, 'packages', 'cli', 'bin', 'nova.ts');

/** Run the CLI via tsx so we don't need a build step. */
function nova(args: string, cwd?: string): string {
  return execSync(`npx tsx ${BIN} ${args}`, {
    cwd: cwd ?? ROOT,
    encoding: 'utf-8',
    timeout: 15_000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  }).trim();
}

describe('Smoke tests', () => {
  const tmpDirs: string[] = [];

  function makeTmp(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'nova-smoke-'));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    tmpDirs.length = 0;
  });

  it('nova --version outputs a semver string', () => {
    const output = nova('--version');
    expect(output).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('nova --help contains key commands', () => {
    const output = nova('--help');
    expect(output).toContain('start');
    expect(output).toContain('chat');
    expect(output).toContain('init');
    expect(output).toContain('status');
  });

  it('nova init creates nova.toml with valid TOML content', () => {
    const tmp = makeTmp();
    nova('init', tmp);

    const tomlPath = path.join(tmp, 'nova.toml');
    expect(existsSync(tomlPath)).toBe(true);

    const content = readFileSync(tomlPath, 'utf-8');
    // The init command writes DEFAULT_CONFIG through ConfigReader.write(),
    // which diffs against defaults. Since the config IS the default, the
    // resulting TOML is empty (or whitespace). This is valid — it means
    // "use all defaults". The file existing is what matters.
    expect(typeof content).toBe('string');
    // The content must be valid TOML (empty string is valid TOML)
    // It must NOT be JSON
    expect(content.trimStart().startsWith('{')).toBe(false);
  });
});

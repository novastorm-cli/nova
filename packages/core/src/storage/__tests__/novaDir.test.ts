import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { NovaDir } from '../NovaDir.js';

describe('NovaDir', () => {
  let tmpDir: string;
  const novaDir = new NovaDir();

  afterEach(async () => {
    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  async function makeTmpDir(): Promise<string> {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'novadir-test-'));
    return tmpDir;
  }

  it('init() creates .nova/ with subdirs (recipes, history, cache)', async () => {
    const dir = await makeTmpDir();
    await novaDir.init(dir);

    const novaPath = path.join(dir, '.nova');
    expect(fs.existsSync(novaPath)).toBe(true);
    expect(fs.existsSync(path.join(novaPath, 'recipes'))).toBe(true);
    expect(fs.existsSync(path.join(novaPath, 'history'))).toBe(true);
    expect(fs.existsSync(path.join(novaPath, 'cache'))).toBe(true);

    // Also creates files: config.toml, graph.json, context.md
    expect(fs.existsSync(path.join(novaPath, 'config.toml'))).toBe(true);
    expect(fs.existsSync(path.join(novaPath, 'graph.json'))).toBe(true);
    expect(fs.existsSync(path.join(novaPath, 'context.md'))).toBe(true);
  });

  it('init() adds .nova to .gitignore', async () => {
    const dir = await makeTmpDir();
    await novaDir.init(dir);

    const gitignorePath = path.join(dir, '.gitignore');
    const content = await fsp.readFile(gitignorePath, 'utf-8');
    const lines = content.split('\n').map((l) => l.trim());
    expect(lines).toContain('.nova');
  });

  it('init() adds .nova to existing .gitignore without duplicating', async () => {
    const dir = await makeTmpDir();
    await fsp.writeFile(path.join(dir, '.gitignore'), 'node_modules\n', 'utf-8');

    await novaDir.init(dir);

    const content = await fsp.readFile(path.join(dir, '.gitignore'), 'utf-8');
    const novaEntries = content.split('\n').filter((l) => l.trim() === '.nova');
    expect(novaEntries).toHaveLength(1);
    expect(content).toContain('node_modules');
  });

  it('init() is idempotent — safe to call multiple times', async () => {
    const dir = await makeTmpDir();
    await novaDir.init(dir);
    await novaDir.init(dir);

    const novaPath = path.join(dir, '.nova');
    expect(fs.existsSync(novaPath)).toBe(true);
    expect(fs.existsSync(path.join(novaPath, 'recipes'))).toBe(true);

    // .gitignore should not have duplicate entries
    const content = await fsp.readFile(path.join(dir, '.gitignore'), 'utf-8');
    const novaEntries = content.split('\n').filter((l) => l.trim() === '.nova');
    expect(novaEntries).toHaveLength(1);
  });

  it('exists() returns true after init, false before', async () => {
    const dir = await makeTmpDir();
    expect(novaDir.exists(dir)).toBe(false);

    await novaDir.init(dir);
    expect(novaDir.exists(dir)).toBe(true);
  });

  it('clean() removes .nova/ directory', async () => {
    const dir = await makeTmpDir();
    await novaDir.init(dir);
    expect(novaDir.exists(dir)).toBe(true);

    await novaDir.clean(dir);
    expect(novaDir.exists(dir)).toBe(false);
  });

  it('getPath() returns absolute path to .nova/', async () => {
    const dir = await makeTmpDir();
    const result = novaDir.getPath(dir);

    expect(path.isAbsolute(result)).toBe(true);
    expect(result).toBe(path.join(dir, '.nova'));
  });
});

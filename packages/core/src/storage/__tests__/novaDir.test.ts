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

  it('creates .nova/missions/ subdirectory during init', async () => {
    const dir = await makeTmpDir();
    await novaDir.init(dir);

    const novaPath = path.join(dir, '.nova');
    expect(fs.existsSync(path.join(novaPath, 'missions'))).toBe(true);
  });

  it('missions directory creation is idempotent', async () => {
    const dir = await makeTmpDir();
    await novaDir.init(dir);
    // Create a file inside missions/
    const missionsDir = path.join(dir, '.nova', 'missions');
    const testFile = path.join(missionsDir, 'test-mission.json');
    await fsp.writeFile(testFile, JSON.stringify({ id: 'm1' }), 'utf-8');

    // Call init again — should not delete existing files
    await novaDir.init(dir);

    expect(fs.existsSync(testFile)).toBe(true);
    const content = await fsp.readFile(testFile, 'utf-8');
    expect(JSON.parse(content)).toEqual({ id: 'm1' });
  });

  it('writes orchestrator.md and worker.md to .nova/agents/ during init', async () => {
    const dir = await makeTmpDir();
    await novaDir.init(dir);

    const agentsDir = path.join(dir, '.nova', 'agents');
    expect(fs.existsSync(path.join(agentsDir, 'orchestrator.md'))).toBe(true);
    expect(fs.existsSync(path.join(agentsDir, 'worker.md'))).toBe(true);
  });

  it('does not overwrite existing orchestrator.md and worker.md', async () => {
    const dir = await makeTmpDir();
    await novaDir.init(dir);

    const agentsDir = path.join(dir, '.nova', 'agents');
    const customOrch = 'Custom orchestrator instructions';
    const customWorker = 'Custom worker instructions';
    await fsp.writeFile(path.join(agentsDir, 'orchestrator.md'), customOrch, 'utf-8');
    await fsp.writeFile(path.join(agentsDir, 'worker.md'), customWorker, 'utf-8');

    // Call init again — should not overwrite
    await novaDir.init(dir);

    expect(await fsp.readFile(path.join(agentsDir, 'orchestrator.md'), 'utf-8')).toBe(customOrch);
    expect(await fsp.readFile(path.join(agentsDir, 'worker.md'), 'utf-8')).toBe(customWorker);
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

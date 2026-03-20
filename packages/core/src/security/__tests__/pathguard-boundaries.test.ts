import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { PathGuard } from '../PathGuard.js';
import { PathDeniedError } from '../../contracts/IPathGuard.js';

describe('PathGuard boundaries', () => {
  const projectRoot = '/tmp/test-project';
  const alwaysAllow = async () => true;

  it('denies readonly files on check()', async () => {
    const guard = new PathGuard(projectRoot, alwaysAllow);
    guard.loadBoundaries({
      readonly: ['migrations/**'],
    });

    await expect(
      guard.check(resolve(projectRoot, 'migrations/001.sql')),
    ).rejects.toThrow(PathDeniedError);
  });

  it('denies ignored files on check()', async () => {
    const guard = new PathGuard(projectRoot, alwaysAllow);
    guard.loadBoundaries({
      ignored: ['.github/**'],
    });

    await expect(
      guard.check(resolve(projectRoot, '.github/workflows/ci.yml')),
    ).rejects.toThrow(PathDeniedError);
  });

  it('identifies readonly files', () => {
    const guard = new PathGuard(projectRoot, alwaysAllow);
    guard.loadBoundaries({
      readonly: ['services/api/Migrations/**', 'docker-compose.yml'],
    });

    expect(guard.isReadonly(resolve(projectRoot, 'services/api/Migrations/001.cs'))).toBe(true);
    expect(guard.isReadonly(resolve(projectRoot, 'src/index.ts'))).toBe(false);
  });

  it('identifies ignored files', () => {
    const guard = new PathGuard(projectRoot, alwaysAllow);
    guard.loadBoundaries({
      ignored: ['.github/**', 'services/billing/**'],
    });

    expect(guard.isIgnored(resolve(projectRoot, '.github/workflows/ci.yml'))).toBe(true);
    expect(guard.isIgnored(resolve(projectRoot, 'services/billing/index.ts'))).toBe(true);
    expect(guard.isIgnored(resolve(projectRoot, 'src/index.ts'))).toBe(false);
  });

  it('allows files not in boundaries', async () => {
    const guard = new PathGuard(projectRoot, alwaysAllow);
    guard.loadBoundaries({
      readonly: ['migrations/**'],
      ignored: ['.github/**'],
    });

    // Regular files should pass
    await guard.check(resolve(projectRoot, 'src/app.ts'));
  });
});

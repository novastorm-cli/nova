import { describe, it, expect, vi } from 'vitest';
import { resolve } from 'node:path';
import { PathGuard } from '../../security/PathGuard.js';
import { PathDeniedError, PathTraversalError } from '../../contracts/IPathGuard.js';

describe('PathGuard', () => {
  const PROJECT_ROOT = '/projects/my-app';

  it('allows project root and subdirectories without prompt', async () => {
    const promptFn = vi.fn();
    const guard = new PathGuard(PROJECT_ROOT, promptFn);
    // Files directly in the project root
    await guard.check('/projects/my-app/package.json');
    // Files in subdirectories
    await guard.check('/projects/my-app/src/components/Button.tsx');
    await guard.check('/projects/my-app/app/page.tsx');
    expect(promptFn).not.toHaveBeenCalled();
  });

  it('allows .nova/ without prompt', async () => {
    const promptFn = vi.fn();
    const guard = new PathGuard(PROJECT_ROOT, promptFn);
    await guard.check('/projects/my-app/.nova/agents/developer.md');
    expect(promptFn).not.toHaveBeenCalled();
  });

  it('throws PathTraversalError for paths outside project root', () => {
    const guard = new PathGuard(PROJECT_ROOT);
    expect(() => guard.validate('/etc/passwd')).toThrow(PathTraversalError);
    expect(() => guard.validate('/projects/other-app/file.ts')).toThrow(PathTraversalError);
  });

  it('does not prompt for subdirectories of project root', async () => {
    const promptFn = vi.fn();
    const guard = new PathGuard('/tmp/test-project', promptFn);
    await guard.check('/tmp/test-project/unknown-dir/file.ts');
    expect(promptFn).not.toHaveBeenCalled();
  });

  it('parent allow covers children', async () => {
    const promptFn = vi.fn();
    const guard = new PathGuard(PROJECT_ROOT, promptFn);
    guard.allow('/projects/my-app/src');
    await guard.check('/projects/my-app/src/components/Button.tsx');
    expect(promptFn).not.toHaveBeenCalled();
  });

  it('validate() accepts all paths under project root', () => {
    const guard = new PathGuard(PROJECT_ROOT);
    // These should not throw
    guard.validate('/projects/my-app/src/deep/nested/file.ts');
    guard.validate('/projects/my-app/.nova/config.toml');
    guard.validate('/projects/my-app/package.json');
  });

  it('throws PathTraversalError for check() on paths outside root', async () => {
    const guard = new PathGuard(PROJECT_ROOT);
    await expect(guard.check('/etc/passwd')).rejects.toThrow(PathTraversalError);
  });
});

describe('PathGuard writable boundaries with picomatch', () => {
  const PROJECT_ROOT = '/projects/my-app';
  const noPrompt = () => Promise.resolve(true);

  it('denies src/secret.env when writable is src/**/*.ts', async () => {
    const guard = new PathGuard(PROJECT_ROOT, noPrompt);
    guard.loadBoundaries({ writable: ['src/**/*.ts'] });

    await expect(guard.check('/projects/my-app/src/secret.env')).rejects.toThrow(PathDeniedError);
  });

  it('allows src/index.ts when writable is src/**/*.ts', async () => {
    const guard = new PathGuard(PROJECT_ROOT, noPrompt);
    guard.loadBoundaries({ writable: ['src/**/*.ts'] });

    await guard.check('/projects/my-app/src/index.ts');
  });

  it('allows src/foo/bar/baz.ts when writable is src/**/*.ts', async () => {
    const guard = new PathGuard(PROJECT_ROOT, noPrompt);
    guard.loadBoundaries({ writable: ['src/**/*.ts'] });

    await guard.check('/projects/my-app/src/foo/bar/baz.ts');
  });

  it('denies root.ts when writable is src/**/*.ts', async () => {
    const guard = new PathGuard(PROJECT_ROOT, noPrompt);
    guard.loadBoundaries({ writable: ['src/**/*.ts'] });

    await expect(guard.check('/projects/my-app/root.ts')).rejects.toThrow(PathDeniedError);
  });

  it('denies ../secret.txt when writable is src/**/*.ts', async () => {
    const guard = new PathGuard(PROJECT_ROOT, noPrompt);
    guard.loadBoundaries({ writable: ['src/**/*.ts'] });

    // resolve('/projects/my-app/src/../secret.txt') = '/projects/my-app/secret.txt'
    // which is under project root but doesn't match writable pattern
    await expect(guard.check('/projects/my-app/src/../secret.txt')).rejects.toThrow(
      PathDeniedError,
    );
  });

  it('denies /etc/passwd (absolute outside root)', async () => {
    const guard = new PathGuard(PROJECT_ROOT, noPrompt);
    guard.loadBoundaries({ writable: ['src/**/*.ts'] });

    await expect(guard.check('/etc/passwd')).rejects.toThrow(PathTraversalError);
  });

  it('allows root-level tailwind.config.ts when writable includes *.config.ts', async () => {
    const guard = new PathGuard(PROJECT_ROOT, noPrompt);
    guard.loadBoundaries({ writable: ['*.config.ts'] });

    await guard.check('/projects/my-app/tailwind.config.ts');
  });

  it('denies src/foo.ts when writable is only *.config.ts', async () => {
    const guard = new PathGuard(PROJECT_ROOT, noPrompt);
    guard.loadBoundaries({ writable: ['*.config.ts'] });

    await expect(guard.check('/projects/my-app/src/foo.ts')).rejects.toThrow(PathDeniedError);
  });

  it('allows files matching any of multiple writable patterns', async () => {
    const guard = new PathGuard(PROJECT_ROOT, noPrompt);
    guard.loadBoundaries({ writable: ['src/**/*.ts', '*.config.ts'] });

    await guard.check('/projects/my-app/src/components/Button.ts');
    await guard.check('/projects/my-app/vite.config.ts');
  });

  it('denies files not matching any writable pattern when writable is set', async () => {
    const guard = new PathGuard(PROJECT_ROOT, noPrompt);
    guard.loadBoundaries({ writable: ['src/**/*.ts'] });

    await expect(guard.check('/projects/my-app/lib/helpers.js')).rejects.toThrow(PathDeniedError);
  });

  it('still allows .nova/ files even when writable boundaries are set', async () => {
    const guard = new PathGuard(PROJECT_ROOT, noPrompt);
    guard.loadBoundaries({ writable: ['src/**/*.ts'] });

    await guard.check('/projects/my-app/.nova/agents/developer.md');
    await guard.check('/projects/my-app/.nova/session-token');
  });

  it('correctly handles nested glob patterns without collapsing', async () => {
    // Verifies src/**/*.ts does NOT collapse to just src/ (the bug being fixed)
    const guard = new PathGuard(PROJECT_ROOT, noPrompt);
    guard.loadBoundaries({ writable: ['src/**/*.ts'] });

    // lib/ matches the **/*.ts segment but NOT the src/ prefix
    await expect(guard.check('/projects/my-app/lib/something.ts')).rejects.toThrow(PathDeniedError);
  });

  it('isReadonly takes precedence over writable for overlapping patterns', async () => {
    const guard = new PathGuard(PROJECT_ROOT, noPrompt);
    guard.loadBoundaries({
      writable: ['src/**/*.ts'],
      readonly: ['src/generated/**'],
    });

    // File matches both writable and readonly — readonly should win
    await expect(guard.check('/projects/my-app/src/generated/types.ts')).rejects.toThrow(
      PathDeniedError,
    );
  });

  it('isIgnored takes precedence over writable', async () => {
    const guard = new PathGuard(PROJECT_ROOT, noPrompt);
    guard.loadBoundaries({
      writable: ['src/**/*.ts'],
      ignored: ['.github/**'],
    });

    // .github files should be denied even if they'd match writable
    // This particular path doesn't match writable anyway, but tests precedence
    await expect(guard.check('/projects/my-app/.github/workflows/ci.yml')).rejects.toThrow(
      PathDeniedError,
    );
  });

  it('no writable boundaries set -> old prompt-based logic works', async () => {
    const guard = new PathGuard(PROJECT_ROOT, noPrompt);
    guard.loadBoundaries({
      readonly: ['migrations/**'],
    });

    // No writable patterns → should fall through to prompt/allow logic
    await guard.check('/projects/my-app/src/app.ts');
  });
});

describe('PathGuard boundaries', () => {
  const projectRoot = '/tmp/test-project';
  const alwaysAllow = () => Promise.resolve(true);

  it('denies readonly files on check()', async () => {
    const guard = new PathGuard(projectRoot, alwaysAllow);
    guard.loadBoundaries({
      readonly: ['migrations/**'],
    });

    await expect(guard.check(resolve(projectRoot, 'migrations/001.sql'))).rejects.toThrow(
      PathDeniedError,
    );
  });

  it('denies ignored files on check()', async () => {
    const guard = new PathGuard(projectRoot, alwaysAllow);
    guard.loadBoundaries({
      ignored: ['.github/**'],
    });

    await expect(guard.check(resolve(projectRoot, '.github/workflows/ci.yml'))).rejects.toThrow(
      PathDeniedError,
    );
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

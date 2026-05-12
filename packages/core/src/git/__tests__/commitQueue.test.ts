import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GitManager } from '../GitManager.js';
import { CommitQueue } from '../CommitQueue.js';
import { GitError } from '../../contracts/IGitManager.js';

function git(cwd: string, command: string): string {
  return execSync(`git ${command}`, { cwd, encoding: 'utf-8' }).trim();
}

function writeFile(dir: string, name: string, content: string): void {
  fs.writeFileSync(path.join(dir, name), content, 'utf-8');
}

describe('CommitQueue', () => {
  let tmpDir: string;
  let gitManager: GitManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'commitq-test-'));
    git(tmpDir, 'init -b main');
    git(tmpDir, 'config user.email "test@nova.dev"');
    git(tmpDir, 'config user.name "Test User"');
    writeFile(tmpDir, 'README.md', '# init');
    git(tmpDir, 'add .');
    git(tmpDir, 'commit -m "initial commit"');

    // Switch to a non-protected branch for most tests
    git(tmpDir, 'checkout -b feature/test-branch');

    gitManager = new GitManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Normal commit flow ────────────────────────────────────

  it('should commit on a non-protected branch', async () => {
    const queue = new CommitQueue(gitManager);
    writeFile(tmpDir, 'file.txt', 'hello');

    const hash = await queue.enqueue('add file', ['file.txt']);
    expect(hash).toMatch(/^[0-9a-f]{7}$/);

    const logOutput = git(tmpDir, 'log --oneline -1');
    expect(logOutput).toContain('add file');
  });

  it('should commit on a nova/ task branch', async () => {
    // Switch to nova/ task branch like Nova does
    git(tmpDir, 'checkout -b nova/abc123');
    const queue = new CommitQueue(gitManager);
    writeFile(tmpDir, 'task-file.txt', 'task content');

    const hash = await queue.enqueue('nova task', ['task-file.txt']);
    expect(hash).toMatch(/^[0-9a-f]{7}$/);
  });

  // ── Protected branch refusal ──────────────────────────────

  describe('branch protection', () => {
    it('should refuse commit on "main" branch by default', async () => {
      // Switch back to main branch (created by git init -b main)
      git(tmpDir, 'checkout main');
      const queue = new CommitQueue(gitManager);
      writeFile(tmpDir, 'bad.txt', 'should not commit');

      await expect(queue.enqueue('bad commit', ['bad.txt'])).rejects.toThrow(GitError);
      await expect(queue.enqueue('bad commit', ['bad.txt'])).rejects.toThrow(
        /Refusing to commit directly to protected branch/,
      );
    });

    it('should refuse commit on "master" branch by default', async () => {
      // Create a master branch from main
      git(tmpDir, 'checkout -b master');
      const queue = new CommitQueue(gitManager);
      writeFile(tmpDir, 'bad.txt', 'should not commit');

      await expect(queue.enqueue('bad commit', ['bad.txt'])).rejects.toThrow(GitError);
    });

    it('should refuse commit on "develop" branch by default', async () => {
      // Create develop branch
      git(tmpDir, 'checkout -b develop');
      const queue = new CommitQueue(gitManager);
      writeFile(tmpDir, 'bad.txt', 'should not commit');

      await expect(queue.enqueue('bad commit', ['bad.txt'])).rejects.toThrow(GitError);
    });

    it('should allow commit on protected branch when allowProtectedBranchCommits is true', async () => {
      git(tmpDir, 'checkout main');
      const queue = new CommitQueue(gitManager, { allowProtectedBranchCommits: true });
      writeFile(tmpDir, 'allowed.txt', 'should commit');

      const hash = await queue.enqueue('allowed commit', ['allowed.txt']);
      expect(hash).toMatch(/^[0-9a-f]{7}$/);
    });

    it('should include the branch name in the error message', async () => {
      git(tmpDir, 'checkout main');
      const queue = new CommitQueue(gitManager);
      writeFile(tmpDir, 'bad.txt', 'should not commit');

      await expect(queue.enqueue('bad commit', ['bad.txt'])).rejects.toThrow(/main/);
    });

    it('should include remediation instructions in the error message', async () => {
      git(tmpDir, 'checkout main');
      const queue = new CommitQueue(gitManager);
      writeFile(tmpDir, 'bad.txt', 'should not commit');

      await expect(queue.enqueue('bad commit', ['bad.txt'])).rejects.toThrow(
        /allowProtectedBranchCommits/,
      );
    });
  });

  // ── Serialization ─────────────────────────────────────────

  it('should serialize concurrent commits', async () => {
    const queue = new CommitQueue(gitManager);

    // Enqueue multiple commits
    const promises: Promise<string>[] = [];
    for (let i = 0; i < 3; i++) {
      writeFile(tmpDir, `file-${i}.txt`, `content ${i}`);
      const hashPromise = queue.enqueue(`commit ${i}`, [`file-${i}.txt`]);
      promises.push(hashPromise);
    }

    const hashes = await Promise.all(promises);

    // All should succeed
    for (const hash of hashes) {
      expect(hash).toMatch(/^[0-9a-f]{7}$/);
    }

    // All commits should be present in the log
    const log = git(tmpDir, 'log --oneline');
    expect(log).toContain('commit 0');
    expect(log).toContain('commit 1');
    expect(log).toContain('commit 2');
  });
});

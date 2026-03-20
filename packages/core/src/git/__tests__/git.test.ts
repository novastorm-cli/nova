import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GitManager } from '../GitManager.js';
import { GitError } from '../../contracts/IGitManager.js';

function git(cwd: string, command: string): string {
  return execSync(`git ${command}`, { cwd, encoding: 'utf-8' }).trim();
}

function writeFile(dir: string, name: string, content: string): void {
  fs.writeFileSync(path.join(dir, name), content, 'utf-8');
}

describe('GitManager', () => {
  let tmpDir: string;
  let manager: GitManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-test-'));
    git(tmpDir, 'init');
    git(tmpDir, 'config user.email "test@nova.dev"');
    git(tmpDir, 'config user.name "Test User"');
    writeFile(tmpDir, 'README.md', '# init');
    git(tmpDir, 'add .');
    git(tmpDir, 'commit -m "initial commit"');
    manager = new GitManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── createBranch ──────────────────────────────────────────

  describe('createBranch', () => {
    it('should create a branch with the given prefix and timestamp, then switch to it', async () => {
      const branchName = await manager.createBranch('nova/');

      expect(branchName).toMatch(/^nova\/\d+$/);

      const current = git(tmpDir, 'branch --show-current');
      expect(current).toBe(branchName);
    });

    it('should throw GitError when not in a git repository', async () => {
      const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-'));
      const badManager = new GitManager(nonGitDir);

      await expect(badManager.createBranch('nova/')).rejects.toThrow(GitError);

      fs.rmSync(nonGitDir, { recursive: true, force: true });
    });
  });

  // ── commit ────────────────────────────────────────────────

  describe('commit', () => {
    it('should create a commit and return a 7-char hash', async () => {
      writeFile(tmpDir, 'file.txt', 'hello world');

      const hash = await manager.commit('add file', ['file.txt']);

      expect(hash).toMatch(/^[0-9a-f]{7}$/);

      const logOutput = git(tmpDir, 'log --oneline -1');
      expect(logOutput).toContain(hash);
      expect(logOutput).toContain('add file');
    });

    it('should return the current HEAD hash when there are no changes to commit', async () => {
      const hash = await manager.commit('empty', ['file.txt']);
      // Returns the 7-char short hash of HEAD (nothing new to commit)
      expect(hash).toMatch(/^[0-9a-f]{7}$/);
    });
  });

  // ── rollback ──────────────────────────────────────────────

  describe('rollback', () => {
    it('should create a revert commit for a given hash', async () => {
      writeFile(tmpDir, 'feature.txt', 'feature content');
      const hash = await manager.commit('add feature', ['feature.txt']);

      await manager.rollback(hash);

      const logOutput = git(tmpDir, 'log --oneline -1');
      expect(logOutput.toLowerCase()).toContain('revert');
      expect(fs.existsSync(path.join(tmpDir, 'feature.txt'))).toBe(false);
    });

    it('should throw GitError for a nonexistent hash', async () => {
      await expect(manager.rollback('abcdef0')).rejects.toThrow(GitError);
    });
  });

  // ── getDiff ───────────────────────────────────────────────

  describe('getDiff', () => {
    it('should return a unified diff string containing the change', async () => {
      writeFile(tmpDir, 'diff-test.txt', 'line one\n');
      const hash = await manager.commit('add diff-test', ['diff-test.txt']);

      const diff = await manager.getDiff(hash);

      expect(diff).toContain('diff-test.txt');
      expect(diff).toContain('+line one');
    });
  });

  // ── getLog ────────────────────────────────────────────────

  describe('getLog', () => {
    it('should return CommitInfo[] ordered newest first', async () => {
      writeFile(tmpDir, 'a.txt', 'a');
      await manager.commit('commit A', ['a.txt']);

      writeFile(tmpDir, 'b.txt', 'b');
      await manager.commit('commit B', ['b.txt']);

      const log = await manager.getLog();

      expect(log.length).toBeGreaterThanOrEqual(3); // initial + A + B
      expect(log[0].message).toContain('commit B');
      expect(log[1].message).toContain('commit A');

      for (const entry of log) {
        expect(entry).toHaveProperty('hash');
        expect(entry).toHaveProperty('message');
        expect(entry).toHaveProperty('author');
        expect(entry).toHaveProperty('date');
        expect(entry).toHaveProperty('files');
      }
    });

    it('should return at most 50 commits', async () => {
      for (let i = 0; i < 55; i++) {
        writeFile(tmpDir, `file-${i}.txt`, `content ${i}`);
        git(tmpDir, `add file-${i}.txt`);
        git(tmpDir, `commit -m "commit ${i}"`);
      }

      const log = await manager.getLog();

      expect(log.length).toBeLessThanOrEqual(50);
    }, 30_000);
  });

  // ── getCurrentBranch ──────────────────────────────────────

  describe('getCurrentBranch', () => {
    it('should return the current branch name', async () => {
      const branch = await manager.getCurrentBranch();

      const actual = git(tmpDir, 'branch --show-current');
      expect(branch).toBe(actual);
    });
  });

  // ── getDevCount ───────────────────────────────────────────

  describe('getDevCount', () => {
    it('should count unique commit authors by email', async () => {
      const count = await manager.getDevCount();
      expect(count).toBe(1);

      // Add a commit from a different author
      git(tmpDir, '-c user.email="other@nova.dev" -c user.name="Other Dev" commit --allow-empty -m "other commit"');

      const updatedCount = await manager.getDevCount();
      expect(updatedCount).toBe(2);
    });
  });

  // ── hasUncommittedChanges ─────────────────────────────────

  describe('hasUncommittedChanges', () => {
    it('should return false when working tree is clean', async () => {
      const result = await manager.hasUncommittedChanges();
      expect(result).toBe(false);
    });

    it('should return true when there are uncommitted changes', async () => {
      writeFile(tmpDir, 'dirty.txt', 'uncommitted');

      const result = await manager.hasUncommittedChanges();
      expect(result).toBe(true);
    });
  });

  // ── stash / unstash ───────────────────────────────────────

  describe('stash and unstash', () => {
    it('should roundtrip stash and unstash preserving changes', async () => {
      writeFile(tmpDir, 'stash-test.txt', 'stashed content');
      git(tmpDir, 'add stash-test.txt');

      await manager.stash();

      expect(fs.existsSync(path.join(tmpDir, 'stash-test.txt'))).toBe(false);

      await manager.unstash();

      expect(fs.existsSync(path.join(tmpDir, 'stash-test.txt'))).toBe(true);
      const content = fs.readFileSync(path.join(tmpDir, 'stash-test.txt'), 'utf-8');
      expect(content).toBe('stashed content');
    });

    it('should throw GitError when unstashing an empty stash', async () => {
      await expect(manager.unstash()).rejects.toThrow(GitError);
    });
  });
});

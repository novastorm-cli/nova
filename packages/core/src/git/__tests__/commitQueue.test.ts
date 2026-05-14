import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GitManager } from '../GitManager.js';
import { CommitQueue } from '../CommitQueue.js';
import { GitError } from '../../contracts/IGitManager.js';
import type { EventBus } from '../../contracts/IEventBus.js';
import type { NovaEvent } from '../../models/events.js';

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

  // ── task_failed event emission (VAL-ARCH-042) ─────────────

  describe('task_failed event emission', () => {
    /** Creates a mock EventBus for testing event emission. */
    function mockEventBus(): EventBus & { emit: ReturnType<typeof vi.fn> } {
      return {
        emit: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      };
    }

    it('emits task_failed event when a commit fails on a protected branch', async () => {
      git(tmpDir, 'checkout main');
      const bus = mockEventBus();
      const queue = new CommitQueue(gitManager, {}, undefined, bus);
      writeFile(tmpDir, 'bad.txt', 'should not commit');

      // First enqueue with taskId — this should fail
      const taskId = 'task-abc-123';
      const p1 = queue.enqueue('bad commit', ['bad.txt'], taskId);

      // The first call rejects with GitError
      await expect(p1).rejects.toThrow(GitError);

      // The second enqueue (without taskId) triggers the error handler for the previous failure
      writeFile(tmpDir, 'ok.txt', 'this commit will run');
      // Switch to a safe branch so the second commit succeeds
      git(tmpDir, 'checkout -b safe-branch');
      const p2 = queue.enqueue('ok commit', ['ok.txt']);

      // Wait for both to settle
      await p2;

      // Verify task_failed event was emitted with the correct data
      expect(bus.emit).toHaveBeenCalled();
      const taskFailedCalls = (bus.emit as ReturnType<typeof vi.fn>).mock.calls
        .map((call: unknown[]) => call[0] as NovaEvent)
        .filter((e): e is Extract<NovaEvent, { type: 'task_failed' }> => e.type === 'task_failed');

      expect(taskFailedCalls.length).toBeGreaterThanOrEqual(1);
      expect(taskFailedCalls[0].data.taskId).toBe(taskId);
      expect(taskFailedCalls[0].data.error).toContain('protected branch');
    });

    it('emits task_failed with the GitError message as the reason', async () => {
      git(tmpDir, 'checkout main');
      const bus = mockEventBus();
      const queue = new CommitQueue(gitManager, {}, undefined, bus);
      writeFile(tmpDir, 'bad.txt', 'should not commit');

      const taskId = 'task-def-456';
      const p1 = queue.enqueue('bad commit', ['bad.txt'], taskId);

      await expect(p1).rejects.toThrow(GitError);

      // Trigger the error handler with a second enqueue
      git(tmpDir, 'checkout -b safe-branch');
      writeFile(tmpDir, 'ok.txt', 'ok');
      await queue.enqueue('ok commit', ['ok.txt']);

      const taskFailedCalls = (bus.emit as ReturnType<typeof vi.fn>).mock.calls
        .map((call: unknown[]) => call[0] as NovaEvent)
        .filter((e): e is Extract<NovaEvent, { type: 'task_failed' }> => e.type === 'task_failed');

      expect(taskFailedCalls.length).toBeGreaterThanOrEqual(1);
      expect(taskFailedCalls[0].data.error).toContain('Refusing to commit');
      expect(taskFailedCalls[0].data.error).toContain('main');
    });

    it('does not crash when eventBus is not provided (backward compat)', async () => {
      git(tmpDir, 'checkout main');
      // No eventBus passed — should not crash
      const queue = new CommitQueue(gitManager);
      writeFile(tmpDir, 'bad.txt', 'should not commit');

      const p1 = queue.enqueue('bad commit', ['bad.txt'], 'task-001');
      await expect(p1).rejects.toThrow(GitError);

      // The error handler should still run without crashing
      git(tmpDir, 'checkout -b safe-branch');
      writeFile(tmpDir, 'ok.txt', 'ok');
      await queue.enqueue('ok commit', ['ok.txt']);
      // If we got here without a crash, the test passes
    });

    it('does not emit when taskId is not provided', async () => {
      git(tmpDir, 'checkout main');
      const bus = mockEventBus();
      const queue = new CommitQueue(gitManager, {}, undefined, bus);
      writeFile(tmpDir, 'bad.txt', 'should not commit');

      // Enqueue without taskId
      const p1 = queue.enqueue('bad commit', ['bad.txt']);
      await expect(p1).rejects.toThrow(GitError);

      // Trigger the error handler
      git(tmpDir, 'checkout -b safe-branch');
      writeFile(tmpDir, 'ok.txt', 'ok');
      await queue.enqueue('ok commit', ['ok.txt']);

      // No task_failed event should have been emitted (prevTaskId was undefined)
      const taskFailedCalls = (bus.emit as ReturnType<typeof vi.fn>).mock.calls
        .map((call: unknown[]) => call[0] as NovaEvent)
        .filter((e): e is Extract<NovaEvent, { type: 'task_failed' }> => e.type === 'task_failed');

      expect(taskFailedCalls.length).toBe(0);
    });

    it('emits task_failed for each failed commit in a sequence', async () => {
      git(tmpDir, 'checkout main');
      const bus = mockEventBus();
      const queue = new CommitQueue(gitManager, {}, undefined, bus);

      // Enqueue two failing commits with different taskIds
      writeFile(tmpDir, 'bad1.txt', 'x');
      const p1 = queue.enqueue('bad commit 1', ['bad1.txt'], 'task-1');
      await expect(p1).rejects.toThrow(GitError);

      writeFile(tmpDir, 'bad2.txt', 'y');
      const p2 = queue.enqueue('bad commit 2', ['bad2.txt'], 'task-2');
      await expect(p2).rejects.toThrow(GitError);

      // Trigger the error handler for the last failure
      git(tmpDir, 'checkout -b safe-branch');
      writeFile(tmpDir, 'ok.txt', 'ok');
      await queue.enqueue('ok commit', ['ok.txt']);

      const taskFailedCalls = (bus.emit as ReturnType<typeof vi.fn>).mock.calls
        .map((call: unknown[]) => call[0] as NovaEvent)
        .filter((e): e is Extract<NovaEvent, { type: 'task_failed' }> => e.type === 'task_failed');

      // Should have 2 task_failed events (one for each failed commit)
      expect(taskFailedCalls.length).toBe(2);
      expect(taskFailedCalls[0].data.taskId).toBe('task-1');
      expect(taskFailedCalls[1].data.taskId).toBe('task-2');
    });
  });
});

import type { CommitInfo } from '../models/types.js';

export interface IGitManager {
  /**
   * Creates a new branch from current HEAD.
   * Branch name format: `{prefix}{timestamp}` e.g. "nova/1710583200"
   * Checks out the new branch.
   *
   * @returns the created branch name
   * @throws {GitError} if not a git repository
   * @throws {GitError} if there are uncommitted changes (call stash() first)
   */
  createBranch(prefix: string): Promise<string>;

  /**
   * Stages the given files and creates a commit.
   *
   * @param message - commit message
   * @param files - relative file paths to stage. If empty, stages all changes.
   * @returns the commit hash (short, 7 chars)
   * @throws {GitError} if no changes to commit
   */
  commit(message: string, files: string[]): Promise<string>;

  /**
   * Reverts a commit by hash (git revert --no-edit).
   * Creates a new revert commit.
   *
   * @throws {GitError} if hash doesn't exist
   * @throws {GitError} if revert has conflicts
   */
  rollback(commitHash: string): Promise<void>;

  /**
   * Returns the diff for a specific commit.
   * @returns unified diff string
   */
  getDiff(commitHash: string): Promise<string>;

  /**
   * Returns commit log for a branch (or current branch if not specified).
   * Ordered newest first. Limited to last 50 commits.
   */
  getLog(branch?: string): Promise<CommitInfo[]>;

  /** Returns current branch name. */
  getCurrentBranch(): Promise<string>;

  /**
   * Counts unique commit authors (by email) in the repo history.
   * Used for license checking.
   */
  getDevCount(): Promise<number>;

  /** Returns true if there are uncommitted changes in the working tree. */
  hasUncommittedChanges(): Promise<boolean>;

  /** Stash current changes. */
  stash(): Promise<void>;

  /** Pop stashed changes. @throws {GitError} if stash is empty. */
  unstash(): Promise<void>;
}

export class GitError extends Error {
  constructor(message: string, public readonly command?: string) {
    super(message);
    this.name = 'GitError';
  }
}

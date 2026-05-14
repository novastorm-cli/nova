import type { IGitManager } from '../contracts/IGitManager.js';
import { GitError } from '../contracts/IGitManager.js';
import type { ILogger } from '../contracts/ILogger.js';
import { StructuredLogger } from '../logging/StructuredLogger.js';

/** Branches that Nova refuses to commit to directly unless explicitly opted in. */
const PROTECTED_BRANCHES = new Set(['main', 'master', 'develop']);

export interface CommitQueueOptions {
  /**
   * When true, commits to `main`, `master`, or `develop` are allowed.
   * When false or unset (default), commits to these branches are refused
   * with a clear error.
   */
  allowProtectedBranchCommits?: boolean;
}

/**
 * Serializes git commit operations when multiple lane executors
 * run in parallel. Chains promises so only one commit runs at a time.
 */
export class CommitQueue {
  private queue: Promise<string> = Promise.resolve('');
  private readonly logger: ILogger;

  constructor(
    private readonly gitManager: IGitManager,
    private readonly options: CommitQueueOptions = {},
    logger?: ILogger,
  ) {
    this.logger = logger ?? new StructuredLogger({ isTTY: false });
  }

  /**
   * Enqueues a commit operation. The commit will execute after all
   * previously enqueued commits have completed.
   *
   * @param message - commit message
   * @param files - relative file paths to stage (passed to gitManager.commit)
   * @returns the commit hash from gitManager.commit
   * @throws {GitError} if the current branch is protected and allowProtectedBranchCommits is not true
   */
  enqueue(message: string, files: string[]): Promise<string> {
    this.queue = this.queue.then(
      () => this.guardedCommit(message, files),
      (err) => {
        this.logger.warn(`Previous commit failed: ${err instanceof Error ? err.message : err}`);
        return this.guardedCommit(message, files);
      },
    );
    return this.queue;
  }

  /**
   * Checks branch protection before committing.
   */
  private async guardedCommit(message: string, files: string[]): Promise<string> {
    if (!this.options.allowProtectedBranchCommits) {
      const branch = await this.gitManager.getCurrentBranch();
      if (PROTECTED_BRANCHES.has(branch)) {
        throw new GitError(
          `Refusing to commit directly to protected branch "${branch}". ` +
            `Nova always commits to a nova/<task-id> branch to keep your main branch safe. ` +
            `If you are certain you want to allow commits to "${branch}", ` +
            `set [git] allowProtectedBranchCommits = true in nova.toml.`,
          'git commit',
        );
      }
    }

    return this.gitManager.commit(message, files);
  }
}

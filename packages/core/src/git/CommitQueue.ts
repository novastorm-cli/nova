import type { IGitManager } from '../contracts/IGitManager.js';
import { GitError } from '../contracts/IGitManager.js';
import type { EventBus } from '../contracts/IEventBus.js';
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
  private readonly eventBus?: EventBus;
  /** Tracks the taskId of the most recently enqueued commit for error attribution. */
  private lastTaskId?: string;

  constructor(
    private readonly gitManager: IGitManager,
    private readonly options: CommitQueueOptions = {},
    logger?: ILogger,
    eventBus?: EventBus,
  ) {
    this.logger = logger ?? new StructuredLogger({ isTTY: false });
    this.eventBus = eventBus;
  }

  /**
   * Enqueues a commit operation. The commit will execute after all
   * previously enqueued commits have completed.
   *
   * @param message - commit message
   * @param files - relative file paths to stage (passed to gitManager.commit)
   * @param taskId - optional task identifier for error event attribution
   * @returns the commit hash from gitManager.commit
   * @throws {GitError} if the current branch is protected and allowProtectedBranchCommits is not true
   */
  enqueue(message: string, files: string[], taskId?: string): Promise<string> {
    const prevTaskId = this.lastTaskId;
    this.lastTaskId = taskId;

    this.queue = this.queue.then(
      () => this.guardedCommit(message, files),
      (err) => {
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Previous commit failed: ${reason}`);
        if (this.eventBus && prevTaskId) {
          this.eventBus.emit({
            type: 'task_failed',
            data: { taskId: prevTaskId, error: reason },
          });
        }
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

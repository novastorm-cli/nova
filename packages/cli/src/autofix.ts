import type {
  LlmClient,
  ProjectMap,
  TaskItem,
  IGitManager,
  EventBus,
  ILogger,
  ExecutionResult,
} from '@novastorm-ai/core';
import { Lane2Executor, Lane3Executor, CommitQueue, StructuredLogger } from '@novastorm-ai/core';
import type { WebSocketServer } from '@novastorm-ai/proxy';

// Patterns that indicate fixable compilation errors
const ERROR_PATTERNS = [
  /Module not found: Can't resolve '([^']+)'/,
  /Invalid src prop.*next\/image/i,
  /hostname.*is not configured under images/i,
  /SyntaxError:\s+(.+)/,
  /TypeError:\s+(.+)/,
  /Build error/i,
  /Compilation failed/i,
  /Failed to compile/i,
  /Error boundary caught/i,
];

// Image/next-image related error patterns
const IMAGE_PATTERNS = [
  /Module not found.*\.(png|jpg|jpeg|gif|svg|webp|ico)/i,
  /Invalid src prop.*next\/image/i,
  /hostname.*is not configured under images/i,
  /Image with src.*unsplash|picsum|placeholder/i,
  /Cannot find.*image/i,
  /Failed to load.*\.(png|jpg|jpeg|gif|svg|webp)/i,
  /ENOENT.*\.(png|jpg|jpeg|gif|svg|webp|ico)/i,
  /next\/image.*not configured/i,
];

/**
 * Keywords that indicate the error requires deleting a file rather than creating one.
 * When the error text matches any of these, the autofix prompt instructs the LLM to
 * prefer deletion (remove the conflicting file) rather than creation.
 */
const DELETION_INTENT_KEYWORDS = [
  /conflicting/i,
  /both match/i,
  /duplicate route/i,
  /multiple modules/i,
  /already exists/i,
  /collision/i,
  /ambiguous/i,
  /both resolve to/i,
  /two files/i,
  /more than one/i,
];

export class ErrorAutoFixer {
  private isFixing = false;
  private errorBuffer = '';
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly DEBOUNCE_MS = 1000;
  private fixAttempts = 0;
  private readonly MAX_FIX_ATTEMPTS = 3;
  private lastErrorSignature = '';
  private cooldownUntil = 0;
  readonly autofixTaskIds = new Set<string>();
  private readonly failedTaskIds = new Set<string>();
  private readonly logger: ILogger;

  constructor(
    private readonly projectPath: string,
    private readonly llmClient: LlmClient,
    private readonly gitManager: IGitManager,
    private readonly eventBus: EventBus,
    private readonly wsServer: WebSocketServer,
    private readonly projectMap: ProjectMap,
    private readonly commitQueue?: CommitQueue,
    private readonly microModel?: string,
    logger?: ILogger,
  ) {
    this.logger = logger ?? new StructuredLogger({ isTTY: process.stderr?.isTTY ?? false });
  }

  isAutofixTask(taskId: string): boolean {
    return this.autofixTaskIds.has(taskId);
  }

  /**
   * Process dev server output. Call this for every stdout/stderr chunk.
   */
  handleOutput(output: string): void {
    const hasError =
      ERROR_PATTERNS.some((p) => p.test(output)) || IMAGE_PATTERNS.some((p) => p.test(output));

    if (!hasError) return;
    if (this.isFixing) {
      this.logger.debug('[Nova] AutoFixer: already fixing, queuing...');
      return;
    }
    if (Date.now() < this.cooldownUntil) {
      this.logger.debug('[Nova] AutoFixer: in cooldown, skipping');
      return;
    }

    // Buffer errors (they come in chunks)
    this.errorBuffer += output;

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      void this.attemptAutoFix(this.errorBuffer);
      this.errorBuffer = '';
    }, this.DEBOUNCE_MS);
  }

  /** Force an immediate fix attempt, bypassing debounce, cooldown, and pattern check. */
  forceFixNow(errorOutput: string): Promise<void> {
    if (this.isFixing) {
      this.logger.debug('[Nova] AutoFixer: already fixing, skipping forced fix');
      return Promise.resolve();
    }
    return this.attemptAutoFix(errorOutput, { skipCooldown: true, skipDedup: true });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Retry loop + prompt builder
  // ─────────────────────────────────────────────────────────────────────────

  private async attemptAutoFix(
    errorOutput: string,
    options?: { skipCooldown?: boolean; skipDedup?: boolean },
  ): Promise<void> {
    if (this.isFixing) return;

    const skipCooldown = options?.skipCooldown ?? false;
    const skipDedup = options?.skipDedup ?? false;

    // Deduplicate: if same error keeps appearing, stop after MAX_FIX_ATTEMPTS
    // (skip for forceFixNow which resets its own attempt tracking internally)
    if (!skipDedup) {
      const errorSig = errorOutput.slice(0, 200);
      if (errorSig === this.lastErrorSignature) {
        this.fixAttempts++;
      } else {
        this.lastErrorSignature = errorSig;
        this.fixAttempts = 1;
      }

      if (this.fixAttempts > this.MAX_FIX_ATTEMPTS) {
        this.logger.warn(
          `[Nova] AutoFixer: same error after ${this.MAX_FIX_ATTEMPTS} attempts, stopping. Fix manually.`,
        );
        this.cooldownUntil = Date.now() + 60_000; // 1 minute cooldown
        this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_failed' } });
        return;
      }
    }

    this.isFixing = true;

    // Safety timeout: reset isFixing after 5 minutes max
    const safetyTimer = setTimeout(() => {
      if (this.isFixing) {
        this.logger.debug('[Nova] AutoFixer: safety timeout, resetting');
        this.isFixing = false;
      }
    }, 300_000);

    try {
      // Retry loop: attempt fix up to MAX_FIX_ATTEMPTS times.
      // Each retry includes failure context from previous attempt.
      const isImageError = IMAGE_PATTERNS.some((p) => p.test(errorOutput));
      let previousFailure = '';

      for (let attempt = 1; attempt <= this.MAX_FIX_ATTEMPTS; attempt++) {
        // Clear Next.js/Turbopack cache before each retry to avoid stale errors
        if (attempt > 1) {
          try {
            const { rmSync } = await import('node:fs');
            const { join } = await import('node:path');
            const nextCache = join(this.projectPath, '.next', 'cache');
            rmSync(nextCache, { recursive: true, force: true });
          } catch {
            /* cache dir may not exist */
          }
        }

        const taskDescription = this.buildTaskDescription(errorOutput, attempt, previousFailure);

        let result: ExecutionResult;

        if (isImageError) {
          result = await this.executeImageFixCore(errorOutput, taskDescription);
        } else {
          result = await this.executeCompilationFixCore(errorOutput, taskDescription);
        }

        if (result.success) {
          // Fix succeeded -- emit success events
          this.logger.info(
            `[Nova] Auto-fix succeeded on attempt ${attempt}/${this.MAX_FIX_ATTEMPTS}`,
          );
          this.eventBus.emit({
            type: 'task_completed',
            data: {
              taskId: result.taskId,
              diff: result.diff ?? '',
              commitHash: result.commitHash ?? '',
            },
          });
          this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_end' } });
          return;
        }

        // Fix failed -- record as a failed attempt
        this.failedTaskIds.add(result.taskId);
        previousFailure = result.error ?? 'Unknown error';

        // Emit task_failed event for this attempt
        const failEvent = {
          type: 'task_failed' as const,
          data: { taskId: result.taskId, error: previousFailure },
        };
        this.eventBus.emit(failEvent);

        if (attempt < this.MAX_FIX_ATTEMPTS) {
          this.logger.info(
            `[Nova] AutoFixer: attempt ${attempt}/${this.MAX_FIX_ATTEMPTS} failed (${previousFailure}), retrying...`,
          );
          this.wsServer.sendEvent({
            type: 'status',
            data: {
              message: `autofix_retry_${attempt + 1}`,
            },
          });
        }
      }

      // Budget exhausted -- all attempts failed
      this.logger.error(
        JSON.stringify({
          event: 'autofix_budget_exhausted',
          lastError: errorOutput.slice(0, 300),
          failedTaskIds: [...this.failedTaskIds],
          totalAttempts: this.MAX_FIX_ATTEMPTS,
          lastFailureReason: previousFailure,
        }),
      );

      this.wsServer.sendEvent({
        type: 'status',
        data: { message: 'autofix_budget_exhausted' },
      });

      // Cooldown to prevent immediate re-trigger via handleOutput
      if (!skipCooldown) {
        this.cooldownUntil = Date.now() + 60_000;
      }

      // Reset dedup tracking so a genuinely new error can trigger a fresh cycle
      if (!skipDedup) {
        this.lastErrorSignature = '';
        this.fixAttempts = 0;
      }
    } finally {
      clearTimeout(safetyTimer);
      this.isFixing = false;
    }
  }

  /**
   * Build the task description sent to the LLM, including deletion-intent
   * guidance when the error suggests conflicting/duplicate files.
   */
  private buildTaskDescription(
    errorOutput: string,
    attempt: number,
    previousFailure?: string,
  ): string {
    const truncatedError = errorOutput.slice(0, 500);
    let description =
      `Fix the following compilation/build error in the project. ` +
      `Read the error carefully and fix the root cause:\n${truncatedError}`;

    // Detect deletion-intent keywords: error mentions conflicting/duplicate files.
    // Instruct LLM to prefer removal over creation in such cases.
    const hasDeletionIntent = DELETION_INTENT_KEYWORDS.some((p) => p.test(errorOutput));
    if (hasDeletionIntent) {
      description +=
        '\n\nIMPORTANT: This error indicates conflicting or duplicate files. ' +
        'You MUST REMOVE or DELETE one of the conflicting files, NOT create new ones. ' +
        "Prefer deletion over creation when resolving conflicts. Use the 'delete' action.";
    }

    // Include previous failure context on retry so the LLM tries a different approach
    if (attempt > 1 && previousFailure) {
      description +=
        `\n\nPrevious attempt ${attempt - 1} failed: ${previousFailure}. ` +
        'Try a DIFFERENT approach. Do not repeat the same fix.';
    }

    return description;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Core execution methods (create task, run executor, return ExecutionResult)
  // ─────────────────────────────────────────────────────────────────────────

  private async executeCompilationFixCore(
    errorOutput: string,
    taskDescription: string,
  ): Promise<ExecutionResult> {
    this.logger.warn('[Nova] Detected compilation error -- attempting auto-fix');
    this.wsServer.sendEvent({
      type: 'status',
      data: { message: 'Compilation error detected. Auto-fixing...' },
    });

    let targetFile = this.extractFilePath(errorOutput);

    // Fallback: scan project map for files mentioned in error text
    if (!targetFile) {
      const knownFiles = Array.from(this.projectMap.fileContexts.keys());
      for (const f of knownFiles) {
        if (errorOutput.includes(f)) {
          targetFile = f;
          break;
        }
      }
      if (!targetFile) {
        for (const f of knownFiles) {
          const basename = f.split('/').slice(-1)[0]!;
          if (basename && errorOutput.includes(basename) && f.endsWith('.tsx')) {
            targetFile = f;
            break;
          }
        }
      }
    }

    const result =
      targetFile && this.projectMap.fileContexts.has(targetFile)
        ? await this.executeLane2Core(targetFile, taskDescription)
        : await this.executeLane3Core(taskDescription);

    return result;
  }

  private async executeLane2Core(
    targetFile: string,
    taskDescription: string,
  ): Promise<ExecutionResult> {
    const task: TaskItem = {
      id: crypto.randomUUID(),
      description: taskDescription,
      files: [targetFile],
      type: 'single_file',
      lane: 2,
      status: 'pending',
    };
    this.autofixTaskIds.add(task.id);

    const executor = new Lane2Executor(
      this.projectPath,
      this.llmClient,
      this.gitManager,
      undefined, // pathGuard
      this.commitQueue,
      this.microModel,
    );

    this.logger.info(`[Nova] Auto-fixing compilation error via Lane 2 (${targetFile})...`);
    this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_start' } });
    this.eventBus.emit({ type: 'task_started', data: { taskId: task.id } });
    this.wsServer.sendEvent({ type: 'task_created', data: task });

    const result = await executor.execute(task, this.projectMap);
    setTimeout(() => this.autofixTaskIds.delete(task.id), 5000);
    return result;
  }

  private async executeLane3Core(taskDescription: string): Promise<ExecutionResult> {
    const task: TaskItem = {
      id: crypto.randomUUID(),
      description: taskDescription,
      files: [],
      type: 'multi_file',
      lane: 3,
      status: 'pending',
    };
    this.autofixTaskIds.add(task.id);

    const executor = new Lane3Executor(
      this.projectPath,
      this.llmClient,
      this.gitManager,
      this.eventBus,
      1, // maxFixIterations -- single pass for auto-fix
      this.microModel,
      undefined, // agentPromptLoader
      undefined, // pathGuard
      this.commitQueue,
      true, // skipValidation -- auto-fix tasks skip tsc
    );

    this.logger.info('[Nova] Auto-fixing compilation error via Lane 3...');
    this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_start' } });
    this.eventBus.emit({ type: 'task_started', data: { taskId: task.id } });
    this.wsServer.sendEvent({ type: 'task_created', data: task });

    const result = await executor.execute(task, this.projectMap);
    setTimeout(() => this.autofixTaskIds.delete(task.id), 5000);
    return result;
  }

  private async executeImageFixCore(
    errorOutput: string,
    taskDescription: string,
  ): Promise<ExecutionResult> {
    this.logger.warn('[Nova] Detected image loading error -- replacing with placeholders');
    this.wsServer.sendEvent({
      type: 'status',
      data: {
        message: 'Image error detected. Replacing with placeholders...',
      },
    });

    const task: TaskItem = {
      id: crypto.randomUUID(),
      description: taskDescription,
      files: [],
      type: 'multi_file',
      lane: 3,
      status: 'pending',
    };
    this.autofixTaskIds.add(task.id);

    const executor = new Lane3Executor(
      this.projectPath,
      this.llmClient,
      this.gitManager,
      this.eventBus,
      1, // maxFixIterations -- single pass for auto-fix
      this.microModel,
      undefined, // agentPromptLoader
      undefined, // pathGuard
      this.commitQueue,
      true, // skipValidation -- auto-fix tasks skip tsc
    );

    this.logger.info('[Nova] Auto-fixing image errors...');
    this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_start' } });
    this.eventBus.emit({ type: 'task_started', data: { taskId: task.id } });
    this.wsServer.sendEvent({ type: 'task_created', data: task });

    const result = await executor.execute(task, this.projectMap);
    setTimeout(() => this.autofixTaskIds.delete(task.id), 5000);
    return result;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Legacy wrapper methods (kept for backward compatibility)
  // ─────────────────────────────────────────────────────────────────────────

  private async fixImageError(errorOutput: string): Promise<void> {
    await this.attemptAutoFix(errorOutput);
  }

  private async fixCompilationError(errorOutput: string): Promise<void> {
    await this.attemptAutoFix(errorOutput);
  }

  private async fixWithLane2(targetFile: string, errorOutput: string): Promise<void> {
    const taskDescription =
      `Fix the following compilation/build error in the project. ` +
      `Read the error carefully and fix the root cause:\n${errorOutput.slice(0, 500)}`;
    const result = await this.executeLane2Core(targetFile, taskDescription);
    if (result.success) {
      this.logger.info('[Nova] Compilation error fixed automatically (Lane 2)');
      this.eventBus.emit({
        type: 'task_completed',
        data: {
          taskId: result.taskId,
          diff: result.diff ?? '',
          commitHash: result.commitHash ?? '',
        },
      });
      this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_end' } });
    } else {
      this.logger.error(`[Nova] Auto-fix failed: ${result.error}`);
      const failEvent = {
        type: 'task_failed' as const,
        data: { taskId: result.taskId, error: result.error ?? 'Auto-fix failed' },
      };
      this.eventBus.emit(failEvent);
      this.wsServer.sendEvent(failEvent);
      this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_failed' } });
    }
  }

  private async fixWithLane3(errorOutput: string): Promise<void> {
    const taskDescription =
      `Fix the following compilation/build error in the project. ` +
      `Read the error carefully and fix the root cause:\n${errorOutput.slice(0, 500)}`;
    const result = await this.executeLane3Core(taskDescription);

    // Clear Next.js/Turbopack cache after fix to avoid stale compilation errors
    try {
      const { rmSync } = await import('node:fs');
      const { join } = await import('node:path');
      const nextCache = join(this.projectPath, '.next', 'cache');
      rmSync(nextCache, { recursive: true, force: true });
    } catch {
      /* cache dir may not exist */
    }

    if (result.success) {
      this.logger.info('[Nova] Compilation error fixed automatically');
      this.eventBus.emit({
        type: 'task_completed',
        data: {
          taskId: result.taskId,
          diff: result.diff ?? '',
          commitHash: result.commitHash ?? '',
        },
      });
      this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_end' } });
    } else {
      this.logger.error(`[Nova] Auto-fix failed: ${result.error}`);
      const failEvent = {
        type: 'task_failed' as const,
        data: { taskId: result.taskId, error: result.error ?? 'Auto-fix failed' },
      };
      this.eventBus.emit(failEvent);
      this.wsServer.sendEvent(failEvent);
      this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_failed' } });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // File path extraction
  // ─────────────────────────────────────────────────────────────────────────

  private extractFilePath(errorOutput: string): string | null {
    // Common patterns for file paths in error output.
    // Turbopack format: "⨯ ./app/page.tsx:2:1" on its own line, or
    // "  ./app/page.tsx:2:1" with leading whitespace.
    const patterns = [
      // Turbopack standalone path with optional leading whitespace + ⨯
      /^\s*[⨯✗✘]\s+(\.\/)?([^\s:]+\.[tj]sx?)\s*:\d+/m,
      // "./path/to/file.tsx" anywhere in the text
      /\.\/([^\s:]+\.[tj]sx?)/,
      // "in/at/from path/to/file.tsx"
      /(?:in|at|from)\s+([^\s:]+\.[tj]sx?)/i,
      // "path/to/file.tsx:line" or "path/to/file.tsx " (trailing space/colon)
      /([^\s:]+\.[tj]sx?)[\s:]/,
    ];
    for (const p of patterns) {
      const match = errorOutput.match(p);
      if (match) {
        // Turbopack pattern has two capture groups; use the one that's not undefined
        const filePath = match[2] ?? match[1]!;
        return filePath;
      }
    }
    return null;
  }
}

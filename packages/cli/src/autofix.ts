import type {
  LlmClient,
  ProjectMap,
  TaskItem,
  IGitManager,
  EventBus,
  ILogger,
  ExecutionResult,
} from '@novastorm-ai/core';
import {
  Lane2Executor,
  Lane3Executor,
  Lane5Executor,
  CommitQueue,
  StructuredLogger,
} from '@novastorm-ai/core';
import type { MissionConfig } from '@novastorm-ai/core';
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
  /both match path/i,
  /skipping\s+\S+\s+\(conflict\)/i,
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
  private consecutiveEmptyFixes = 0;
  private readonly MAX_CONSECUTIVE_EMPTY_FIXES = 3;
  /** Errors queued while a fix is in progress — processed when it finishes. */
  private pendingErrors: string[] = [];
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
    private readonly lane5Executor?: Lane5Executor,
    private readonly missionConfig?: MissionConfig,
    private readonly restartDevServer?: () => Promise<void>,
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
    // Skip non-fixable runtime/port errors -- nothing the LLM can fix by editing code
    if (/EADDRINUSE/i.test(output)) {
      this.logger.debug('[Nova] AutoFixer: EADDRINUSE port conflict, not fixable by code edits');
      return;
    }
    if (this.isFixing) {
      // Queue the error for processing after the current fix completes
      this.pendingErrors.push(output);
      this.logger.debug('[Nova] AutoFixer: already fixing, queued error for later');
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
        this.consecutiveEmptyFixes++;
      } else {
        this.lastErrorSignature = errorSig;
        this.fixAttempts = 1;
        this.consecutiveEmptyFixes = 0;
      }

      if (this.fixAttempts > this.MAX_FIX_ATTEMPTS) {
        this.logger.warn(
          `[Nova] AutoFixer: same error after ${this.MAX_FIX_ATTEMPTS} attempts, stopping. Fix manually.`,
        );
        this.cooldownUntil = Date.now() + 60_000; // 1 minute cooldown
        this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_failed' } });
        return;
      }

      // Stop after consecutive "successful" fixes that didn't resolve the error
      if (this.consecutiveEmptyFixes >= this.MAX_CONSECUTIVE_EMPTY_FIXES) {
        this.logger.warn(
          `[Nova] AutoFixer: fix reported success ${this.MAX_CONSECUTIVE_EMPTY_FIXES} times but error persists. Fix manually.`,
        );
        this.cooldownUntil = Date.now() + 120_000; // 2 minute cooldown
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
      let usedLane = 0; // Track which lane was used for budget exhaustion context

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

          // Refresh projectMap with current file content to avoid context mismatches
          if (/context mismatch/i.test(previousFailure)) {
            const targetFile = this.extractFilePath(errorOutput);
            if (targetFile && this.projectMap.fileContexts.has(targetFile)) {
              try {
                const { readFileSync } = await import('node:fs');
                const { join: pjoin } = await import('node:path');
                const absPath = pjoin(this.projectPath, targetFile);
                const freshContent = readFileSync(absPath, 'utf-8');
                const ctx = this.projectMap.fileContexts.get(targetFile)!;
                ctx.content = freshContent;
                this.logger.debug(
                  `[Nova] AutoFixer: refreshed projectMap for ${targetFile} (context mismatch recovery)`,
                );
              } catch {
                // File may not exist, skip
              }
            }
          }
        }

        const taskDescription = await this.buildTaskDescription(errorOutput, attempt, previousFailure);

        let result: ExecutionResult;

        if (isImageError) {
          result = await this.executeImageFixCore(errorOutput, taskDescription);
          usedLane = 3;
        } else {
          const coreResult = await this.executeCompilationFixCore(errorOutput, taskDescription);
          result = coreResult.result;
          usedLane = coreResult.usedLane;
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

          // Restart dev server to verify the fix actually resolved the error
          if (this.restartDevServer) {
            try {
              await this.restartDevServer();
            } catch {
              this.logger.warn('[Nova] AutoFixer: dev server restart after fix failed');
            }
          }

          // Reset dedup tracking so a re-appearing error triggers fresh fix attempts
          // (not blocked by stale cooldown or dedup counter from before the fix)
          this.lastErrorSignature = '';
          this.fixAttempts = 0;

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
          lane: usedLane,
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

      // Process any errors that arrived while the fix was in progress
      // (e.g. from the restarted dev server after a successful fix)
      if (this.pendingErrors.length > 0) {
        const queued = this.pendingErrors.join('\n');
        this.pendingErrors = [];
        this.handleOutput(queued);
      }
    }
  }

  /**
   * Build the task description sent to the LLM, including deletion-intent
   * guidance when the error suggests conflicting/duplicate files.
   */
  private async buildTaskDescription(
    errorOutput: string,
    attempt: number,
    previousFailure?: string,
  ): Promise<string> {
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
        'Use === DELETE: path/to/file.tsx === to delete the conflicting file. ' +
        'Do NOT empty the file -- use DELETE to remove it entirely.';
    }

    // Include previous failure context on retry so the LLM tries a different approach
    if (attempt > 1 && previousFailure) {
      description +=
        `\n\nPrevious attempt ${attempt - 1} failed: ${previousFailure}. ` +
        'Try a DIFFERENT approach. Do not repeat the same fix.';
      // On context mismatch, include current file content so the LLM has accurate context
      if (/context mismatch/i.test(previousFailure)) {
        const targetFile = this.extractFilePath(errorOutput);
        if (targetFile) {
          try {
            const { readFileSync } = await import('node:fs');
            const { join } = await import('node:path');
            const absPath = join(this.projectPath, targetFile);
            const fileContent = readFileSync(absPath, 'utf-8');
            description +=
              '\n\nCURRENT FILE CONTENT of ' + targetFile + ':\n```\n' + fileContent + '\n```\n' +
              'The previous diff failed because the file content changed. ' +
              'Generate your diff based on the CURRENT file content shown above.';
          } catch {
            // File may not exist, skip
          }
        }
      }

      // If deletion was needed but the LLM didn't produce a DELETE block,
      // be extremely explicit about the required format
      if (hasDeletionIntent) {
        description +=
          '\n\nCRITICAL: You MUST use EXACTLY this format to delete files:\n' +
          '=== DELETE: path/to/file.ts ===\n' +
          'No other content, no explanations, no FILE or DIFF blocks for the conflicting file.\n' +
          'Just the single === DELETE: ... === line.';
      }
    }

    return description;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Core execution methods (create task, run executor, return ExecutionResult)
  // ─────────────────────────────────────────────────────────────────────────

  private async executeCompilationFixCore(
    errorOutput: string,
    taskDescription: string,
  ): Promise<{ result: ExecutionResult; usedLane: number }> {
    this.logger.warn('[Nova] Detected compilation error -- attempting auto-fix');
    this.wsServer.sendEvent({
      type: 'status',
      data: { message: 'Compilation error detected. Auto-fixing...' },
    });

    let targetFile = this.extractFilePath(errorOutput);

    // ── Lane 5 routing: complex errors → mission execution ────────
    const isImageError = IMAGE_PATTERNS.some((p) => p.test(errorOutput));
    if (!isImageError && this.shouldUseLane5(errorOutput) && this.lane5Executor) {
      const knownFiles = Array.from(this.projectMap.fileContexts.keys());
      const affectedFiles = knownFiles.filter((f) => errorOutput.includes(f));
      if (targetFile && !affectedFiles.includes(targetFile)) {
        affectedFiles.push(targetFile);
      }

      // For route conflicts, include conflicting route files
      const routeConflictMatch =
        errorOutput.match(/both match path:?\s*['"]?(\S+?)['"]?[\s.]/i) ||
        errorOutput.match(/skipping\s+(\S+)\s+\(conflict\)/i);
      if (routeConflictMatch) {
        const conflictPath = routeConflictMatch[1]!;
        const conflictingFiles = this.findConflictingRouteFiles(conflictPath);
        for (const cf of conflictingFiles) {
          if (!affectedFiles.includes(cf)) affectedFiles.push(cf);
        }
        this.logger.info(
          `[Nova] Route conflict detected for ${conflictPath}: routing to Lane 5`,
        );
      }

      const result = await this.executeLane5Core(taskDescription, affectedFiles);
      return { result, usedLane: 5 };
    }

    // ── Deterministic fix: App Router vs Pages Router route conflict ──
    const routeConflictMatch =
      errorOutput.match(/both match path:?\s*['"]?(\S+?)['"]?[\s.]/i) ||
      errorOutput.match(/skipping\s+(\S+)\s+\(conflict\)/i);
    if (routeConflictMatch) {
      const conflictPath = routeConflictMatch[1]!;
      // Detect conflicting files directly on disk (projectMap may not index pages/)
      const { existsSync, unlinkSync } = await import('node:fs');
      const { join } = await import('node:path');
      const normalized = conflictPath === '/' ? 'index' : conflictPath.replace(/^\/+/, '');
      const appCandidates =
        conflictPath === '/'
          ? ['app/page.tsx', 'app/page.ts', 'app/page.jsx', 'app/page.js']
          : [
              `app/${normalized}/page.tsx`,
              `app/${normalized}/page.ts`,
              `app/${normalized}/page.jsx`,
              `app/${normalized}/page.js`,
            ];
      const pagesCandidates =
        conflictPath === '/'
          ? ['pages/index.tsx', 'pages/index.ts', 'pages/index.jsx', 'pages/index.js']
          : [
              `pages/${normalized}.tsx`,
              `pages/${normalized}.ts`,
              `pages/${normalized}.jsx`,
              `pages/${normalized}.js`,
            ];
      const appFile = appCandidates.find((p) => existsSync(join(this.projectPath, p)));
      const pagesFile = pagesCandidates.find((p) => existsSync(join(this.projectPath, p)));
      const conflictingFiles = [appFile, pagesFile].filter((f): f is string => !!f);
      // Partial conflict (one file already deleted) -- stale log noise
      if (conflictingFiles.length === 1) {
        this.logger.info(
          `[Nova] Route conflict regex matched but only ${conflictingFiles[0]} exists; conflict already resolved`,
        );
        const taskId = `autofix-route-noop-${Date.now()}`;
        this.autofixTaskIds.add(taskId);
        return { result: { success: true, taskId, diff: '', commitHash: '' }, usedLane: 3 };
      }
      if (appFile && pagesFile) {
        this.logger.info(
          `[Nova] Route conflict for ${conflictPath}: deterministically deleting ${pagesFile} (keeping App Router)`,
        );
        try {
          const absPath = join(this.projectPath, pagesFile);
          if (existsSync(absPath)) unlinkSync(absPath);
          this.projectMap.fileContexts.delete(pagesFile);
          let commitHash = '';
          try {
            commitHash = await this.gitManager.commit(
              `autofix: remove conflicting route ${pagesFile}`,
              [pagesFile],
            );
          } catch (e) {
            this.logger.debug(
              `[Nova] Git commit for deletion skipped: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
          const taskId = `autofix-route-${Date.now()}`;
          this.autofixTaskIds.add(taskId);
          const result: ExecutionResult = {
            success: true,
            taskId,
            diff: `--- a/${pagesFile}\n+++ /dev/null\n`,
            commitHash,
          };
          return { result, usedLane: 3 };
        } catch (e) {
          this.logger.error(
            `[Nova] Deterministic route conflict fix failed: ${
              e instanceof Error ? e.message : String(e)
            }; falling back to LLM`,
          );
        }
      }
      if (conflictingFiles.length > 0) {
        this.logger.info(
          `[Nova] Route conflict detected for ${conflictPath}: ${conflictingFiles.join(', ')}`,
        );
        const enhancedDescription =
          taskDescription +
          `\n\nConflicting files:\n` +
          conflictingFiles.map((f) => `  - ${f} (DELETE this file)`).join('\n') +
          `\n\nYou MUST use === DELETE: ... === to remove ONE of these conflicting files.`;
        const result = await this.executeLane3Core(enhancedDescription, conflictingFiles);
        return { result, usedLane: 3 };
      }
    }

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

    // Module-not-found errors: try deterministic file creation for @/ aliases
    const moduleNotFoundResult = await this.handleModuleNotFound(errorOutput);
    if (moduleNotFoundResult) {
      return { result: moduleNotFoundResult, usedLane: 3 };
    }

    const result =
      targetFile && this.projectMap.fileContexts.has(targetFile)
        ? await this.executeLane2Core(targetFile, taskDescription)
        : await this.executeLane3Core(taskDescription);

    return { result, usedLane: targetFile && this.projectMap.fileContexts.has(targetFile) ? 2 : 3 };
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

  private async executeLane3Core(
    taskDescription: string,
    files: string[] = [],
  ): Promise<ExecutionResult> {
    const task: TaskItem = {
      id: crypto.randomUUID(),
      description: taskDescription,
      files,
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
  // Lane 5 (mission) execution for complex errors
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Execute an auto-fix via Lane 5 (mission-based execution).
   * Emits autofix_start before execution and relies on the Lane5Executor
   * to emit mission lifecycle events (mission_planned, etc.).
   */
  private async executeLane5Core(
    taskDescription: string,
    files: string[] = [],
  ): Promise<ExecutionResult> {
    if (!this.lane5Executor) {
      return {
        success: false,
        taskId: '',
        error: 'Lane 5 executor not available',
      };
    }

    const task: TaskItem = {
      id: crypto.randomUUID(),
      description: taskDescription,
      files,
      type: 'multi_file',
      lane: 5,
      status: 'pending',
    };
    this.autofixTaskIds.add(task.id);

    this.logger.info('[Nova] Auto-fixing complex error via Lane 5 (mission)...');
    this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_start' } });
    this.eventBus.emit({ type: 'task_started', data: { taskId: task.id } });
    this.wsServer.sendEvent({ type: 'task_created', data: task });

    const result = await this.lane5Executor.execute(task, this.projectMap);
    setTimeout(() => this.autofixTaskIds.delete(task.id), 5000);
    return result;
  }

  /**
   * Determine whether a compilation error should be routed to Lane 5 instead
   * of Lane 2/3.  Checks mission config gating first, then inspects the error
   * output for complex-error signals: route conflicts, high file count,
   * or duplicate/conflicting keywords.
   */
  private shouldUseLane5(errorOutput: string): boolean {
    // Mission config gating: when no [mission] section, default to disabled (Lane 3)
    if (!this.missionConfig?.enabled) return false;
    if (!this.lane5Executor) return false;

    // Route conflict: "both match path" (Next.js App/Pages router conflict) or Next 16 Turbopack "skipping X (conflict)"
    if (/both match path/i.test(errorOutput)) return true;
    if (/skipping\s+\S+\s+\(conflict\)/i.test(errorOutput)) return true;

    // Duplicate/conflicting keywords (use the existing DELETION_INTENT_KEYWORDS)
    if (DELETION_INTENT_KEYWORDS.some((p) => p.test(errorOutput))) return true;

    // High file count: error affects >3 project files
    const affectedCount = this.countAffectedFiles(errorOutput);
    if (affectedCount > 3) return true;

    return false;
  }

  /**
   * Count how many project files are mentioned in the error output text.
   */
  private countAffectedFiles(errorOutput: string): number {
    const knownFiles = Array.from(this.projectMap.fileContexts.keys());
    let count = 0;
    for (const f of knownFiles) {
      if (errorOutput.includes(f)) {
        count++;
      }
    }
    return count;
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
  // Module-not-found deterministic handler
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * When Next.js reports "Module not found: Can't resolve 'X'", attempt to
   * create the missing file deterministically instead of modifying the importing file.
   * Returns a success result if the file was created, null if not applicable.
   */
  private async handleModuleNotFound(
    errorOutput: string,
  ): Promise<ExecutionResult | null> {
    const match = errorOutput.match(/Module not found: Can't resolve '([^']+)'/);
    if (!match) return null;

    const unresolvedPath = match[1]!;
    // Skip obvious external/deleted modules
    if (
      /node_modules/i.test(unresolvedPath) ||
      /https?:\/\//i.test(unresolvedPath) ||
      /\.(png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot|css|scss|sass|less)$/i.test(unresolvedPath)
    ) {
      return null; // Let image patterns handle images, skip CSS/fonts
    }

    // Find the importing file to resolve relative paths
    const importingFile = this.extractFilePath(errorOutput);
    if (!importingFile) return null;

    try {
      const { join, dirname, resolve } = await import('node:path');
      const { readFileSync, existsSync } = await import('node:fs');

      // Safety check: importing file must exist on disk (prevents false positives in tests)
      const importingAbsPath = join(this.projectPath, importingFile);
      if (!existsSync(importingAbsPath)) return null;

      const importingDir = dirname(importingAbsPath);

      let targetPath: string;
      if (unresolvedPath.startsWith('@/')) {
        // Path alias: @/components/foo → src/components/foo.tsx (or just components/foo.tsx)
        const relativePath = unresolvedPath.slice(2);
        const candidates = [
          join(this.projectPath, 'src', relativePath + '.tsx'),
          join(this.projectPath, relativePath + '.tsx'),
          join(this.projectPath, 'src', relativePath, 'index.tsx'),
          join(this.projectPath, relativePath, 'index.tsx'),
        ];
        const existing = candidates.find((p) => existsSync(p));
        if (existing) return null; // File already exists, something else is wrong
        targetPath = candidates[0]!;
      } else {
        // Relative or bare module: let the LLM handle it (directory structures vary)
        return null;
      }

      // Don't create if file already exists
      if (existsSync(targetPath)) return null;

      // Create a stub component file
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const targetDir = dirname(targetPath);
      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }

      const componentName = unresolvedPath.split('/').pop()!;
      const pascalName = componentName
        .split(/[-_.]/)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join('');

      const stub = `export function ${pascalName}() {
  return <div>${pascalName}</div>;
}
`;
      writeFileSync(targetPath, stub, 'utf-8');

      // Determine relative path for git commit
      const relativePath = targetPath.slice(this.projectPath.length + 1);

      let commitHash = '';
      try {
        commitHash = await this.gitManager.commit(
          `autofix: create missing module ${relativePath}`,
          [relativePath],
        );
      } catch (e) {
        this.logger.debug(
          `[Nova] Git commit for module creation skipped: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      this.logger.info(
        `[Nova] Created missing module: ${relativePath} (resolved from "${unresolvedPath}")`,
      );

      const taskId = `autofix-module-${Date.now()}`;
      this.autofixTaskIds.add(taskId);
      return {
        success: true,
        taskId,
        diff: `+++ b/${relativePath}
${stub}`,
        commitHash,
      };
    } catch (e) {
      this.logger.error(
        `[Nova] Module-not-found deterministic fix failed: ${
          e instanceof Error ? e.message : String(e)
        }; falling back to LLM`,
      );
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // File path extraction
  // ─────────────────────────────────────────────────────────────────────────

  private extractFilePath(errorOutput: string): string | null {
    // Common patterns for file paths in error output.
    // Turbopack/Next.js format: "⨯ ./app/page.tsx:2:1" or "❌ ./app/page.tsx:2:1"
    // on its own line, or "  ./app/page.tsx:2:1" with leading whitespace.
    const patterns = [
      // Turbopack/Next.js standalone path with optional leading whitespace + error marker
      /^\s*[⨯✗✘❌]\s+(\.\/)?([^\s:]+\.[tj]sx?)\s*:\d+/m,
      // Next.js [error] format: "❌ [error] ./path/to/file.tsx"
      /\[error\]\s+(\.\/)?([^\s:]+\.[tj]sx?)/i,
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
        // Turbopack/Next.js patterns have two capture groups; use the one that's not undefined
        const filePath = match[2] ?? match[1]!;
        return filePath;
      }
    }
    return null;
  }

  /**
   * Given a route path (e.g., "/" or "/admin"), finds the conflicting
   * App Router and Pages Router files that both resolve to that path.
   * Returns an array of file paths relative to project root.
   */
  private findConflictingRouteFiles(routePath: string): string[] {
    const knownFiles = Array.from(this.projectMap.fileContexts.keys());

    // Map route path to Next.js file conventions
    const result: string[] = [];

    if (routePath === '/') {
      // Root path: app/page.tsx vs pages/index.tsx
      const appFile = knownFiles.find(
        (f) =>
          f === 'app/page.tsx' || f === 'app/page.ts' || f === 'app/page.jsx' || f === 'app/page.js',
      );
      const pagesFile = knownFiles.find(
        (f) =>
          f === 'pages/index.tsx' ||
          f === 'pages/index.ts' ||
          f === 'pages/index.jsx' ||
          f === 'pages/index.js',
      );
      if (appFile) result.push(appFile);
      if (pagesFile) result.push(pagesFile);
    } else {
      // Nested routes: e.g., /admin -> app/admin/page.tsx vs pages/admin.tsx
      const normalized = routePath.replace(/^\/+/, '');
      const appFile = knownFiles.find(
        (f) =>
          f === `app/${normalized}/page.tsx` ||
          f === `app/${normalized}/page.ts` ||
          f === `app/${normalized}/page.jsx` ||
          f === `app/${normalized}/page.js`,
      );
      const pagesFile = knownFiles.find(
        (f) =>
          f === `pages/${normalized}.tsx` ||
          f === `pages/${normalized}.ts` ||
          f === `pages/${normalized}.jsx` ||
          f === `pages/${normalized}.js`,
      );
      if (appFile) result.push(appFile);
      if (pagesFile) result.push(pagesFile);
    }

    return result;
  }
}

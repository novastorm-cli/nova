import chalk from 'chalk';
import type {
  LlmClient,
  ProjectMap,
  TaskItem,
  IGitManager,
  EventBus,
  ILogger,
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
      ERROR_PATTERNS.some((p) => p.test(output)) ||
      IMAGE_PATTERNS.some((p) => p.test(output));

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

  /** Force an immediate fix attempt, bypassing debounce and pattern check. */
  forceFixNow(errorOutput: string): void {
    if (this.isFixing) {
      this.logger.debug('[Nova] AutoFixer: already fixing, skipping forced fix');
      return;
    }
    void this.attemptAutoFix(errorOutput);
  }

  private async attemptAutoFix(errorOutput: string): Promise<void> {
    if (this.isFixing) return;

    // Deduplicate: if same error keeps appearing, stop after MAX_FIX_ATTEMPTS
    const errorSig = errorOutput.slice(0, 200);
    if (errorSig === this.lastErrorSignature) {
      this.fixAttempts++;
    } else {
      this.lastErrorSignature = errorSig;
      this.fixAttempts = 1;
    }

    if (this.fixAttempts > this.MAX_FIX_ATTEMPTS) {
      this.logger.warn(`[Nova] AutoFixer: same error after ${this.MAX_FIX_ATTEMPTS} attempts, stopping. Fix manually.`);
      this.cooldownUntil = Date.now() + 60_000; // 1 minute cooldown
      this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_failed' } });
      return;
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
      const isImageError = IMAGE_PATTERNS.some((p) => p.test(errorOutput));

      if (isImageError) {
        await this.fixImageError(errorOutput);
        return;
      }

      await this.fixCompilationError(errorOutput);
    } finally {
      clearTimeout(safetyTimer);
      this.isFixing = false;
    }
  }

  private async fixImageError(errorOutput: string): Promise<void> {
    this.logger.warn(
      '[Nova] Detected image loading error — replacing with placeholders',
    );
    this.wsServer.sendEvent({
      type: 'status',
      data: {
        message: 'Image error detected. Replacing with placeholders...',
      },
    });

    // Detect if it's a next/image hostname error
    const hostnameMatch = errorOutput.match(/hostname "([^"]+)" is not configured/);
    const invalidSrcMatch = errorOutput.match(/Invalid src prop \(([^)]+)\)/);

    let description: string;
    if (hostnameMatch || invalidSrcMatch) {
      const hostname = hostnameMatch?.[1] ?? 'unknown';
      description = `Fix next/image error. Two options (pick the simpler one):
1. Replace all next/image <Image> tags that use external URLs with regular <img> tags.
2. OR add the hostname "${hostname}" to images.remotePatterns in next.config.ts/next.config.mjs.
Also: replace any invalid/fake image URLs (like https://invalid-url.com/*) with working placeholder URLs from https://picsum.photos (e.g. https://picsum.photos/800/600).
Error: ${errorOutput.slice(0, 300)}`;
    } else {
      description = `Fix image loading errors. Replace all broken/missing image references with working placeholder URLs from https://picsum.photos (e.g. https://picsum.photos/800/600 for large, https://picsum.photos/400/300 for medium). Use regular <img> tags instead of next/image <Image> for external URLs. Error: ${errorOutput.slice(0, 200)}`;
    }

    const task: TaskItem = {
      id: crypto.randomUUID(),
      description,
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
      1,  // maxFixIterations — single pass for auto-fix
      this.microModel,
      undefined, // agentPromptLoader
      undefined, // pathGuard
      this.commitQueue,
      true, // skipValidation — auto-fix tasks skip tsc
    );

    this.logger.info('[Nova] Auto-fixing image errors...');
    this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_start' } });
    this.eventBus.emit({ type: 'task_started', data: { taskId: task.id } });
    this.wsServer.sendEvent({ type: 'task_created', data: task });

    const result = await executor.execute(task, this.projectMap);
    setTimeout(() => this.autofixTaskIds.delete(task.id), 5000);

    if (result.success) {
      this.logger.info('[Nova] Image errors fixed automatically');
      this.eventBus.emit({
        type: 'task_completed',
        data: { taskId: task.id, diff: result.diff ?? '', commitHash: result.commitHash ?? '' },
      });
      this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_end' } });
    } else {
      this.logger.error(`[Nova] Failed to fix image errors: ${result.error}`);
      const failEvent = { type: 'task_failed' as const, data: { taskId: task.id, error: result.error ?? 'Image fix failed' } };
      this.eventBus.emit(failEvent);
      this.wsServer.sendEvent(failEvent);
      this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_failed' } });
    }
  }

  private async fixCompilationError(errorOutput: string): Promise<void> {
    this.logger.warn(
      '[Nova] Detected compilation error — attempting auto-fix',
    );
    this.wsServer.sendEvent({
      type: 'status',
      data: { message: 'Compilation error detected. Auto-fixing...' },
    });

    let targetFile = this.extractFilePath(errorOutput);

    // Fallback: if extractFilePath returned null, scan the project map
    // for files mentioned in the error text (e.g., Turbopack puts
    // "⨯ ./app/page.tsx:2:1" on a line that may arrive in a different
    // output chunk).
    if (!targetFile) {
      const knownFiles = Array.from(this.projectMap.fileContexts.keys());
      for (const f of knownFiles) {
        if (errorOutput.includes(f)) {
          targetFile = f;
          break;
        }
      }
      // Also try matching file paths without leading ./
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

    if (targetFile && this.projectMap.fileContexts.has(targetFile)) {
      // Simple single-file error — use fast Lane 2
      await this.fixWithLane2(targetFile, errorOutput);
    } else {
      // Complex/unknown error — use Lane 3
      await this.fixWithLane3(errorOutput);
    }
  }

  private async fixWithLane2(targetFile: string, errorOutput: string): Promise<void> {
    const truncatedError = errorOutput.slice(0, 500);

    const task: TaskItem = {
      id: crypto.randomUUID(),
      description: `Fix the following compilation/build error in the project. Read the error carefully and fix the root cause:\n${truncatedError}`,
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

    if (result.success) {
      this.logger.info('[Nova] Compilation error fixed automatically (Lane 2)');
      this.eventBus.emit({
        type: 'task_completed',
        data: { taskId: task.id, diff: result.diff ?? '', commitHash: result.commitHash ?? '' },
      });
      this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_end' } });
    } else {
      this.logger.error(`[Nova] Auto-fix failed: ${result.error}`);
      const failEvent = { type: 'task_failed' as const, data: { taskId: task.id, error: result.error ?? 'Auto-fix failed' } };
      this.eventBus.emit(failEvent);
      this.wsServer.sendEvent(failEvent);
      this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_failed' } });
    }
  }

  private async fixWithLane3(errorOutput: string): Promise<void> {
    const truncatedError = errorOutput.slice(0, 500);

    const task: TaskItem = {
      id: crypto.randomUUID(),
      description: `Fix the following compilation/build error in the project. Read the error carefully and fix the root cause:\n${truncatedError}`,
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
      1,  // maxFixIterations — single pass for auto-fix
      this.microModel,
      undefined, // agentPromptLoader
      undefined, // pathGuard
      this.commitQueue,
      true, // skipValidation — auto-fix tasks skip tsc
    );

    this.logger.info('[Nova] Auto-fixing compilation error...');
    this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_start' } });
    this.eventBus.emit({ type: 'task_started', data: { taskId: task.id } });
    this.wsServer.sendEvent({ type: 'task_created', data: task });

    const result = await executor.execute(task, this.projectMap);
    setTimeout(() => this.autofixTaskIds.delete(task.id), 5000);

    // Clear Next.js/Turbopack cache after fix to avoid stale compilation errors
    try {
      const { rmSync } = await import('node:fs');
      const { join } = await import('node:path');
      const nextCache = join(this.projectPath, '.next', 'cache');
      rmSync(nextCache, { recursive: true, force: true });
    } catch { /* cache dir may not exist */ }

    if (result.success) {
      this.logger.info('[Nova] Compilation error fixed automatically');
      this.eventBus.emit({
        type: 'task_completed',
        data: { taskId: task.id, diff: result.diff ?? '', commitHash: result.commitHash ?? '' },
      });
      this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_end' } });
    } else {
      this.logger.error(`[Nova] Auto-fix failed: ${result.error}`);
      const failEvent = { type: 'task_failed' as const, data: { taskId: task.id, error: result.error ?? 'Auto-fix failed' } };
      this.eventBus.emit(failEvent);
      this.wsServer.sendEvent(failEvent);
      this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_failed' } });
    }
  }

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

import chalk from 'chalk';
import type {
  LlmClient,
  ProjectMap,
  TaskItem,
  IGitManager,
  EventBus,
} from '@nova-architect/core';
import { Lane3Executor } from '@nova-architect/core';
import type { WebSocketServer } from '@nova-architect/proxy';

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
  private readonly DEBOUNCE_MS = 2000;

  constructor(
    private readonly projectPath: string,
    private readonly llmClient: LlmClient,
    private readonly gitManager: IGitManager,
    private readonly eventBus: EventBus,
    private readonly wsServer: WebSocketServer,
    private readonly projectMap: ProjectMap,
  ) {}

  /**
   * Process dev server output. Call this for every stdout/stderr chunk.
   */
  handleOutput(output: string): void {
    const hasError =
      ERROR_PATTERNS.some((p) => p.test(output)) ||
      IMAGE_PATTERNS.some((p) => p.test(output));

    if (!hasError) return;
    if (this.isFixing) {
      console.log(chalk.dim('[Nova] AutoFixer: already fixing, queuing...'));
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
      console.log(chalk.dim('[Nova] AutoFixer: already fixing, skipping forced fix'));
      return;
    }
    void this.attemptAutoFix(errorOutput);
  }

  private async attemptAutoFix(errorOutput: string): Promise<void> {
    if (this.isFixing) return;
    this.isFixing = true;

    // Safety timeout: reset isFixing after 5 minutes max
    const safetyTimer = setTimeout(() => {
      if (this.isFixing) {
        console.log(chalk.dim('[Nova] AutoFixer: safety timeout, resetting'));
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
    console.log(
      chalk.yellow(
        '[Nova] Detected image loading error — replacing with placeholders',
      ),
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

    const executor = new Lane3Executor(
      this.projectPath,
      this.llmClient,
      this.gitManager,
      this.eventBus,
    );

    console.log(chalk.cyan('[Nova] Auto-fixing image errors...'));
    this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_start' } });
    this.eventBus.emit({ type: 'task_started', data: { taskId: task.id } });

    const result = await executor.execute(task, this.projectMap);

    if (result.success) {
      console.log(chalk.green('[Nova] Image errors fixed automatically'));
      this.eventBus.emit({
        type: 'task_completed',
        data: { taskId: task.id, diff: result.diff ?? '', commitHash: result.commitHash ?? '' },
      });
      this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_end' } });
    } else {
      console.log(chalk.red(`[Nova] Failed to fix image errors: ${result.error}`));
      this.eventBus.emit({ type: 'task_failed', data: { taskId: task.id, error: result.error ?? '' } });
      this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_end' } });
    }
  }

  private async fixCompilationError(errorOutput: string): Promise<void> {
    const truncatedError = errorOutput.slice(0, 500);

    console.log(
      chalk.yellow('[Nova] Detected compilation error — attempting auto-fix'),
    );
    this.wsServer.sendEvent({
      type: 'status',
      data: { message: 'Compilation error detected. Auto-fixing...' },
    });

    const task: TaskItem = {
      id: crypto.randomUUID(),
      description: `Fix the following compilation/build error in the project. Read the error carefully and fix the root cause:\n${truncatedError}`,
      files: [],
      type: 'multi_file',
      lane: 3,
      status: 'pending',
    };

    const executor = new Lane3Executor(
      this.projectPath,
      this.llmClient,
      this.gitManager,
      this.eventBus,
    );

    console.log(chalk.cyan('[Nova] Auto-fixing compilation error...'));
    this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_start' } });
    this.eventBus.emit({ type: 'task_started', data: { taskId: task.id } });
    this.wsServer.sendEvent({ type: 'task_created', data: task });

    const result = await executor.execute(task, this.projectMap);

    if (result.success) {
      console.log(chalk.green('[Nova] Compilation error fixed automatically'));
      this.eventBus.emit({
        type: 'task_completed',
        data: { taskId: task.id, diff: result.diff ?? '', commitHash: result.commitHash ?? '' },
      });
      this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_end' } });
    } else {
      console.log(chalk.red(`[Nova] Auto-fix failed: ${result.error}`));
      this.eventBus.emit({ type: 'task_failed', data: { taskId: task.id, error: result.error ?? '' } });
      this.wsServer.sendEvent({ type: 'status', data: { message: 'autofix_end' } });
    }
  }
}

import type { Observation, TaskItem } from '@novastorm-ai/core';
import type { ILogger } from '@novastorm-ai/core';
import { StructuredLogger } from '@novastorm-ai/core';

const PREFIX = '[Nova]';

export class NovaLogger {
  private readonly logger: ILogger;

  constructor(logger?: ILogger) {
    this.logger = logger ?? new StructuredLogger({ isTTY: process.stderr?.isTTY ?? false });
  }

  logObservation(observation: Observation): void {
    const action = observation.transcript ?? 'click';
    const screenshotSize = observation.screenshot?.length ?? 0;
    const url = observation.currentUrl || '(unknown)';
    this.logger.info(
      `${PREFIX} 📡 Observation: "${action}" at ${url}`,
      { screenshotSize, hasDom: !!observation.domSnapshot, errors: observation.consoleErrors?.length ?? 0 },
    );
  }

  logAnalyzing(transcript?: string): void {
    const suffix = transcript ? ` ${transcript}` : '';
    this.logger.info(`${PREFIX} 🧠 Analyzing...${suffix}`);
  }

  logTasks(tasks: TaskItem[]): void {
    this.logger.info(`${PREFIX} ✓ ${tasks.length} task(s) detected`);
    for (const task of tasks) {
      this.logger.info(`  → ${task.description} (Lane ${task.lane})`);
    }
  }

  logTaskStarted(task: TaskItem): void {
    this.logger.info(`${PREFIX} ⚡ Executing: ${task.description} (Lane ${task.lane})`);
  }

  logTaskCompleted(task: TaskItem): void {
    this.logger.info(`${PREFIX} ✓ Done: ${task.description} — ${task.commitHash ?? 'no hash'}`);
  }

  logTaskFailed(task: TaskItem): void {
    this.logger.error(`${PREFIX} ✗ Failed: ${task.description} — ${task.error ?? 'unknown error'}`);
  }

  logFileChanged(filePath: string): void {
    this.logger.info(`${PREFIX} 📝 Modified: ${filePath}`);
  }
}

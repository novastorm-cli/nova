import chalk from 'chalk';
import type { Observation, TaskItem } from '@nova-architect/core';

const PREFIX = '[Nova]';

export class NovaLogger {
  logObservation(observation: Observation): void {
    const action = observation.transcript ?? 'click';
    console.log(
      chalk.yellow(`${PREFIX} \u{1F4E1} Observation: ${action} at ${observation.currentUrl}`),
    );
  }

  logAnalyzing(transcript?: string): void {
    const suffix = transcript ? ` ${transcript}` : '';
    console.log(chalk.yellow(`${PREFIX} \u{1F9E0} Analyzing...${suffix}`));
  }

  logTasks(tasks: TaskItem[]): void {
    console.log(chalk.green(`${PREFIX} \u2705 ${tasks.length} task(s) detected`));
    for (const task of tasks) {
      console.log(chalk.dim(`  \u2192 ${task.description} (Lane ${task.lane})`));
    }
  }

  logTaskStarted(task: TaskItem): void {
    console.log(
      chalk.cyan(`${PREFIX} \u26A1 Executing: ${task.description} (Lane ${task.lane})`),
    );
  }

  logTaskCompleted(task: TaskItem): void {
    console.log(
      chalk.green(`${PREFIX} \u2705 Done: ${task.description} \u2014 ${task.commitHash ?? 'no hash'}`),
    );
  }

  logTaskFailed(task: TaskItem): void {
    console.log(
      chalk.red(`${PREFIX} \u274C Failed: ${task.description} \u2014 ${task.error ?? 'unknown error'}`),
    );
  }

  logFileChanged(filePath: string): void {
    console.log(chalk.dim(`${PREFIX} \u{1F4DD} Modified: ${filePath}`));
  }
}

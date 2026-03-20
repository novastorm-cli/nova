import { randomUUID } from 'node:crypto';
import type { EventBus, NovaEvent } from '../models/events.js';
import type { IHistoryStore } from '../contracts/IStorage.js';
import type { HistoryEntry, TaskItem } from '../models/types.js';

type TaskCreatedEvent = Extract<NovaEvent, { type: 'task_created' }>;
type TaskStartedEvent = Extract<NovaEvent, { type: 'task_started' }>;
type TaskCompletedEvent = Extract<NovaEvent, { type: 'task_completed' }>;
type TaskFailedEvent = Extract<NovaEvent, { type: 'task_failed' }>;

export class HistoryRecorder {
  private readonly historyStore: IHistoryStore;
  private readonly eventBus: EventBus;
  private readonly taskCache = new Map<string, TaskItem>();

  private readonly handleTaskCreated = (event: TaskCreatedEvent): void => {
    this.taskCache.set(event.data.id, event.data);
  };

  private readonly handleTaskStarted = (event: TaskStartedEvent): void => {
    const task = this.taskCache.get(event.data.taskId);
    const entry: HistoryEntry = {
      id: randomUUID(),
      taskId: event.data.taskId,
      description: task?.description ?? '',
      type: task?.type ?? 'single_file',
      lane: task?.lane ?? 1,
      status: 'running',
      filesChanged: task?.files ?? [],
      startedAt: Date.now(),
    };
    void this.historyStore.append(entry);
  };

  private readonly handleTaskCompleted = (event: TaskCompletedEvent): void => {
    void this.updateEntry(event.data.taskId, {
      status: 'done',
      commitHash: event.data.commitHash,
      diff: event.data.diff,
      completedAt: Date.now(),
    });
  };

  private readonly handleTaskFailed = (event: TaskFailedEvent): void => {
    void this.updateEntry(event.data.taskId, {
      status: 'failed',
      error: event.data.error,
      completedAt: Date.now(),
    });
  };

  constructor(historyStore: IHistoryStore, eventBus: EventBus) {
    this.historyStore = historyStore;
    this.eventBus = eventBus;
  }

  start(): void {
    this.eventBus.on('task_created', this.handleTaskCreated);
    this.eventBus.on('task_started', this.handleTaskStarted);
    this.eventBus.on('task_completed', this.handleTaskCompleted);
    this.eventBus.on('task_failed', this.handleTaskFailed);
  }

  stop(): void {
    this.eventBus.off('task_created', this.handleTaskCreated);
    this.eventBus.off('task_started', this.handleTaskStarted);
    this.eventBus.off('task_completed', this.handleTaskCompleted);
    this.eventBus.off('task_failed', this.handleTaskFailed);
  }

  private async updateEntry(
    taskId: string,
    updates: Partial<HistoryEntry>,
  ): Promise<void> {
    const existing = await this.historyStore.getByTaskId(taskId);
    if (!existing) return;

    const updated: HistoryEntry = { ...existing, ...updates };
    await this.historyStore.append(updated);
  }
}

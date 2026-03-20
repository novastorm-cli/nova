import { readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { HistoryEntry } from '../models/types.js';
import type { IHistoryStore } from '../contracts/IStorage.js';

export class HistoryStore implements IHistoryStore {
  private readonly historyPath: string;

  constructor(historyPath: string) {
    this.historyPath = historyPath;
  }

  async append(entry: HistoryEntry): Promise<void> {
    await mkdir(this.historyPath, { recursive: true });
    const fileName = `${entry.startedAt}-${entry.id}.json`;
    await writeFile(
      join(this.historyPath, fileName),
      JSON.stringify(entry, null, 2),
      'utf-8',
    );
  }

  async getAll(): Promise<HistoryEntry[]> {
    const files = await this.listJsonFiles();
    const entries: HistoryEntry[] = [];

    for (const file of files) {
      try {
        const raw = await readFile(join(this.historyPath, file), 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        entries.push(parsed as HistoryEntry);
      } catch {
        // skip corrupt files
      }
    }

    entries.sort((a, b) => b.startedAt - a.startedAt);
    return entries;
  }

  async getRecent(limit: number): Promise<HistoryEntry[]> {
    const all = await this.getAll();
    return all.slice(0, limit);
  }

  async getSince(timestamp: number): Promise<HistoryEntry[]> {
    const all = await this.getAll();
    return all.filter((e) => e.startedAt >= timestamp);
  }

  async getByTaskId(taskId: string): Promise<HistoryEntry | null> {
    const all = await this.getAll();
    return all.find((e) => e.taskId === taskId) ?? null;
  }

  async clear(): Promise<void> {
    const files = await this.listJsonFiles();
    for (const file of files) {
      await rm(join(this.historyPath, file), { force: true });
    }
  }

  private async listJsonFiles(): Promise<string[]> {
    try {
      const entries = await readdir(this.historyPath);
      return entries.filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
  }
}

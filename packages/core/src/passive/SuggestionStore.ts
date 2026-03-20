import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { PassiveSuggestion, SuggestionStatus } from '../models/types.js';

export class SuggestionStore {
  private readonly dir: string;

  constructor(novaPath: string) {
    this.dir = join(novaPath, 'suggestions');
  }

  async save(suggestion: PassiveSuggestion): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const filePath = join(this.dir, `${suggestion.id}.json`);
    await writeFile(filePath, JSON.stringify(suggestion, null, 2), 'utf-8');
  }

  async load(): Promise<PassiveSuggestion[]> {
    await mkdir(this.dir, { recursive: true });
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }

    const suggestions: PassiveSuggestion[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = await readFile(join(this.dir, file), 'utf-8');
        suggestions.push(JSON.parse(content) as PassiveSuggestion);
      } catch {
        // Skip corrupted files
      }
    }

    return suggestions;
  }

  async update(id: string, status: SuggestionStatus): Promise<void> {
    const filePath = join(this.dir, `${id}.json`);
    try {
      const content = await readFile(filePath, 'utf-8');
      const suggestion = JSON.parse(content) as PassiveSuggestion;
      suggestion.status = status;
      suggestion.respondedAt = Date.now();
      await writeFile(filePath, JSON.stringify(suggestion, null, 2), 'utf-8');
    } catch {
      // Suggestion not found — ignore
    }
  }

  async cleanup(olderThanMs: number): Promise<void> {
    const suggestions = await this.load();
    const cutoff = Date.now() - olderThanMs;

    for (const suggestion of suggestions) {
      if (suggestion.createdAt < cutoff) {
        try {
          await unlink(join(this.dir, `${suggestion.id}.json`));
        } catch {
          // Already removed — ignore
        }
      }
    }
  }
}

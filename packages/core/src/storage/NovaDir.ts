import { mkdir, rm, readFile, writeFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { INovaDir } from '../contracts/IStorage.js';
import { DEFAULT_AGENT_PROMPTS } from './agentPrompts.js';

const NOVA_DIR = '.nova';

const SUBDIRS = ['recipes', 'history', 'cache', 'agents', 'suggestions'] as const;

const INITIAL_FILES: Record<string, string> = {
  'config.toml': '',
  'graph.json': '[]',
  'context.md': '',
  'analysis.json': '{}',
  'embeddings.json': '[]',
};

export class NovaDir implements INovaDir {
  async init(projectPath: string): Promise<void> {
    const novaPath = this.getPath(projectPath);

    await mkdir(novaPath, { recursive: true });

    for (const sub of SUBDIRS) {
      await mkdir(join(novaPath, sub), { recursive: true });
    }

    for (const [file, content] of Object.entries(INITIAL_FILES)) {
      const filePath = join(novaPath, file);
      try {
        await access(filePath);
      } catch {
        await writeFile(filePath, content, 'utf-8');
      }
    }

    // Write default agent prompts (idempotent — don't overwrite existing)
    const agentsDir = join(novaPath, 'agents');
    for (const [name, content] of Object.entries(DEFAULT_AGENT_PROMPTS)) {
      const agentFilePath = join(agentsDir, `${name}.md`);
      try {
        await access(agentFilePath);
      } catch {
        await writeFile(agentFilePath, content, 'utf-8');
      }
    }

    await this.ensureGitignore(projectPath);
  }

  exists(projectPath: string): boolean {
    return existsSync(this.getPath(projectPath));
  }

  async clean(projectPath: string): Promise<void> {
    await rm(this.getPath(projectPath), { recursive: true, force: true });
  }

  getPath(projectPath: string): string {
    return join(projectPath, NOVA_DIR);
  }

  private async ensureGitignore(projectPath: string): Promise<void> {
    const gitignorePath = join(projectPath, '.gitignore');
    let content = '';

    try {
      content = await readFile(gitignorePath, 'utf-8');
    } catch {
      // .gitignore doesn't exist yet
    }

    const lines = content.split('\n').map((l) => l.trim());
    if (!lines.includes(NOVA_DIR)) {
      const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
      await writeFile(gitignorePath, content + separator + NOVA_DIR + '\n', 'utf-8');
    }
  }
}

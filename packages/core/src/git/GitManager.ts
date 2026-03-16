import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IGitManager } from '../contracts/IGitManager.js';
import { GitError } from '../contracts/IGitManager.js';
import type { CommitInfo } from '../models/types.js';

const execFileAsync = promisify(execFile);

export class GitManager implements IGitManager {
  constructor(private readonly cwd: string) {}

  async createBranch(prefix: string): Promise<string> {
    if (await this.hasUncommittedChanges()) {
      throw new GitError(
        'Uncommitted changes detected. Call stash() first.',
        'git checkout -b',
      );
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const branchName = `${prefix}${timestamp}`;

    await this.run('git', ['checkout', '-b', branchName]);
    return branchName;
  }

  async commit(message: string, files: string[]): Promise<string> {
    if (files.length > 0) {
      await this.run('git', ['add', ...files]);
    } else {
      await this.run('git', ['add', '-A']);
    }

    await this.run('git', ['commit', '-m', message]);

    const { stdout } = await this.run('git', ['rev-parse', '--short=7', 'HEAD']);
    return stdout.trim();
  }

  async rollback(commitHash: string): Promise<void> {
    await this.run('git', ['revert', '--no-edit', commitHash]);
  }

  async getDiff(commitHash: string): Promise<string> {
    const { stdout } = await this.run('git', [
      'diff',
      `${commitHash}^..${commitHash}`,
    ]);
    return stdout;
  }

  async getLog(branch?: string): Promise<CommitInfo[]> {
    const separator = '---COMMIT_SEP---';
    const fieldSep = '---FIELD_SEP---';
    const format = [
      '%H',   // full hash
      '%s',   // subject
      '%ae',  // author email
      '%aI',  // author date ISO
    ].join(fieldSep);

    const args = [
      'log',
      `--format=${separator}${format}`,
      '--name-only',
      '-n', '50',
    ];

    if (branch) {
      args.push(branch);
    }

    const { stdout } = await this.run('git', args);
    if (!stdout.trim()) {
      return [];
    }

    const commits: CommitInfo[] = [];
    const entries = stdout.split(separator).filter((e) => e.trim());

    for (const entry of entries) {
      const lines = entry.trim().split('\n');
      if (lines.length === 0) continue;

      const fields = lines[0].split(fieldSep);
      if (fields.length < 4) continue;

      const [hash, message, author, dateStr] = fields;
      const files = lines.slice(1).map((l) => l.trim()).filter(Boolean);

      commits.push({
        hash: hash.substring(0, 7),
        message,
        author,
        date: new Date(dateStr),
        files,
      });
    }

    return commits;
  }

  async getCurrentBranch(): Promise<string> {
    const { stdout } = await this.run('git', ['branch', '--show-current']);
    return stdout.trim();
  }

  async getDevCount(): Promise<number> {
    const { stdout } = await this.run('git', ['log', '--format=%ae']);
    const emails = stdout
      .trim()
      .split('\n')
      .filter(Boolean);
    return new Set(emails).size;
  }

  async hasUncommittedChanges(): Promise<boolean> {
    const { stdout } = await this.run('git', ['status', '--porcelain']);
    return stdout.trim().length > 0;
  }

  async stash(): Promise<void> {
    await this.run('git', ['stash']);
  }

  async unstash(): Promise<void> {
    await this.run('git', ['stash', 'pop']);
  }

  private async run(
    command: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      return await execFileAsync(command, args, { cwd: this.cwd });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      throw new GitError(message, `${command} ${args.join(' ')}`);
    }
  }
}

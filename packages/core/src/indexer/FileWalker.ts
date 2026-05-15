import { opendir, stat } from 'node:fs/promises';
import { relative } from 'node:path';
import { globby } from 'globby';
import type { ILogger } from '../contracts/ILogger.js';

export interface FileEntry {
  absPath: string;
  relPath: string;
  mtimeMs: number;
  size: number;
}

export interface WalkResult {
  files: FileEntry[];
  /** If set, the number of files that existed beyond the cap */
  cappedAt?: number;
}

/** Default ignored directory names — pruned during traversal */
const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  '.next',
  '.nuxt',
  'dist',
  'build',
  '.git',
  '.nova',
  '.turbo',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  '.idea',
  '.vscode',
]);

const SCANNABLE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const GLOBBY_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/.nova/**',
  '**/.turbo/**',
  '**/.cache/**',
  '**/__pycache__/**',
];

const DEFAULT_FILE_CAP = 5000;

/**
 * Streaming file walker that:
 * - Uses `fs.opendir` with `{recursive:true}` for streaming traversal
 * - Prunes `node_modules`, `.next`, `.git`, `.turbo`, `.cache`, etc. during traversal
 * - Respects `.gitignore` via `globby`
 * - Caps at 5000 files with a warning via logger
 */
export class FileWalker {
  private readonly logger: ILogger | null;
  private readonly fileCap: number;

  constructor(logger?: ILogger, fileCap = DEFAULT_FILE_CAP) {
    this.logger = logger ?? null;
    this.fileCap = fileCap;
  }

  /**
   * Walk the project directory and collect scannable file entries.
   * Returns files up to the cap with optional `cappedAt` field.
   */
  async walk(projectPath: string): Promise<WalkResult> {
    // First, use globby to get the list of files (respects .gitignore)
    // This is efficient and handles gitignore natively
    const totalFiles = await this.collectFiles(projectPath);

    let capped = false;
    let files = totalFiles;

    if (totalFiles.length > this.fileCap) {
      capped = true;
      files = totalFiles.slice(0, this.fileCap);
      this.logger?.warn(
        `Project has ${totalFiles.length} source files. ` +
          `Indexed first ${this.fileCap} of ${totalFiles.length}. ` +
          `Consider configuring boundaries in nova.toml to limit scope.`,
        {
          totalFiles: totalFiles.length,
          cappedAt: this.fileCap,
          component: 'FileWalker',
        },
      );
    }

    // Build FileEntry objects with metadata
    const entries: FileEntry[] = [];
    for (const absPath of files) {
      try {
        const s = await stat(absPath);
        if (s.isFile()) {
          entries.push({
            absPath,
            relPath: relative(projectPath, absPath),
            mtimeMs: s.mtimeMs,
            size: s.size,
          });
        }
      } catch {
        // File disappeared between glob and stat — skip
      }
    }

    return {
      files: entries,
      ...(capped ? { cappedAt: totalFiles.length } : {}),
    };
  }

  /**
   * Streaming walk using `fs.opendir` with `{recursive:true}`.
   * This is the primary traversal method — prunes ignored dirs during enumeration.
   */
  async walkStreaming(projectPath: string): Promise<WalkResult> {
    const entries: FileEntry[] = [];
    let totalSeen = 0;

    try {
      const dir = await opendir(projectPath, { recursive: true });

      for await (const dirent of dir) {
        if (!dirent.isFile()) continue;

        totalSeen++;

        // Prune by directory name during traversal
        if (this.isInIgnoredDir(dirent.parentPath ?? '', projectPath)) {
          continue;
        }

        // Only track scannable extensions
        const ext = dirent.name.includes('.')
          ? dirent.name.slice(dirent.name.lastIndexOf('.'))
          : '';
        if (!SCANNABLE_EXTENSIONS.has(ext)) continue;

        const absPath = (dirent.parentPath ?? projectPath) + '/' + dirent.name;

        // Check against the cap
        if (entries.length >= this.fileCap) {
          if (entries.length === this.fileCap) {
            this.logger?.warn(
              `Project has at least ${this.fileCap} source files (cap reached). ` +
                `Consider configuring boundaries in nova.toml.`,
              {
                cappedAt: this.fileCap,
                component: 'FileWalker',
              },
            );
          }
          // Continue counting but don't add
          continue;
        }

        entries.push({
          absPath,
          relPath: relative(projectPath, absPath),
          mtimeMs: Date.now(), // Will be updated via stat() below
          size: 0, // Will be updated via stat() below
        });
      }
    } catch {
      // Directory doesn't exist or can't be read
    }

    const capped = totalSeen > this.fileCap;

    // Now get sizes for all entries (stating in batch could be expensive, so we do it lazily)
    // For hash computation, we need mtimeMs and size
    const withSizes: FileEntry[] = [];
    for (const entry of entries) {
      try {
        const s = await stat(entry.absPath);
        withSizes.push({ ...entry, size: s.size, mtimeMs: s.mtimeMs });
      } catch {
        // File disappeared — skip
      }
    }

    return {
      files: withSizes,
      ...(capped ? { cappedAt: totalSeen } : {}),
    };
  }

  /**
   * Uses globby for gitignore-aware file collection.
   * This is the recommended method as it respects .gitignore natively.
   */
  private async collectFiles(projectPath: string): Promise<string[]> {
    // Build inclusive patterns for source files
    const patterns = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'];

    const files = await globby(patterns, {
      cwd: projectPath,
      absolute: true,
      gitignore: true,
      ignore: GLOBBY_IGNORE_PATTERNS,
      // Also ignore dotfiles
      dot: false,
      // We only want files (globby handles this via pattern, but be explicit)
      onlyFiles: true,
    });

    return files;
  }

  /**
   * Checks whether a path contains any ignored directory name.
   */
  private isInIgnoredDir(dirPath: string, projectPath: string): boolean {
    const rel = relative(projectPath, dirPath);
    if (rel === '') return false;
    const parts = rel.split('/');
    return parts.some((p) => IGNORED_DIR_NAMES.has(p));
  }
}

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IProjectAnalyzer } from '../contracts/IStorage.js';
import type { ProjectAnalysis, ProjectMap, MethodInfo } from '../models/types.js';
import { MethodExtractor } from './MethodExtractor.js';

const ANALYSIS_FILE = 'analysis.json';

export class ProjectAnalyzer implements IProjectAnalyzer {
  private readonly methodExtractor = new MethodExtractor();

  async analyze(projectPath: string, projectMap?: ProjectMap): Promise<ProjectAnalysis> {
    const methods: MethodInfo[] = [];
    let fileCount = 0;

    if (projectMap?.fileContexts) {
      for (const [filePath, ctx] of projectMap.fileContexts) {
        fileCount++;
        const extracted = this.methodExtractor.extract(ctx.content, filePath);
        methods.push(...extracted);
      }
    }

    const frontendFiles: string[] = [];
    const backendFiles: string[] = [];

    if (projectMap?.dependencies) {
      for (const [, node] of projectMap.dependencies) {
        if (['component', 'page', 'hook'].includes(node.type)) {
          frontendFiles.push(node.filePath);
        } else if (['api', 'model'].includes(node.type)) {
          backendFiles.push(node.filePath);
        }
      }
    }

    const frontendSummary =
      frontendFiles.length > 0
        ? `${frontendFiles.length} frontend files: ${this.summarizeFiles(frontendFiles)}`
        : 'No frontend files detected';

    const backendSummary =
      backendFiles.length > 0
        ? `${backendFiles.length} backend files: ${this.summarizeFiles(backendFiles)}`
        : 'No backend files detected';

    const analysis: ProjectAnalysis = {
      frontendSummary,
      backendSummary,
      methods,
      analyzedAt: new Date().toISOString(),
      fileCount,
    };

    // Save to .nova/analysis.json
    const novaPath = join(projectPath, '.nova');
    await writeFile(join(novaPath, ANALYSIS_FILE), JSON.stringify(analysis, null, 2), 'utf-8');

    return analysis;
  }

  async getAnalysis(projectPath: string): Promise<ProjectAnalysis | null> {
    try {
      const raw = await readFile(join(projectPath, '.nova', ANALYSIS_FILE), 'utf-8');
      return JSON.parse(raw) as ProjectAnalysis;
    } catch {
      return null;
    }
  }

  private summarizeFiles(files: string[]): string {
    // Group by directory
    const dirs = new Map<string, number>();
    for (const f of files) {
      const parts = f.split('/');
      const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
      dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
    }
    return [...dirs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([dir, count]) => `${dir}/ (${count})`)
      .join(', ');
  }
}

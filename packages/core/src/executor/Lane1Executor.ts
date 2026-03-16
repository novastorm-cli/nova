import { readFile, writeFile } from 'node:fs/promises';
import type { ILane1Executor } from '../contracts/IExecutor.js';
import type { TaskItem, ProjectMap, ExecutionResult } from '../models/types.js';
import { DiffApplier } from './DiffApplier.js';

/**
 * Extracts a CSS class name from a DOM snapshot.
 * Looks for class="..." or className="..." attributes.
 */
function extractClassFromSnapshot(domSnapshot: string): string | null {
  const classMatch = /class(?:Name)?="([^"]+)"/.exec(domSnapshot);
  if (!classMatch) return null;
  const classes = classMatch[1].trim().split(/\s+/);
  return classes[0] ?? null;
}

/**
 * Parses a simple property change from a task description.
 * Supports patterns like:
 *   "Change color: red to color: blue"
 *   "change color from red to blue"
 *   "set color to blue"
 */
function parsePropertyChange(
  description: string,
): { property: string; from: string | null; to: string } | null {
  // Pattern: "<property>: <value> to <property>: <value>"
  const colonMatch =
    /(\w[\w-]*):\s*(\S+)\s+to\s+\1:\s*(\S+)/i.exec(description);
  if (colonMatch) {
    return { property: colonMatch[1], from: colonMatch[2], to: colonMatch[3] };
  }

  // Pattern: "change/set <property> from <value> to <value>"
  const fromToMatch =
    /(?:change|set|update)\s+([\w-]+)\s+from\s+(\S+)\s+to\s+(\S+)/i.exec(description);
  if (fromToMatch) {
    return { property: fromToMatch[1], from: fromToMatch[2], to: fromToMatch[3] };
  }

  // Pattern: "change/set <property> to <value>"
  const toMatch = /(?:change|set|update)\s+([\w-]+)\s+to\s+(\S+)/i.exec(description);
  if (toMatch) {
    return { property: toMatch[1], from: null, to: toMatch[2] };
  }

  // Pattern: "make <property> <value>"
  const makeMatch = /(?:make)\s+([\w-]+)\s+(\S+)/i.exec(description);
  if (makeMatch) {
    return { property: makeMatch[1], from: null, to: makeMatch[2] };
  }

  return null;
}

export class Lane1Executor implements ILane1Executor {
  private readonly diffApplier: DiffApplier;

  constructor(private readonly projectPath: string) {
    this.diffApplier = new DiffApplier();
  }

  async execute(task: TaskItem, projectMap: ProjectMap): Promise<ExecutionResult> {
    try {
      const change = parsePropertyChange(task.description);
      if (!change) {
        return {
          success: false,
          taskId: task.id,
          error: 'Could not parse CSS property change from task description',
        };
      }

      // Determine which files to search
      let targetFiles = task.files;

      // If we have a DOM snapshot, try to narrow down by class name
      const domSnapshot = this.findDomSnapshot(task);
      const cssClass = domSnapshot ? extractClassFromSnapshot(domSnapshot) : null;

      if (targetFiles.length === 0) {
        targetFiles = this.findStyleFiles(projectMap);
      }

      if (targetFiles.length === 0) {
        return {
          success: false,
          taskId: task.id,
          error: 'No target files identified for CSS change',
        };
      }

      // Try each file until we find and apply the change
      for (const filePath of targetFiles) {
        const result = await this.applyToFile(filePath, change, cssClass);
        if (result) {
          return {
            success: true,
            taskId: task.id,
            diff: result,
          };
        }
      }

      return {
        success: false,
        taskId: task.id,
        error: `Could not find matching CSS property "${change.property}" in target files`,
      };
    } catch (error: unknown) {
      return {
        success: false,
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private findDomSnapshot(_task: TaskItem): string | null {
    // The DOM snapshot would typically be attached to the task or observation.
    // For Lane1, this is a placeholder for future integration.
    return null;
  }

  private findStyleFiles(projectMap: ProjectMap): string[] {
    const styleExtensions = new Set(['.css', '.scss', '.sass', '.less', '.styl']);
    const files: string[] = [];

    for (const [filePath] of projectMap.dependencies) {
      const ext = filePath.substring(filePath.lastIndexOf('.'));
      if (styleExtensions.has(ext)) {
        files.push(filePath);
      }
    }

    for (const component of projectMap.components) {
      if (!files.includes(component.filePath)) {
        files.push(component.filePath);
      }
    }

    return files;
  }

  private async applyToFile(
    filePath: string,
    change: { property: string; from: string | null; to: string },
    cssClass: string | null,
  ): Promise<string | null> {
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }

    const before = content;

    // If we have a CSS class, narrow scope to that class's block
    if (cssClass) {
      const classPattern = new RegExp(
        `\\.${this.escapeRegex(cssClass)}\\s*\\{([^}]*)\\}`,
        'g',
      );
      let matched = false;

      content = content.replace(classPattern, (fullMatch, block: string) => {
        const propertyPattern = new RegExp(
          `(${this.escapeRegex(change.property)}\\s*:\\s*)([^;}\n]+)`,
          'i',
        );
        const propMatch = propertyPattern.exec(block);
        if (propMatch) {
          if (change.from && propMatch[2].trim() !== change.from) {
            return fullMatch;
          }
          matched = true;
          const newBlock = block.replace(propertyPattern, `$1${change.to}`);
          return fullMatch.replace(block, newBlock);
        }
        return fullMatch;
      });

      if (matched && content !== before) {
        const diff = this.diffApplier.generate(before, content, filePath);
        await writeFile(filePath, content, 'utf-8');
        return diff;
      }
    }

    // Global search: find and replace the property anywhere
    const propertyPattern = new RegExp(
      `(${this.escapeRegex(change.property)}\\s*:\\s*)([^;}\n]+)`,
      'gi',
    );

    let replaced = false;
    content = before.replace(propertyPattern, (fullMatch, prefix: string, value: string) => {
      if (change.from && value.trim() !== change.from) {
        return fullMatch;
      }
      replaced = true;
      return `${prefix}${change.to}`;
    });

    if (replaced && content !== before) {
      const diff = this.diffApplier.generate(before, content, filePath);
      await writeFile(filePath, content, 'utf-8');
      return diff;
    }

    return null;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

import { readFile, writeFile } from 'node:fs/promises';
import type { ILane1Executor } from '../contracts/IExecutor.js';
import type { IPathGuard } from '../contracts/IPathGuard.js';
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

const CSS_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  'color', 'font', 'font-size', 'font-weight', 'font-family',
  'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
  'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
  'display', 'visibility', 'opacity', 'border', 'border-radius',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'gap', 'background', 'background-color', 'align', 'text-align',
  'flex', 'flex-direction', 'justify-content', 'align-items',
  'position', 'top', 'bottom', 'left', 'right', 'z-index',
  'overflow', 'cursor', 'transition', 'transform', 'box-shadow',
]);

/**
 * Parses a simple CSS property change from a task description.
 * Supports patterns like:
 *   "Change color: red to color: blue"
 *   "change color from red to blue"
 *   "set color to blue"
 *
 * Only matches known CSS property names to avoid false positives
 * with text or config changes.
 */
export function parsePropertyChange(
  description: string,
): { property: string; from: string | null; to: string } | null {
  // Pattern: "<property>: <value> to <property>: <value>" — strongest signal, always CSS
  const colonMatch =
    /(\w[\w-]*):\s*(\S+)\s+to\s+\1:\s*(\S+)/i.exec(description);
  if (colonMatch) {
    return { property: colonMatch[1], from: colonMatch[2], to: colonMatch[3] };
  }

  // Pattern: "change/set <property> from <value> to <value>"
  const fromToMatch =
    /(?:change|set|update)\s+([\w-]+)\s+from\s+(\S+)\s+to\s+(\S+)/i.exec(description);
  if (fromToMatch && CSS_PROPERTY_NAMES.has(fromToMatch[1].toLowerCase())) {
    return { property: fromToMatch[1], from: fromToMatch[2], to: fromToMatch[3] };
  }

  // Pattern: "change/set <property> to <value>"
  const toMatch = /(?:change|set|update)\s+([\w-]+)\s+to\s+(\S+)/i.exec(description);
  if (toMatch && CSS_PROPERTY_NAMES.has(toMatch[1].toLowerCase())) {
    return { property: toMatch[1], from: null, to: toMatch[2] };
  }

  // Pattern: "make <property> <value>"
  const makeMatch = /(?:make)\s+([\w-]+)\s+(\S+)/i.exec(description);
  if (makeMatch && CSS_PROPERTY_NAMES.has(makeMatch[1].toLowerCase())) {
    return { property: makeMatch[1], from: null, to: makeMatch[2] };
  }

  return null;
}

export interface TextChange {
  type: 'text';
  attribute?: string;
  from: string | null;
  to: string;
}

/**
 * Parses text/content replacement patterns from a task description.
 * Supports:
 *   "change placeholder from 'Search...' to 'Find items...'"
 *   "set placeholder to 'Enter email'"
 *   "change label from 'Name' to 'Full Name'"
 *   "change title to 'Dashboard'"
 *   "change text 'Submit' to 'Send'"
 *   "replace 'Hello World' with 'Welcome'"
 */
export function parseTextChange(description: string): TextChange | null {
  const TEXT_ATTRIBUTES = new Set([
    'placeholder', 'label', 'title', 'alt', 'aria-label', 'text',
  ]);

  // Pattern: "change/set/update <attribute> from '<from>' to '<to>'"
  const attrFromTo = /(?:change|set|update)\s+([\w-]+)\s+from\s+['"]([^'"]+)['"]\s+to\s+['"]([^'"]+)['"]/i.exec(description);
  if (attrFromTo && TEXT_ATTRIBUTES.has(attrFromTo[1].toLowerCase())) {
    const attr = attrFromTo[1].toLowerCase();
    return { type: 'text', attribute: attr === 'text' ? undefined : attr, from: attrFromTo[2], to: attrFromTo[3] };
  }

  // Pattern: "change/set/update <attribute> to '<to>'"
  const attrTo = /(?:change|set|update)\s+([\w-]+)\s+to\s+['"]([^'"]+)['"]/i.exec(description);
  if (attrTo && TEXT_ATTRIBUTES.has(attrTo[1].toLowerCase())) {
    const attr = attrTo[1].toLowerCase();
    return { type: 'text', attribute: attr === 'text' ? undefined : attr, from: null, to: attrTo[2] };
  }

  // Pattern: "change text 'Submit' to 'Send'"
  const textFromTo = /(?:change|set|update)\s+text\s+['"]([^'"]+)['"]\s+to\s+['"]([^'"]+)['"]/i.exec(description);
  if (textFromTo) {
    return { type: 'text', from: textFromTo[1], to: textFromTo[2] };
  }

  // Pattern: "replace 'Hello World' with 'Welcome'"
  const replaceWith = /(?:replace)\s+['"]([^'"]+)['"]\s+with\s+['"]([^'"]+)['"]/i.exec(description);
  if (replaceWith) {
    return { type: 'text', from: replaceWith[1], to: replaceWith[2] };
  }

  return null;
}

export interface ConfigChange {
  type: 'config';
  key: string;
  from: string | null;
  to: string;
}

/**
 * Parses config value changes from a task description.
 * Supports:
 *   "change port to 4000"
 *   "set timeout to 5000"
 *   "update apiUrl to /api/v2"
 */
export function parseConfigChange(description: string): ConfigChange | null {
  const CSS_PROPERTIES = new Set([
    'color', 'font', 'font-size', 'font-weight', 'font-family',
    'margin', 'margin-top', 'margin-bottom', 'margin-left', 'margin-right',
    'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right',
    'display', 'visibility', 'opacity', 'border', 'border-radius',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'gap', 'background', 'background-color', 'align', 'text-align',
    'flex', 'flex-direction', 'justify-content', 'align-items',
    'position', 'top', 'bottom', 'left', 'right', 'z-index',
    'overflow', 'cursor', 'transition', 'transform', 'box-shadow',
  ]);

  const TEXT_ATTRIBUTES = new Set([
    'placeholder', 'label', 'title', 'alt', 'aria-label', 'text',
  ]);

  // Pattern: "change/set/update <key> from <from> to <to>"
  const fromTo = /(?:change|set|update)\s+([\w-]+)\s+from\s+(\S+)\s+to\s+(\S+)/i.exec(description);
  if (fromTo) {
    const key = fromTo[1].toLowerCase();
    if (!CSS_PROPERTIES.has(key) && !TEXT_ATTRIBUTES.has(key)) {
      return { type: 'config', key: fromTo[1], from: fromTo[2], to: fromTo[3] };
    }
  }

  // Pattern: "change/set/update <key> to <value>"
  const toMatch = /(?:change|set|update)\s+([\w-]+)\s+to\s+(\S+)/i.exec(description);
  if (toMatch) {
    const key = toMatch[1].toLowerCase();
    if (!CSS_PROPERTIES.has(key) && !TEXT_ATTRIBUTES.has(key)) {
      return { type: 'config', key: toMatch[1], from: null, to: toMatch[2] };
    }
  }

  return null;
}

export class Lane1Executor implements ILane1Executor {
  private readonly diffApplier: DiffApplier;

  constructor(
    private readonly projectPath: string,
    private readonly pathGuard?: IPathGuard,
  ) {
    this.diffApplier = new DiffApplier();
  }

  async execute(task: TaskItem, projectMap: ProjectMap): Promise<ExecutionResult> {
    try {
      // Try text/content change first (higher specificity — quoted values)
      const textChange = parseTextChange(task.description);
      if (textChange) {
        let targetFiles = task.files;
        if (targetFiles.length === 0) {
          targetFiles = this.findTextFiles(projectMap);
        }

        if (targetFiles.length === 0) {
          return {
            success: false,
            taskId: task.id,
            error: 'No target files identified for text change',
          };
        }

        for (const filePath of targetFiles) {
          const result = await this.applyTextChange(filePath, textChange);
          if (result) {
            return { success: true, taskId: task.id, diff: result };
          }
        }

        return {
          success: false,
          taskId: task.id,
          error: 'Could not find matching text in target files',
        };
      }

      // Try CSS property change
      const cssChange = parsePropertyChange(task.description);
      if (cssChange) {
        let targetFiles = task.files;
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

        for (const filePath of targetFiles) {
          const result = await this.applyCssToFile(filePath, cssChange, cssClass);
          if (result) {
            return { success: true, taskId: task.id, diff: result };
          }
        }

        return {
          success: false,
          taskId: task.id,
          error: `Could not find matching CSS property "${cssChange.property}" in target files`,
        };
      }

      // Try config change (least specific — catches remaining "change X to Y" patterns)
      const configChange = parseConfigChange(task.description);
      if (configChange) {
        let targetFiles = task.files;
        if (targetFiles.length === 0) {
          targetFiles = this.findConfigFiles(projectMap);
        }

        if (targetFiles.length === 0) {
          return {
            success: false,
            taskId: task.id,
            error: 'No target files identified for config change',
          };
        }

        for (const filePath of targetFiles) {
          const result = await this.applyConfigChange(filePath, configChange);
          if (result) {
            return { success: true, taskId: task.id, diff: result };
          }
        }

        return {
          success: false,
          taskId: task.id,
          error: 'Could not find matching config in target files',
        };
      }

      return {
        success: false,
        taskId: task.id,
        error: 'Could not parse change from task description',
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

  private findTextFiles(projectMap: ProjectMap): string[] {
    const textExtensions = new Set(['.tsx', '.jsx', '.html', '.vue']);
    const files: string[] = [];

    for (const [filePath] of projectMap.dependencies) {
      const ext = filePath.substring(filePath.lastIndexOf('.'));
      if (textExtensions.has(ext)) {
        files.push(filePath);
      }
    }

    for (const component of projectMap.components) {
      if (!files.includes(component.filePath)) {
        const ext = component.filePath.substring(component.filePath.lastIndexOf('.'));
        if (textExtensions.has(ext)) {
          files.push(component.filePath);
        }
      }
    }

    return files;
  }

  private findConfigFiles(projectMap: ProjectMap): string[] {
    const configExtensions = new Set(['.json', '.toml', '.yaml', '.yml', '.env']);
    const files: string[] = [];

    for (const [filePath] of projectMap.dependencies) {
      const ext = filePath.substring(filePath.lastIndexOf('.'));
      // .env files don't have a standard extension pattern, check basename
      if (configExtensions.has(ext) || filePath.endsWith('.env')) {
        files.push(filePath);
      }
    }

    return files;
  }

  private async applyCssToFile(
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
        await this.pathGuard?.check(filePath);
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
      await this.pathGuard?.check(filePath);
      await writeFile(filePath, content, 'utf-8');
      return diff;
    }

    return null;
  }

  private async applyTextChange(
    filePath: string,
    change: TextChange,
  ): Promise<string | null> {
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }

    const before = content;
    let replaced = false;

    if (change.attribute) {
      // Replace attribute values: placeholder="old" -> placeholder="new"
      const attrName = this.escapeRegex(change.attribute);

      if (change.from) {
        const fromEscaped = this.escapeRegex(change.from);
        // Match both single and double quotes
        const pattern = new RegExp(
          `(${attrName}\\s*=\\s*)(['"])${fromEscaped}\\2`,
          'g',
        );
        content = content.replace(pattern, (_match, prefix: string, quote: string) => {
          replaced = true;
          return `${prefix}${quote}${change.to}${quote}`;
        });
      } else {
        // No 'from' — replace any value for this attribute
        const pattern = new RegExp(
          `(${attrName}\\s*=\\s*)(['"])([^'"]*?)\\2`,
          'g',
        );
        content = content.replace(pattern, (_match, prefix: string, quote: string) => {
          replaced = true;
          return `${prefix}${quote}${change.to}${quote}`;
        });
      }
    } else {
      // Replace JSX text content: >old< -> >new<
      if (change.from) {
        const fromEscaped = this.escapeRegex(change.from);
        const pattern = new RegExp(`(>)${fromEscaped}(<)`, 'g');
        content = content.replace(pattern, (_match, open: string, close: string) => {
          replaced = true;
          return `${open}${change.to}${close}`;
        });
      }
    }

    if (replaced && content !== before) {
      const diff = this.diffApplier.generate(before, content, filePath);
      await this.pathGuard?.check(filePath);
      await writeFile(filePath, content, 'utf-8');
      return diff;
    }

    return null;
  }

  private async applyConfigChange(
    filePath: string,
    change: ConfigChange,
  ): Promise<string | null> {
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }

    const before = content;
    const ext = filePath.substring(filePath.lastIndexOf('.'));
    let replaced = false;

    if (ext === '.json') {
      // Parse JSON, find key, update value
      try {
        const json = JSON.parse(content) as Record<string, unknown>;
        if (change.key in json) {
          if (change.from !== null && String(json[change.key]) !== change.from) {
            return null;
          }
          // Preserve type: if original is number and new value is numeric, use number
          const originalValue = json[change.key];
          const numericTo = Number(change.to);
          if (typeof originalValue === 'number' && !isNaN(numericTo)) {
            json[change.key] = numericTo;
          } else {
            json[change.key] = change.to;
          }
          // Detect indentation from original content
          const indentMatch = /^(\s+)"/m.exec(content);
          const indent = indentMatch ? indentMatch[1].length : 2;
          content = JSON.stringify(json, null, indent) + '\n';
          replaced = true;
        }
      } catch {
        return null;
      }
    } else if (ext === '.toml') {
      // TOML: key = "value" or key = value
      const keyEscaped = this.escapeRegex(change.key);
      const pattern = new RegExp(
        `^(${keyEscaped}\\s*=\\s*)(.+)$`,
        'gm',
      );
      content = content.replace(pattern, (fullMatch, prefix: string, value: string) => {
        const trimmed = value.trim();
        if (change.from !== null) {
          const unquoted = trimmed.replace(/^['"]|['"]$/g, '');
          if (unquoted !== change.from) return fullMatch;
        }
        replaced = true;
        // Preserve quoting style
        if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
          const quote = trimmed[0];
          return `${prefix}${quote}${change.to}${quote}`;
        }
        return `${prefix}${change.to}`;
      });
    } else if (ext === '.yaml' || ext === '.yml') {
      // YAML: key: value
      const keyEscaped = this.escapeRegex(change.key);
      const pattern = new RegExp(
        `^(\\s*${keyEscaped}\\s*:\\s*)(.+)$`,
        'gm',
      );
      content = content.replace(pattern, (fullMatch, prefix: string, value: string) => {
        const trimmed = value.trim();
        if (change.from !== null && trimmed !== change.from) {
          // Also check unquoted
          const unquoted = trimmed.replace(/^['"]|['"]$/g, '');
          if (unquoted !== change.from) return fullMatch;
        }
        replaced = true;
        return `${prefix}${change.to}`;
      });
    } else if (filePath.endsWith('.env')) {
      // .env: KEY=value
      const keyEscaped = this.escapeRegex(change.key);
      const pattern = new RegExp(
        `^(${keyEscaped}\\s*=\\s*)(.*)$`,
        'gm',
      );
      content = content.replace(pattern, (fullMatch, prefix: string, value: string) => {
        if (change.from !== null && value.trim() !== change.from) return fullMatch;
        replaced = true;
        return `${prefix}${change.to}`;
      });
    }

    if (replaced && content !== before) {
      const diff = this.diffApplier.generate(before, content, filePath);
      await this.pathGuard?.check(filePath);
      await writeFile(filePath, content, 'utf-8');
      return diff;
    }

    return null;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

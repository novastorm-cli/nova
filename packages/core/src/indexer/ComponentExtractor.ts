import { readFile, readdir } from 'node:fs/promises';
import { join, relative, basename, posix } from 'node:path';
import type { IComponentExtractor } from '../contracts/IIndexer.js';
import type { ComponentInfo, StackInfo } from '../models/types.js';

const COMPONENT_EXTENSIONS = /\.(tsx|jsx|vue|svelte)$/;
const IGNORED_DIRS = new Set(['node_modules', '.next', '.nuxt', 'dist', 'build', '.git', '.nova']);

export class ComponentExtractor implements IComponentExtractor {
  async extract(projectPath: string, stack: StackInfo): Promise<ComponentInfo[]> {
    const components: ComponentInfo[] = [];
    const files = await this.readDirRecursive(projectPath);

    for (const filePath of files) {
      if (!COMPONENT_EXTENSIONS.test(filePath)) continue;

      const rel = relative(projectPath, filePath);
      // Skip files in ignored directories
      if (this.isIgnored(rel)) continue;

      const content = await this.readFileSafe(filePath);
      if (!content) continue;

      const fileName = basename(filePath).replace(/\.(tsx?|jsx?|vue|svelte)$/, '');
      const exports = this.detectExports(content);
      const componentName = this.detectComponentName(content, fileName);
      const type = this.classifyComponent(rel, fileName, exports);
      const props = this.detectProps(content);

      components.push({
        name: componentName,
        filePath: this.toPosix(rel),
        type,
        exports,
        ...(props.length > 0 && { props }),
      });
    }

    return components;
  }

  // ---------------------------------------------------------------------------
  // Detection
  // ---------------------------------------------------------------------------

  private detectComponentName(content: string, fileName: string): string {
    // 1. export default function ComponentName
    const defaultFnMatch = content.match(
      /export\s+default\s+function\s+([A-Z]\w*)/,
    );
    if (defaultFnMatch) return defaultFnMatch[1];

    // 2. export default class ComponentName
    const defaultClassMatch = content.match(
      /export\s+default\s+class\s+([A-Z]\w*)/,
    );
    if (defaultClassMatch) return defaultClassMatch[1];

    // 3. Named export: export function ComponentName / export const ComponentName
    const namedExportMatch = content.match(
      /export\s+(?:async\s+)?(?:function|const)\s+([A-Z]\w*)/,
    );
    if (namedExportMatch) return namedExportMatch[1];

    // 4. For hooks: export function useSomething / export const useSomething
    const hookMatch = content.match(
      /export\s+(?:async\s+)?(?:function|const)\s+(use[A-Z]\w*)/,
    );
    if (hookMatch) return hookMatch[1];

    // 5. Fallback to filename
    return fileName;
  }

  private detectExports(content: string): string[] {
    const exports: string[] = [];

    // export function/const/class Name
    const namedRegex = /export\s+(?:async\s+)?(?:function|const|class|let|var|enum|type|interface)\s+(\w+)/g;
    let match;
    while ((match = namedRegex.exec(content)) !== null) {
      if (!exports.includes(match[1])) {
        exports.push(match[1]);
      }
    }

    // export default
    if (/export\s+default\b/.test(content)) {
      const defaultNameMatch = content.match(
        /export\s+default\s+(?:async\s+)?(?:function|class)\s+(\w+)/,
      );
      const name = defaultNameMatch ? defaultNameMatch[1] : 'default';
      if (!exports.includes(name)) {
        exports.push(name);
      }
    }

    return exports;
  }

  private classifyComponent(
    relPath: string,
    fileName: string,
    exports: string[],
  ): ComponentInfo['type'] {
    const posixPath = this.toPosix(relPath);

    // Hook: file name starts with "use" or has an export starting with "use"
    if (
      fileName.startsWith('use') ||
      exports.some((e) => e.startsWith('use') && e !== 'default')
    ) {
      return 'hook';
    }

    // Layout: file named layout
    if (/\blayout\.(tsx?|jsx?)$/.test(posixPath)) {
      return 'layout';
    }

    // Page: inside app/ or pages/ directories, or file named page.tsx
    if (
      /\bpage\.(tsx?|jsx?)$/.test(posixPath) ||
      posixPath.startsWith('app/') ||
      posixPath.startsWith('src/app/') ||
      posixPath.startsWith('pages/') ||
      posixPath.startsWith('src/pages/')
    ) {
      // But not API route handlers
      if (/\broute\.(tsx?|jsx?)$/.test(posixPath)) return 'component';
      // Files inside app/ that are page.tsx or in pages/ dir
      if (
        /\bpage\.(tsx?|jsx?)$/.test(posixPath) ||
        posixPath.startsWith('pages/') ||
        posixPath.startsWith('src/pages/')
      ) {
        return 'page';
      }
    }

    return 'component';
  }

  private detectProps(content: string): string[] {
    const props: string[] = [];

    // Match interface/type Props { prop1: ...; prop2: ... }
    const propsBlockMatch = content.match(
      /(?:interface|type)\s+\w*Props\w*\s*(?:=\s*)?{([^}]*)}/,
    );
    if (propsBlockMatch) {
      const block = propsBlockMatch[1];
      const propRegex = /(\w+)\s*[?:]?\s*:/g;
      let match;
      while ((match = propRegex.exec(block)) !== null) {
        props.push(match[1]);
      }
    }

    // Match destructured props in function params: ({ prop1, prop2 }: Props)
    // or ({ prop1, prop2 })
    const destructuredMatch = content.match(
      /(?:export\s+(?:default\s+)?function\s+\w+|(?:const|let)\s+\w+\s*=\s*(?:\([^)]*\)\s*=>|function))\s*\(\s*\{([^}]*)\}/,
    );
    if (destructuredMatch && props.length === 0) {
      const params = destructuredMatch[1];
      const paramRegex = /(\w+)/g;
      let match;
      while ((match = paramRegex.exec(params)) !== null) {
        if (!props.includes(match[1])) {
          props.push(match[1]);
        }
      }
    }

    return props;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private isIgnored(relPath: string): boolean {
    const parts = relPath.split(/[\\/]/);
    return parts.some((p) => IGNORED_DIRS.has(p));
  }

  private toPosix(p: string): string {
    return p.split('\\').join(posix.sep);
  }

  private async readDirRecursive(dir: string): Promise<string[]> {
    try {
      const entries = await readdir(dir, { withFileTypes: true, recursive: true });
      return entries
        .filter((e) => e.isFile())
        .map((e) => {
          const parent = (e as { parentPath?: string }).parentPath ?? (e as { path?: string }).path ?? dir;
          return join(parent, e.name);
        });
    } catch {
      return [];
    }
  }

  private async readFileSafe(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }
}

import type { MethodInfo, MethodVisibility } from '../models/types.js';

const FUNCTION_REGEX = /^(\s*)(?:export\s+)?(?:(async)\s+)?function\s+(\w+)\s*(\([^)]*\))/gm;
const ARROW_CONST_REGEX = /^(\s*)(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:(async)\s+)?\([^)]*\)\s*(?::\s*\S+\s*)?=>/gm;
const CLASS_METHOD_REGEX = /^(\s+)(?:(public|private|protected)\s+)?(?:(static)\s+)?(?:(async)\s+)?(\w+)\s*(\([^)]*\))/gm;
const CLASS_REGEX = /^(?:export\s+)?class\s+(\w+)/gm;
const JSDOC_REGEX = /\/\*\*\s*([\s\S]*?)\s*\*\//g;

export class MethodExtractor {
  extract(content: string, filePath: string): MethodInfo[] {
    const methods: MethodInfo[] = [];
    const lines = content.split('\n');
    const jsdocMap = this.buildJsDocMap(content);
    const classRanges = this.findClassRanges(content, lines);

    // Extract standalone functions
    this.extractFunctions(content, lines, filePath, jsdocMap, methods);

    // Extract arrow function consts
    this.extractArrowFunctions(content, lines, filePath, jsdocMap, methods);

    // Extract class methods
    this.extractClassMethods(content, lines, filePath, jsdocMap, classRanges, methods);

    return methods;
  }

  private extractFunctions(
    content: string,
    lines: string[],
    filePath: string,
    jsdocMap: Map<number, string>,
    methods: MethodInfo[],
  ): void {
    FUNCTION_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = FUNCTION_REGEX.exec(content)) !== null) {
      const lineStart = this.getLineNumber(content, match.index);
      const lineEnd = this.findBlockEnd(lines, lineStart - 1);
      const isAsync = match[2] === 'async';
      const name = match[3]!;
      const params = match[4]!;

      methods.push({
        name,
        filePath,
        signature: `${isAsync ? 'async ' : ''}function ${name}${params}`,
        purpose: jsdocMap.get(lineStart) ?? this.purposeFromName(name),
        lineStart,
        lineEnd,
        visibility: this.isExportedAt(content, match.index) ? 'public' : 'private',
        isAsync,
      });
    }
  }

  private extractArrowFunctions(
    content: string,
    lines: string[],
    filePath: string,
    jsdocMap: Map<number, string>,
    methods: MethodInfo[],
  ): void {
    ARROW_CONST_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = ARROW_CONST_REGEX.exec(content)) !== null) {
      const lineStart = this.getLineNumber(content, match.index);
      const lineEnd = this.findBlockEnd(lines, lineStart - 1);
      const name = match[2]!;
      const isAsync = match[3] === 'async';

      methods.push({
        name,
        filePath,
        signature: `const ${name} = ${isAsync ? 'async ' : ''}(...)`,
        purpose: jsdocMap.get(lineStart) ?? this.purposeFromName(name),
        lineStart,
        lineEnd,
        visibility: this.isExportedAt(content, match.index) ? 'public' : 'private',
        isAsync,
      });
    }
  }

  private extractClassMethods(
    content: string,
    lines: string[],
    filePath: string,
    jsdocMap: Map<number, string>,
    classRanges: Array<{ name: string; start: number; end: number }>,
    methods: MethodInfo[],
  ): void {
    CLASS_METHOD_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = CLASS_METHOD_REGEX.exec(content)) !== null) {
      const lineStart = this.getLineNumber(content, match.index);
      const lineEnd = this.findBlockEnd(lines, lineStart - 1);
      const visibility = (match[2] as MethodVisibility) ?? 'public';
      const isAsync = match[4] === 'async';
      const name = match[5]!;
      const params = match[6]!;

      // Skip constructor-like or getter/setter noise
      if (name === 'constructor' || name === 'get' || name === 'set') continue;

      const className = classRanges.find(
        (c) => lineStart >= c.start && lineStart <= c.end,
      )?.name;

      methods.push({
        name,
        filePath,
        className,
        signature: `${visibility} ${isAsync ? 'async ' : ''}${name}${params}`,
        purpose: jsdocMap.get(lineStart) ?? this.purposeFromName(name),
        lineStart,
        lineEnd,
        visibility,
        isAsync,
      });
    }
  }

  private buildJsDocMap(content: string): Map<number, string> {
    const map = new Map<number, string>();
    JSDOC_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = JSDOC_REGEX.exec(content)) !== null) {
      const endIndex = match.index + match[0].length;
      const jsdocEndLine = this.getLineNumber(content, endIndex);
      // The function/method declaration is on the next non-blank line after the JSDoc
      const nextCodeLine = jsdocEndLine + 1;
      // Extract first sentence from JSDoc
      const raw = match[1]!
        .replace(/\s*\*\s*/g, ' ')
        .replace(/@\w+.*$/gm, '')
        .trim();
      const firstSentence = raw.split(/[.!?\n]/)[0]?.trim();
      if (firstSentence && firstSentence.length > 3) {
        map.set(nextCodeLine, firstSentence);
      }
    }

    return map;
  }

  private findClassRanges(
    content: string,
    lines: string[],
  ): Array<{ name: string; start: number; end: number }> {
    const ranges: Array<{ name: string; start: number; end: number }> = [];
    CLASS_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = CLASS_REGEX.exec(content)) !== null) {
      const start = this.getLineNumber(content, match.index);
      const end = this.findBlockEnd(lines, start - 1);
      ranges.push({ name: match[1]!, start, end });
    }

    return ranges;
  }

  private getLineNumber(content: string, index: number): number {
    let line = 1;
    for (let i = 0; i < index; i++) {
      if (content[i] === '\n') line++;
    }
    return line;
  }

  private findBlockEnd(lines: string[], startIdx: number): number {
    let depth = 0;
    let foundOpen = false;

    for (let i = startIdx; i < lines.length; i++) {
      for (const ch of lines[i]!) {
        if (ch === '{') {
          depth++;
          foundOpen = true;
        } else if (ch === '}') {
          depth--;
        }
      }
      if (foundOpen && depth === 0) {
        return i + 1; // 1-based
      }
    }

    // For arrow functions without braces, use heuristic
    return Math.min(startIdx + 5, lines.length);
  }

  purposeFromName(name: string): string {
    // Split camelCase/PascalCase into words
    const words = name
      .replace(/([A-Z])/g, ' $1')
      .replace(/^[\s_]+/, '')
      .toLowerCase()
      .trim()
      .split(/\s+/);
    return words.join(' ');
  }

  private isExportedAt(content: string, index: number): boolean {
    // Check if the line at this index starts with 'export'
    const lineStart = content.lastIndexOf('\n', index) + 1;
    const linePrefix = content.slice(lineStart, index + 20);
    return linePrefix.trimStart().startsWith('export');
  }
}

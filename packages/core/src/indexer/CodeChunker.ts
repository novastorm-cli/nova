import type { MethodInfo } from '../models/types.js';

export interface CodeChunk {
  text: string;
  filePath: string;
  type: 'method' | 'imports' | 'types' | 'general';
  name?: string | undefined;
  lineStart: number;
  lineEnd: number;
}

const MAX_CHUNK_TOKENS = 500;
const OVERLAP_TOKENS = 100;

export class CodeChunker {
  chunkFile(content: string, filePath: string, methods: MethodInfo[]): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = content.split('\n');

    // 1. Extract imports block
    const importLines: string[] = [];
    let importEnd = 0;
    for (let i = 0; i < lines.length; i++) {
      if (
        /^\s*(import|require)\b/.test(lines[i]!) ||
        (importLines.length > 0 && /^\s*[}),]/.test(lines[i]!))
      ) {
        importLines.push(lines[i]!);
        importEnd = i;
      } else if (importLines.length > 0 && !lines[i]!.trim()) {
        // Skip blank lines between imports
        continue;
      } else if (importLines.length > 0) {
        break;
      }
    }

    if (importLines.length > 0) {
      chunks.push({
        text: importLines.join('\n'),
        filePath,
        type: 'imports',
        lineStart: 1,
        lineEnd: importEnd + 1,
      });
    }

    // 2. Extract type/interface definitions
    const typeRegex = /^(?:export\s+)?(?:interface|type)\s+(\w+)/gm;
    let typeMatch: RegExpExecArray | null;
    while ((typeMatch = typeRegex.exec(content)) !== null) {
      const lineStart = this.getLineNumber(content, typeMatch.index);
      const lineEnd = this.findBlockEnd(lines, lineStart - 1);
      const typeText = lines.slice(lineStart - 1, lineEnd).join('\n');
      if (typeText.length > 10) {
        chunks.push({
          text: typeText,
          filePath,
          type: 'types',
          name: typeMatch[1],
          lineStart,
          lineEnd,
        });
      }
    }

    // 3. Each method = chunk
    for (const method of methods) {
      const methodText = lines.slice(method.lineStart - 1, method.lineEnd).join('\n');
      if (methodText.length > 10) {
        chunks.push({
          text: methodText,
          filePath,
          type: 'method',
          name: method.name,
          lineStart: method.lineStart,
          lineEnd: method.lineEnd,
        });
      }
    }

    // 4. If no methods and no type chunks, use sliding window
    if (methods.length === 0 && chunks.filter((c) => c.type !== 'imports').length === 0) {
      const slidingChunks = this.slidingWindow(lines, filePath);
      chunks.push(...slidingChunks);
    }

    return chunks;
  }

  private slidingWindow(lines: string[], filePath: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const totalLines = lines.length;

    if (totalLines === 0) return chunks;

    // Approximate: 1 token ~ 4 chars, 1 line ~ 40 chars ~ 10 tokens
    const linesPerChunk = Math.max(10, Math.floor(MAX_CHUNK_TOKENS / 10));
    const overlapLines = Math.floor(OVERLAP_TOKENS / 10);

    let start = 0;
    while (start < totalLines) {
      const end = Math.min(start + linesPerChunk, totalLines);
      const text = lines.slice(start, end).join('\n');

      if (text.trim().length > 10) {
        chunks.push({
          text,
          filePath,
          type: 'general',
          lineStart: start + 1,
          lineEnd: end,
        });
      }

      start = end - overlapLines;
      if (start >= totalLines - overlapLines) break;
    }

    return chunks;
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
      if (foundOpen && depth === 0) return i + 1;
    }

    return Math.min(startIdx + 10, lines.length);
  }
}

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { IDiffApplier } from '../contracts/IExecutor.js';
import { DiffError } from '../contracts/IExecutor.js';

interface Hunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: HunkLine[];
}

interface HunkLine {
  type: 'context' | 'add' | 'remove';
  content: string;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export class DiffApplier implements IDiffApplier {
  async apply(filePath: string, diff: string): Promise<void> {
    if (!existsSync(filePath)) {
      throw new DiffError(`File not found: ${filePath}`, filePath);
    }

    const hunks = this.parseHunks(diff, filePath);
    if (hunks.length === 0) {
      throw new DiffError('No hunks found in diff', filePath);
    }

    const original = await readFile(filePath, 'utf-8');
    const originalLines = original.split('\n');

    // Apply hunks in reverse order so line numbers stay valid
    const sortedHunks = [...hunks].sort((a, b) => b.oldStart - a.oldStart);

    let resultLines = [...originalLines];

    for (const hunk of sortedHunks) {
      resultLines = this.applyHunk(resultLines, hunk, filePath);
    }

    await writeFile(filePath, resultLines.join('\n'), 'utf-8');
  }

  generate(before: string, after: string, filePath: string): string {
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');

    const hunks = this.computeHunks(beforeLines, afterLines);
    if (hunks.length === 0) {
      return '';
    }

    const lines: string[] = [
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
    ];

    for (const hunk of hunks) {
      lines.push(
        `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
      );
      for (const line of hunk.lines) {
        switch (line.type) {
          case 'context':
            lines.push(` ${line.content}`);
            break;
          case 'remove':
            lines.push(`-${line.content}`);
            break;
          case 'add':
            lines.push(`+${line.content}`);
            break;
        }
      }
    }

    return lines.join('\n');
  }

  private parseHunks(diff: string, filePath: string): Hunk[] {
    const lines = diff.split('\n');
    const hunks: Hunk[] = [];
    let currentHunk: Hunk | null = null;

    for (const line of lines) {
      const headerMatch = HUNK_HEADER.exec(line);
      if (headerMatch) {
        currentHunk = {
          oldStart: parseInt(headerMatch[1], 10),
          oldCount: parseInt(headerMatch[2] ?? '1', 10),
          newStart: parseInt(headerMatch[3], 10),
          newCount: parseInt(headerMatch[4] ?? '1', 10),
          lines: [],
        };
        hunks.push(currentHunk);
        continue;
      }

      if (!currentHunk) continue;

      if (line.startsWith('-')) {
        currentHunk.lines.push({ type: 'remove', content: line.substring(1) });
      } else if (line.startsWith('+')) {
        currentHunk.lines.push({ type: 'add', content: line.substring(1) });
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({ type: 'context', content: line.substring(1) });
      } else if (line === '\\ No newline at end of file') {
        // skip this marker
      } else if (line.startsWith('---') || line.startsWith('+++')) {
        // file header lines, skip
      } else if (line.trim() === '') {
        // empty line within a hunk is treated as context with empty content
        if (currentHunk.lines.length > 0) {
          currentHunk.lines.push({ type: 'context', content: '' });
        }
      }
    }

    if (hunks.length === 0) {
      throw new DiffError('Invalid diff format: no hunks found', filePath);
    }

    return hunks;
  }

  private applyHunk(lines: string[], hunk: Hunk, filePath: string): string[] {
    const result = [...lines];
    // Convert 1-based to 0-based
    let pos = hunk.oldStart - 1;

    // Validate context lines match
    let checkPos = pos;
    for (const hunkLine of hunk.lines) {
      if (hunkLine.type === 'context' || hunkLine.type === 'remove') {
        if (checkPos >= result.length) {
          throw new DiffError(
            `Context mismatch at line ${checkPos + 1}: unexpected end of file`,
            filePath,
          );
        }
        if (result[checkPos] !== hunkLine.content) {
          throw new DiffError(
            `Context mismatch at line ${checkPos + 1}: expected "${hunkLine.content}", found "${result[checkPos]}"`,
            filePath,
          );
        }
        checkPos++;
      }
    }

    // Apply changes
    const toRemove: number[] = [];
    const toInsert: Array<{ index: number; content: string }> = [];

    let insertOffset = 0;
    for (const hunkLine of hunk.lines) {
      if (hunkLine.type === 'context') {
        pos++;
      } else if (hunkLine.type === 'remove') {
        toRemove.push(pos);
        pos++;
      } else if (hunkLine.type === 'add') {
        toInsert.push({ index: pos + insertOffset, content: hunkLine.content });
        insertOffset++;
      }
    }

    // Remove lines in reverse order
    for (const idx of toRemove.reverse()) {
      result.splice(idx, 1);
    }

    // Insert lines (adjust indices for removals)
    const removesBefore = (idx: number): number =>
      toRemove.filter((r) => r <= idx).length;

    for (let i = 0; i < toInsert.length; i++) {
      const adjustedIdx = toInsert[i].index - removesBefore(toInsert[i].index) + i;
      result.splice(adjustedIdx, 0, toInsert[i].content);
    }

    return result;
  }

  private computeHunks(beforeLines: string[], afterLines: string[]): Hunk[] {
    // Simple LCS-based diff generation
    const lcs = this.lcs(beforeLines, afterLines);
    const hunkLines: HunkLine[] = [];

    let bi = 0;
    let ai = 0;
    let li = 0;

    while (bi < beforeLines.length || ai < afterLines.length) {
      if (
        li < lcs.length &&
        bi < beforeLines.length &&
        ai < afterLines.length &&
        beforeLines[bi] === lcs[li] &&
        afterLines[ai] === lcs[li]
      ) {
        hunkLines.push({ type: 'context', content: beforeLines[bi] });
        bi++;
        ai++;
        li++;
      } else if (bi < beforeLines.length && (li >= lcs.length || beforeLines[bi] !== lcs[li])) {
        hunkLines.push({ type: 'remove', content: beforeLines[bi] });
        bi++;
      } else if (ai < afterLines.length && (li >= lcs.length || afterLines[ai] !== lcs[li])) {
        hunkLines.push({ type: 'add', content: afterLines[ai] });
        ai++;
      }
    }

    if (hunkLines.length === 0) return [];

    // Group into hunks with 3 lines of context
    const CONTEXT = 3;
    const hunks: Hunk[] = [];
    let start = 0;

    while (start < hunkLines.length) {
      // Find next non-context line
      while (start < hunkLines.length && hunkLines[start].type === 'context') {
        start++;
      }
      if (start >= hunkLines.length) break;

      const hunkStart = Math.max(0, start - CONTEXT);
      let end = start;

      // Find end of this change group (allow merging if gaps are small)
      while (end < hunkLines.length) {
        if (hunkLines[end].type !== 'context') {
          end++;
          continue;
        }
        // Count consecutive context lines
        let contextRun = 0;
        let peek = end;
        while (peek < hunkLines.length && hunkLines[peek].type === 'context') {
          contextRun++;
          peek++;
        }
        if (contextRun > CONTEXT * 2 || peek >= hunkLines.length) {
          end += Math.min(contextRun, CONTEXT);
          break;
        }
        end = peek;
      }

      const slice = hunkLines.slice(hunkStart, end);

      // Calculate line numbers
      let oldLine = 1;
      let newLine = 1;
      for (let i = 0; i < hunkStart; i++) {
        if (hunkLines[i].type === 'context' || hunkLines[i].type === 'remove') oldLine++;
        if (hunkLines[i].type === 'context' || hunkLines[i].type === 'add') newLine++;
      }

      const oldCount = slice.filter((l) => l.type === 'context' || l.type === 'remove').length;
      const newCount = slice.filter((l) => l.type === 'context' || l.type === 'add').length;

      hunks.push({
        oldStart: oldLine,
        oldCount,
        newStart: newLine,
        newCount,
        lines: slice,
      });

      start = end;
    }

    return hunks;
  }

  private lcs(a: string[], b: string[]): string[] {
    const m = a.length;
    const n = b.length;

    // Use space-optimized LCS for large files
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack
    const result: string[] = [];
    let i = m;
    let j = n;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        result.unshift(a[i - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    return result;
  }
}

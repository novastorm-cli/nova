export interface FileBlock {
  path: string;
  content: string;
}

export interface DiffBlock {
  path: string;
  diff: string;
}

export type ParsedBlock =
  | { type: 'file'; path: string; content: string }
  | { type: 'diff'; path: string; diff: string };

/**
 * Add line numbers to file content for LLM context.
 * Format: "1 | const foo = 1;"
 */
/**
 * Sanitize a file path from LLM output:
 * - Strip leading `/` to prevent absolute paths
 * - Reject `..` segments to prevent path traversal
 */
function sanitizePath(filePath: string): string | null {
  // Strip leading slashes
  const sanitized = filePath.replace(/^\/+/, '');
  // Reject path traversal
  const segments = sanitized.split(/[\\/]/);
  if (segments.some((s) => s === '..')) {
    return null;
  }
  return sanitized;
}

export function addLineNumbers(content: string): string {
  return content
    .split('\n')
    .map((line, i) => `${i + 1} | ${line}`)
    .join('\n');
}

export function parseFileBlocks(response: string): FileBlock[] {
  const blocks: FileBlock[] = [];
  const pattern = /=== FILE: (.+?) ===([\s\S]*?)=== END FILE ===/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(response)) !== null) {
    const rawPath = match[1]!.trim();
    const content = match[2]!.trim();
    const filePath = sanitizePath(rawPath);
    if (filePath && content) {
      blocks.push({ path: filePath, content });
    }
  }

  // Fallback: if no file blocks found, try to detect code with a filename hint
  if (blocks.length === 0) {
    // Try markdown code blocks with filenames
    const mdPattern = /```(?:\w+)?\s*\n?\/\/\s*(.+?)\n([\s\S]*?)```/g;
    while ((match = mdPattern.exec(response)) !== null) {
      const rawPath = match[1]!.trim();
      const content = match[2]!.trim();
      const filePath = sanitizePath(rawPath);
      if (filePath && content) {
        blocks.push({ path: filePath, content });
      }
    }
  }

  return blocks;
}

/**
 * Parse both FILE and DIFF blocks from an LLM response.
 * - `=== FILE: path ===` ... `=== END FILE ===` -> full file content
 * - `=== DIFF: path ===` ... `=== END DIFF ===` -> unified diff
 *
 * Falls back: if a DIFF block doesn't look like a valid diff (no @@ hunks),
 * treat it as full file content instead.
 */
export function parseMixedBlocks(response: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];

  // Single-pass regex to capture both FILE and DIFF blocks in document order
  const pattern = /=== (FILE|DIFF): (.+?) ===([\s\S]*?)=== END (?:FILE|DIFF) ===/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(response)) !== null) {
    const blockType = match[1]!;
    const rawPath = match[2]!.trim();
    const body = match[3]!.trim();
    const safePath = sanitizePath(rawPath);
    if (!safePath || !body) continue;

    if (blockType === 'FILE') {
      blocks.push({ type: 'file', path: safePath, content: body });
    } else {
      // Validate it looks like a real diff (has at least one hunk header)
      if (/^@@\s/m.test(body) || /^---\s/m.test(body)) {
        blocks.push({ type: 'diff', path: safePath, diff: body });
      } else {
        // Fallback: model output full content in a DIFF block — treat as file
        blocks.push({ type: 'file', path: safePath, content: body });
      }
    }
  }

  return blocks;
}

export interface FileBlock {
  path: string;
  content: string;
}

export function parseFileBlocks(response: string): FileBlock[] {
  const blocks: FileBlock[] = [];
  const pattern = /=== FILE: (.+?) ===([\s\S]*?)=== END FILE ===/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(response)) !== null) {
    const filePath = match[1].trim();
    const content = match[2].trim();
    if (filePath && content) {
      blocks.push({ path: filePath, content });
    }
  }

  // Fallback: if no file blocks found, try to detect code with a filename hint
  if (blocks.length === 0) {
    // Try markdown code blocks with filenames
    const mdPattern = /```(?:\w+)?\s*\n?\/\/\s*(.+?)\n([\s\S]*?)```/g;
    while ((match = mdPattern.exec(response)) !== null) {
      const filePath = match[1].trim();
      const content = match[2].trim();
      if (filePath && content) {
        blocks.push({ path: filePath, content });
      }
    }
  }

  return blocks;
}

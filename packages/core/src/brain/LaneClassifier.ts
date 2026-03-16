import type { ILaneClassifier } from '../contracts/IBrain.js';

const STYLE_KEYWORDS: ReadonlySet<string> = new Set([
  'color', 'font', 'margin', 'padding', 'display', 'visibility', 'text',
  'label', 'placeholder', 'opacity', 'border', 'width', 'height', 'gap',
  'radius', 'background', 'align', 'hide', 'show', 'blue', 'red', 'green',
  'white', 'black', 'yellow', 'purple', 'pink', 'orange', 'gray', 'grey',
]);

const NEW_ELEMENT_KEYWORDS: ReadonlySet<string> = new Set([
  'add', 'create', 'new',
]);

const LANE4_PATTERN = /\b(refactor|migrate|rewrite|redesign|restructure|upgrade)\b/i;
const LANE3_PATTERN = /\b(add\s+.*page|new\s+.*endpoint|create\s+.*component)\b/i;

export class LaneClassifier implements ILaneClassifier {
  classify(taskDescription: string, affectedFiles: string[]): 1 | 2 | 3 | 4 {
    const lower = taskDescription.toLowerCase();
    const words = lower.split(/\s+/);
    const fileCount = affectedFiles.length;

    // Rule 4 (highest priority): Large-scale refactoring keywords always win
    if (LANE4_PATTERN.test(lower)) {
      return 4;
    }

    // Rule 3: Keywords matching add.*page, new.*endpoint, create.*component
    if (LANE3_PATTERN.test(lower)) {
      return 3;
    }

    // Rule 1: Style/text-only keywords + single file, but NOT if adding a new element
    const hasStyleKeyword = words.some((w) => STYLE_KEYWORDS.has(w));
    const hasNewElementKeyword = words.some((w) => NEW_ELEMENT_KEYWORDS.has(w));

    if (hasStyleKeyword && !hasNewElementKeyword && fileCount <= 1) {
      return 1;
    }

    // Style keyword with multiple files is still a simple change (Lane 2)
    if (hasStyleKeyword && !hasNewElementKeyword && fileCount > 1) {
      return 2;
    }

    // Rule 3 (cont.): Multiple files affected (non-style changes)
    if (fileCount > 1) {
      return 3;
    }

    // Rule 2 / Rule 5: Single file or default
    return 2;
  }
}

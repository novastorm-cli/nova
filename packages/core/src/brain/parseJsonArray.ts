/**
 * Brace-counting JSON array parser.
 *
 * Replaces the fragile non-greedy regex `\[[\s\S]*?\]` with a robust
 * algorithm that correctly handles:
 * - Nested arrays and objects
 * - Strings containing brackets (e.g., "fix [this] bug")
 * - Escaped characters inside strings
 * - Prose before and after the JSON array
 * - Markdown code fences
 * - Malformed JSON (returns a clean Error, not an opaque SyntaxError)
 */

/**
 * Extracts all JSON array candidates from a string using brace counting.
 *
 * Walks the string character by character, tracking:
 * - Nesting depth (for both `[`/`]` and `{`/`}`)
 * - Whether we're inside a string (to ignore brackets in string values)
 * - Escape sequences (e.g., `\"` inside strings)
 *
 * Returns all complete `[...]` segments found.
 */
function extractJsonArrays(text: string): string[] {
  const arrays: string[] = [];
  let i = 0;

  while (i < text.length) {
    // Scan for the next opening bracket
    if (text[i] !== '[') {
      i++;
      continue;
    }

    let depth = 0; // tracks both [/{ and ]/}
    let inString = false;
    let escape = false;
    let j = i;

    while (j < text.length) {
      const ch = text[j];

      if (inString) {
        if (escape) {
          escape = false;
          j++;
          continue;
        }
        if (ch === '\\') {
          escape = true;
          j++;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        j++;
        continue;
      }

      // Not in a string
      if (ch === '"') {
        inString = true;
        j++;
        continue;
      }

      if (ch === '[' || ch === '{') {
        depth++;
      } else if (ch === ']' || ch === '}') {
        depth--;
        if (depth === 0) {
          // Found the matching closing bracket
          j++; // include the closing bracket
          arrays.push(text.slice(i, j));
          break;
        }
      }

      j++;
    }

    // Advance past this segment
    i = j;
  }

  return arrays;
}

/**
 * Strips markdown code fences (```json ... ``` or ``` ... ```) from the response.
 * Returns the inner content if found, otherwise the original string.
 */
function stripCodeFences(text: string): string {
  if (!text.includes('```')) return text;

  // Match ```json or ``` at the start, capture everything until the closing ```
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  return text;
}

/**
 * Parses a JSON array from an LLM response string.
 *
 * Strategy:
 * 1. Strip markdown code fences if present.
 * 2. Try direct JSON.parse first (fast path for clean responses).
 * 3. Use brace counting to find all `[...]` candidates.
 * 4. Try candidates from last to first (Claude CLI often outputs
 *    multiple: first attempt + reconsidered second attempt).
 * 5. Return the first valid non-empty array, or throw a clean Error.
 *
 * @param response - The raw LLM response string
 * @returns Parsed array of raw task objects
 * @throws {Error} with message "No valid JSON array found in response" on failure
 */
export function parseJsonArray(response: string): unknown[] {
  let trimmed = response.trim();

  // Strip markdown code fences if present
  trimmed = stripCodeFences(trimmed);

  // Try direct parse first (fast path)
  try {
    const direct: unknown = JSON.parse(trimmed);
    if (Array.isArray(direct)) return direct;
  } catch {
    /* fall through to extraction */
  }

  // Use brace counting to find all JSON array candidates
  const candidates = extractJsonArrays(trimmed);

  // No candidates found
  if (candidates.length === 0) {
    throw new Error('No valid JSON array found in response');
  }

  // Try candidates from last to first (last is usually the final answer)
  for (let i = candidates.length - 1; i >= 0; i--) {
    try {
      const parsed: unknown = JSON.parse(candidates[i]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch {
      /* try next candidate */
    }
  }

  throw new Error('No valid JSON array found in response');
}

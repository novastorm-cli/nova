import { describe, it, expect } from 'vitest';
import { parseJsonArray } from '../brain/parseJsonArray.js';

/**
 * Brain.parseJsonArray brace-counting parser tests (m3-09-brain-json-parser).
 *
 * Covers:
 * - Flat array
 * - Nested arrays (objects within arrays within arrays)
 * - Mixed nesting with strings containing brackets
 * - Response with prose-before-JSON
 * - Response with prose-after-JSON
 * - Malformed JSON returning a clean error (not an opaque SyntaxError)
 * - Markdown code fences
 * - Empty response
 * - Multiple valid array candidates (picks the last one)
 */

describe('Brain.parseJsonArray', () => {
  // ── Flat array ────────────────────────────────────

  it('parses a flat JSON array', () => {
    const result = parseJsonArray('[{"a": 1}, {"b": 2}]');
    expect(result).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('parses a single-element flat array', () => {
    const result = parseJsonArray('[{"description": "add button", "files": ["app/page.tsx"]}]');
    expect(result).toEqual([{ description: 'add button', files: ['app/page.tsx'] }]);
  });

  // ── Nested arrays ─────────────────────────────────

  it('parses nested arrays (arrays containing arrays)', () => {
    const result = parseJsonArray('[{"files": ["a.ts", "b.ts"], "deps": [["c.ts"]]}]');
    expect(result).toEqual([{ files: ['a.ts', 'b.ts'], deps: [['c.ts']] }]);
  });

  it('parses deeply nested arrays', () => {
    const result = parseJsonArray(
      '[{"type": "multi_file", "changes": [{"file": "a.ts", "lines": [1,2,3]}, {"file": "b.ts", "lines": [4,5]}]}]',
    );
    expect(result).toHaveLength(1);
    expect(result[0]!).toHaveProperty('changes');
    const item = result[0] as Record<string, unknown>;
    expect(item.changes as unknown[]).toHaveLength(2);
  });

  // ── Strings containing brackets ────────────────────

  it('handles strings containing square brackets', () => {
    const input = '[{"desc": "fix the [Bug] in header", "files": ["app/header.tsx"]}]';
    const result = parseJsonArray(input);
    expect(result).toEqual([{ desc: 'fix the [Bug] in header', files: ['app/header.tsx'] }]);
  });

  it('handles strings containing curly braces', () => {
    const input = '[{"desc": "wrap in {margin: 0}", "type": "css"}]';
    const result = parseJsonArray(input);
    expect(result).toEqual([{ desc: 'wrap in {margin: 0}', type: 'css' }]);
  });

  it('handles strings containing both bracket types', () => {
    const input = '[{"desc": "change {color: red} for [active] state"}]';
    const result = parseJsonArray(input);
    expect(result).toEqual([{ desc: 'change {color: red} for [active] state' }]);
  });

  it('handles escaped quotes inside strings', () => {
    const input = '[{"desc": "use \\"nova\\" prefix", "files": ["src/utils.ts"]}]';
    const result = parseJsonArray(input);
    expect(result).toEqual([{ desc: 'use "nova" prefix', files: ['src/utils.ts'] }]);
  });

  // ── Prose before/after JSON ────────────────────────

  it('extracts JSON array when preceded by prose', () => {
    const input =
      'Here is the analysis result:\n\nI found the following tasks:\n[{"description": "fix header", "type": "css"}]';
    const result = parseJsonArray(input);
    expect(result).toEqual([{ description: 'fix header', type: 'css' }]);
  });

  it('extracts JSON array when followed by prose', () => {
    const input =
      '[{"description": "fix header", "type": "css"}]\n\nLet me know if you need changes.';
    const result = parseJsonArray(input);
    expect(result).toEqual([{ description: 'fix header', type: 'css' }]);
  });

  it('extracts JSON array surrounded by prose on both sides', () => {
    const input =
      'Sure! Here is my analysis:\n[{"desc": "add logout", "files": ["header.tsx"]}]\nThose are the changes I recommend.';
    const result = parseJsonArray(input);
    expect(result).toEqual([{ desc: 'add logout', files: ['header.tsx'] }]);
  });

  it('picks the last valid array when multiple candidates exist', () => {
    const input = '[{"a": 1}] Let me reconsider... [{"b": 2}, {"c": 3}]';
    const result = parseJsonArray(input);
    expect(result).toEqual([{ b: 2 }, { c: 3 }]);
  });

  // ── Malformed JSON ─────────────────────────────────

  it('throws a clean Error for unclosed array (missing closing bracket)', () => {
    expect(() => parseJsonArray('[{"a": 1')).toThrow('No valid JSON array found in response');
  });

  it('throws a clean Error for unclosed string in array', () => {
    expect(() => parseJsonArray('[{"desc": "unclosed string]')).toThrow(
      'No valid JSON array found in response',
    );
  });

  it('throws a clean Error for completely malformed text', () => {
    expect(() => parseJsonArray('not json at all')).toThrow(
      'No valid JSON array found in response',
    );
  });

  it('throws a clean Error for an object instead of array', () => {
    expect(() => parseJsonArray('{"a": 1}')).toThrow('No valid JSON array found in response');
  });

  it('throws a clean Error for empty response', () => {
    expect(() => parseJsonArray('')).toThrow('No valid JSON array found in response');
  });

  it('throws a clean Error for whitespace-only response', () => {
    expect(() => parseJsonArray('   \n  \t  ')).toThrow('No valid JSON array found in response');
  });

  // ── Markdown code fences ───────────────────────────

  it('strips markdown code fences with json tag', () => {
    const input = '```json\n[{"a": 1}]\n```';
    const result = parseJsonArray(input);
    expect(result).toEqual([{ a: 1 }]);
  });

  it('strips markdown code fences without language tag', () => {
    const input = '```\n[{"a": 1}]\n```';
    const result = parseJsonArray(input);
    expect(result).toEqual([{ a: 1 }]);
  });

  it('handles code fence with prose around it', () => {
    const input = 'Here you go:\n```json\n[{"desc": "fix bug", "type": "single_file"}]\n```\nDone.';
    const result = parseJsonArray(input);
    expect(result).toEqual([{ desc: 'fix bug', type: 'single_file' }]);
  });

  // ── Empty array ────────────────────────────────────

  it('handles empty array', () => {
    const result = parseJsonArray('[]');
    expect(result).toEqual([]);
  });

  // ── Array with numbers, booleans, null ─────────────

  it('handles arrays with mixed value types', () => {
    const result = parseJsonArray('[1, "two", true, false, null]');
    expect(result).toEqual([1, 'two', true, false, null]);
  });

  // ── Nested objects with shared keys ────────────────

  it('handles nested objects with the same key names', () => {
    const input = '[{"type": "css", "changes": {"type": "color", "value": "red"}}]';
    const result = parseJsonArray(input);
    expect(result).toEqual([{ type: 'css', changes: { type: 'color', value: 'red' } }]);
  });

  // ── Brace-only content (curly braces in array elements) ───

  it('handles array of objects with many nested braces', () => {
    const input =
      '[{"props": {"style": {"color": "red", "fontSize": "14px"}}, "children": [{"type": "div"}]}]';
    const result = parseJsonArray(input);
    expect(result).toHaveLength(1);
    const item = result[0] as Record<string, unknown>;
    expect(item).toHaveProperty('props');
    expect(item).toHaveProperty('children');
    expect(item.children as unknown[]).toHaveLength(1);
  });
});

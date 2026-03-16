import { describe, it, expect } from 'vitest';
import { LaneClassifier } from '../LaneClassifier.js';

describe('LaneClassifier', () => {
  const classifier = new LaneClassifier();

  // ── Lane 1: style/text-only + single file ──────────────────

  describe('Lane 1 — style/text changes on a single file', () => {
    it.each([
      ['make button blue', ['Button.tsx']],
      ['change font size to 16px', ['styles.css']],
      ['change color to red', ['Card.tsx']],
      ['hide sidebar', ['Layout.tsx']],
      ['set padding to 20px', ['App.css']],
      ['change background color', ['Header.tsx']],
      ['update label text', ['Form.tsx']],
      ['set opacity to 0.5', ['Modal.tsx']],
    ])('"%s" with %j returns lane 1', (description, files) => {
      expect(classifier.classify(description, files)).toBe(1);
    });
  });

  // ── Lane 2: single file non-style / default ────────────────

  describe('Lane 2 — single file non-style or default', () => {
    it('classifies adding a new element to a component as lane 2', () => {
      expect(classifier.classify('add search input to this component', ['SearchPage.tsx'])).toBe(2);
    });

    it('classifies "add blue button" as lane 2 (new element, not just style)', () => {
      expect(classifier.classify('add blue button', ['Dashboard.tsx'])).toBe(2);
    });

    it('classifies fixing validation as lane 2', () => {
      expect(classifier.classify('fix the login form validation', ['LoginForm.tsx'])).toBe(2);
    });

    it('classifies CSS keyword with multiple files as lane 2 (not lane 1)', () => {
      expect(classifier.classify('change color to red', ['a.css', 'b.css'])).toBe(2);
    });

    it('classifies empty description and empty files as lane 2 (default)', () => {
      expect(classifier.classify('', [])).toBe(2);
    });
  });

  // ── Lane 3: multi-file or creation keywords ────────────────

  describe('Lane 3 — multi-file or new page/endpoint/component', () => {
    it('classifies adding a page with API across multiple files as lane 3', () => {
      expect(classifier.classify('add user management page with API', ['page.tsx', 'route.ts'])).toBe(3);
    });

    it('classifies creating a new component with no files as lane 3', () => {
      expect(classifier.classify('create new component', [])).toBe(3);
    });

    it('classifies adding an endpoint across multiple files as lane 3', () => {
      expect(classifier.classify('add endpoint for documents', ['route.ts', 'types.ts'])).toBe(3);
    });
  });

  // ── Lane 4: refactor/migrate/rewrite ───────────────────────

  describe('Lane 4 — refactor, migrate, rewrite', () => {
    it('classifies refactoring as lane 4', () => {
      expect(classifier.classify('refactor authentication module', ['auth.ts'])).toBe(4);
    });

    it('classifies migration as lane 4', () => {
      expect(classifier.classify('migrate database to new schema', [])).toBe(4);
    });

    it('classifies rewriting as lane 4', () => {
      expect(classifier.classify('rewrite the dashboard', ['Dashboard.tsx'])).toBe(4);
    });
  });

  // ── Performance ────────────────────────────────────────────

  describe('Performance', () => {
    it('completes 1000 classifications in under 100ms', () => {
      const inputs: Array<[string, string[]]> = [
        ['make button blue', ['Button.tsx']],
        ['add search input to this component', ['SearchPage.tsx']],
        ['add user management page with API', ['page.tsx', 'route.ts']],
        ['refactor authentication module', ['auth.ts']],
        ['change font size to 16px', ['styles.css']],
      ];

      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        const [desc, files] = inputs[i % inputs.length];
        classifier.classify(desc, files);
      }

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(100);
    });
  });
});

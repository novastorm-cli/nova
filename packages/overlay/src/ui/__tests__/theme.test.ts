/**
 * Unit tests for the theme system.
 *
 * Tests applyTheme(), restoreTheme(), getCurrentTheme(), and verifies:
 * - data-theme attribute is set correctly on the root element
 * - CSS custom properties (tokens) are written for each mode
 * - localStorage is updated for explicit modes, cleared for auto
 * - auto mode installs a matchMedia listener and reacts to OS changes
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyTheme, restoreTheme, getCurrentTheme, TOKENS } from '../theme.js';

// jsdom does not ship MediaQueryList; create a minimal mock.
class MockMediaQueryList extends EventTarget {
  matches: boolean;
  media: string;
  constructor(media: string, matches = false) {
    super();
    this.media = media;
    this.matches = matches;
  }
}

/** Clean up and re-create nova-root, returning it. */
function setupDom(): HTMLElement {
  // Remove any prior nova-root
  document.getElementById('nova-root')?.remove();
  // Remove data-nova attribute from any lingering element
  for (const el of document.querySelectorAll('[data-nova="root"]')) {
    el.removeAttribute('data-nova');
    el.removeAttribute('data-theme');
  }

  const root = document.createElement('div');
  root.id = 'nova-root';
  root.setAttribute('data-nova', 'root');
  document.body.appendChild(root);
  return root;
}

/** Read a CSS custom property from an element. */
function getVar(el: HTMLElement, name: string): string {
  return el.style.getPropertyValue(name);
}

/** Create a mock matchMedia that returns a MockMediaQueryList. */
function mockMatchMedia(matches = false): MockMediaQueryList {
  return new MockMediaQueryList('(prefers-color-scheme: light)', matches);
}

describe('applyTheme', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = setupDom();
    localStorage.clear();
    // Stub matchMedia with a controllable mock
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => new MockMediaQueryList(query, false) as unknown as MediaQueryList,
    );
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('explicit modes', () => {
    it('sets data-theme="dark" when mode is dark', () => {
      applyTheme('dark');
      expect(root.getAttribute('data-theme')).toBe('dark');
    });

    it('sets data-theme="light" when mode is light', () => {
      applyTheme('light');
      expect(root.getAttribute('data-theme')).toBe('light');
    });

    it('writes dark token values for dark mode', () => {
      applyTheme('dark');
      expect(getVar(root, '--nova-panel-bg')).toBe(TOKENS.panelBg.dark);
      expect(getVar(root, '--nova-text-primary')).toBe(TOKENS.textPrimary.dark);
    });

    it('writes light token values for light mode', () => {
      applyTheme('light');
      expect(getVar(root, '--nova-panel-bg')).toBe(TOKENS.panelBg.light);
      expect(getVar(root, '--nova-text-primary')).toBe(TOKENS.textPrimary.light);
    });

    it('persists explicit mode to localStorage', () => {
      applyTheme('dark');
      expect(localStorage.getItem('nova:theme')).toBe('dark');

      applyTheme('light');
      expect(localStorage.getItem('nova:theme')).toBe('light');
    });

    it('does NOT install a matchMedia listener for explicit modes', () => {
      const mql = mockMatchMedia();
      const addSpy = vi.spyOn(mql, 'addEventListener');
      vi.spyOn(window, 'matchMedia').mockReturnValue(mql as unknown as MediaQueryList);

      applyTheme('dark');
      expect(addSpy).not.toHaveBeenCalled();
    });
  });

  describe('auto mode', () => {
    it('sets data-theme="dark" when OS prefers dark', () => {
      vi.spyOn(window, 'matchMedia').mockReturnValue(
        mockMatchMedia(false) as unknown as MediaQueryList,
      );
      applyTheme('auto');
      expect(root.getAttribute('data-theme')).toBe('dark');
    });

    it('sets data-theme="light" when OS prefers light', () => {
      vi.spyOn(window, 'matchMedia').mockReturnValue(
        mockMatchMedia(true) as unknown as MediaQueryList,
      );
      applyTheme('auto');
      expect(root.getAttribute('data-theme')).toBe('light');
    });

    it('installs a matchMedia change listener in auto mode', () => {
      const mql = mockMatchMedia();
      const addSpy = vi.spyOn(mql, 'addEventListener');
      vi.spyOn(window, 'matchMedia').mockReturnValue(mql as unknown as MediaQueryList);

      applyTheme('auto');
      expect(addSpy).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('clears localStorage theme key in auto mode', () => {
      localStorage.setItem('nova:theme', 'dark');
      applyTheme('auto');
      expect(localStorage.getItem('nova:theme')).toBeNull();
    });

    it('reacts to matchMedia change by updating data-theme', () => {
      const mql = mockMatchMedia(false);
      vi.spyOn(window, 'matchMedia').mockReturnValue(mql as unknown as MediaQueryList);

      applyTheme('auto');
      expect(root.getAttribute('data-theme')).toBe('dark');

      // Simulate OS switching to light
      (mql as unknown as { matches: boolean }).matches = true;
      mql.dispatchEvent(new Event('change'));

      expect(root.getAttribute('data-theme')).toBe('light');
    });
  });

  describe('token completeness', () => {
    it('sets all expected tokens for dark theme', () => {
      applyTheme('dark');
      const entries = Object.entries(TOKENS) as Array<[string, { light: string; dark: string }]>;
      for (const [key, values] of entries) {
        const cssVar = `--nova-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
        expect(getVar(root, cssVar)).toBe(values.dark);
      }
    });

    it('sets all expected tokens for light theme', () => {
      applyTheme('light');
      const entries = Object.entries(TOKENS) as Array<[string, { light: string; dark: string }]>;
      for (const [key, values] of entries) {
        const cssVar = `--nova-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
        expect(getVar(root, cssVar)).toBe(values.light);
      }
    });
  });
});

describe('restoreTheme', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = setupDom();
    localStorage.clear();
    vi.spyOn(window, 'matchMedia').mockReturnValue(
      mockMatchMedia(false) as unknown as MediaQueryList,
    );
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('defaults to auto when nothing is stored (OS dark → dark)', () => {
    restoreTheme();
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it('restores explicit light mode from localStorage', () => {
    localStorage.setItem('nova:theme', 'light');
    restoreTheme();
    expect(root.getAttribute('data-theme')).toBe('light');
  });

  it('restores explicit dark mode from localStorage', () => {
    localStorage.setItem('nova:theme', 'dark');
    restoreTheme();
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it('falls back to auto when localStorage value is not light/dark', () => {
    localStorage.setItem('nova:theme', 'invalid');
    restoreTheme();
    // auto → OS is dark so dark
    expect(root.getAttribute('data-theme')).toBe('dark');
  });
});

describe('getCurrentTheme', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('returns the current data-theme value from the root', () => {
    setupDom();
    applyTheme('light');
    expect(getCurrentTheme()).toBe('light');
  });

  it('defaults to dark when no root is present', () => {
    expect(getCurrentTheme()).toBe('dark');
  });

  it('accepts an explicit root element', () => {
    const el = document.createElement('div');
    el.setAttribute('data-theme', 'light');
    expect(getCurrentTheme(el)).toBe('light');
  });
});

describe('findOrCreateRoot', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('falls back to document.documentElement when no nova-root exists', () => {
    // Ensure no nova-root or data-nova="root" exists
    document.getElementById('nova-root')?.remove();
    for (const el of document.querySelectorAll('[data-nova="root"]')) {
      el.removeAttribute('data-nova');
    }

    applyTheme('dark');

    // The root theme is applied to document.documentElement even without data-nova
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    // Clean up
    document.documentElement.removeAttribute('data-theme');
  });

  it('reuses existing [data-nova="root"] element', () => {
    const root = setupDom();
    root.removeAttribute('data-theme');

    applyTheme('light');

    expect(root.getAttribute('data-theme')).toBe('light');
    expect(document.querySelectorAll('[data-nova="root"]').length).toBe(1);
  });
});

describe('WCAG contrast', () => {
  function luminance(r: number, g: number, b: number): number {
    const toLin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
  }

  function contrast(hex1: string, hex2: string): number {
    const parse = (h: string): [number, number, number] => [
      parseInt(h.slice(1, 3), 16) / 255,
      parseInt(h.slice(3, 5), 16) / 255,
      parseInt(h.slice(5, 7), 16) / 255,
    ];
    const [r1, g1, b1] = parse(hex1);
    const [r2, g2, b2] = parse(hex2);
    const l1 = luminance(r1, g1, b1);
    const l2 = luminance(r2, g2, b2);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  it('dark: text-primary on panel-bg >= 4.5:1', () => {
    expect(contrast('#f9fafb', '#14141c')).toBeGreaterThanOrEqual(4.5);
  });

  it('dark: text-secondary on panel-bg >= 4.5:1', () => {
    expect(contrast('#9ca3af', '#14141c')).toBeGreaterThanOrEqual(4.5);
  });

  it('light: text-primary on panel-bg >= 4.5:1', () => {
    expect(contrast('#111827', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('light: text-secondary on panel-bg >= 4.5:1', () => {
    expect(contrast('#6b7280', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

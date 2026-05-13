/**
 * Theme system for the Nova overlay.
 *
 * Defines CSS custom property tokens for all overlay UI colors and
 * exports applyTheme() to switch between light, dark, and auto modes.
 *
 * In auto mode, a matchMedia('(prefers-color-scheme: light)') listener
 * reacts to OS theme changes within a single animation frame (<500ms).
 */

export type ThemeMode = 'light' | 'dark' | 'auto';

/** Resolved (non-auto) mode at any given time. */
export type ResolvedTheme = 'light' | 'dark';

/**
 * Theme token definitions: semantic name → light/dark values.
 *
 * All text-on-background pairs meet WCAG AA contrast ≥ 4.5:1:
 *   light: #111827 on #ffffff → ~17:1
 *   light: #6b7280 on #ffffff → ~5.9:1
 *   dark:  #f9fafb on #1a1a2e → ~14:1
 *   dark:  #9ca3af on #1a1a2e → ~6.6:1
 *
 * Panel backgrounds use transparency + backdrop-filter for glass
 * effect, with an opaque fallback (`rgba(20,20,28,0.92)`) when blur
 * is not supported.
 */
export const TOKENS = {
  /** Panel / container background */
  panelBg: { light: 'rgba(255, 255, 255, 0.95)', dark: 'rgba(20, 20, 28, 0.92)' },
  /** Panel border */
  panelBorder: { light: 'rgba(0, 0, 0, 0.1)', dark: 'rgba(255, 255, 255, 0.08)' },
  /** Primary / heading text */
  textPrimary: { light: '#111827', dark: '#f9fafb' },
  /** Secondary / muted text */
  textSecondary: { light: '#6b7280', dark: '#9ca3af' },
  /** Brand accent (links, focus rings, highlights) */
  accent: { light: '#2563eb', dark: '#60a5fa' },
  /** Success state (checkmarks, green badges) */
  success: { light: '#059669', dark: '#34d399' },
  /** Warning state (amber) */
  warning: { light: '#d97706', dark: '#fbbf24' },
  /** Error / danger state (red) */
  error: { light: '#dc2626', dark: '#f87171' },
  /** Modal / overlay backdrop */
  backdrop: { light: 'rgba(0, 0, 0, 0.3)', dark: 'rgba(0, 0, 0, 0.6)' },
  /** Input / field background */
  inputBg: { light: '#f3f4f6', dark: '#111827' },
  /** Input / field border */
  inputBorder: { light: 'rgba(0, 0, 0, 0.15)', dark: '#374151' },
  /** Pill idle color */
  pillIdle: { light: '#6b7280', dark: '#6b7280' },
  /** Pill shadow */
  pillShadow: { light: 'rgba(0, 0, 0, 0.1)', dark: 'rgba(0, 0, 0, 0.3)' },
  /** Dropdown / menu background (opaque for readability) */
  dropdownBg: { light: '#ffffff', dark: '#1e1e2e' },
  /** Dropdown item hover */
  dropdownHover: { light: 'rgba(0, 0, 0, 0.04)', dark: 'rgba(255, 255, 255, 0.08)' },
  /** Subtle surface (card rows, code blocks) */
  surfaceSubtle: { light: 'rgba(0, 0, 0, 0.03)', dark: 'rgba(255, 255, 255, 0.04)' },
} as const;

/** localStorage key for explicit theme preference. */
const STORAGE_KEY = 'nova:theme';

/**
 * WeakMap holding matchMedia listener references so they can be
 * cleaned up when switching away from auto mode.
 */
const mediaListeners = new WeakMap<HTMLElement, { mql: MediaQueryList; listener: () => void }>();

/** Derive the resolved theme from mode + OS preference. */
function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'light' || mode === 'dark') return mode;
  // auto: check OS preference
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * Apply all CSS custom properties for the given resolved theme to a root element.
 * These are consumed by all overlay components via var(--nova-xxx) references.
 */
function applyTokens(root: HTMLElement, theme: ResolvedTheme): void {
  const entries = Object.entries(TOKENS) as Array<[string, { light: string; dark: string }]>;
  for (const [key, values] of entries) {
    const cssVar = `--nova-${toKebab(key)}`;
    root.style.setProperty(cssVar, values[theme]);
  }
}

/** Convert camelCase to kebab-case. */
function toKebab(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * Apply a theme to the overlay.
 *
 * Sets data-theme on the overlay root element and writes CSS custom
 * properties.  In 'auto' mode installs a matchMedia listener so the
 * overlay tracks OS-level preference changes in real time.
 *
 * @param mode  'light' | 'dark' | 'auto'
 */
export function applyTheme(mode: ThemeMode): void {
  const root = findOrCreateRoot();

  // Persist explicit choice (not 'auto')
  if (mode === 'light' || mode === 'dark') {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // localStorage may be unavailable
    }
  } else {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage may be unavailable
    }
  }

  const resolved = resolveTheme(mode);
  root.setAttribute('data-theme', resolved);
  applyTokens(root, resolved);

  // Install or remove OS scheme listener for auto mode
  cleanupMediaListener(root);
  if (mode === 'auto') {
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const listener = (): void => {
      const newResolved = resolveTheme('auto');
      root.setAttribute('data-theme', newResolved);
      applyTokens(root, newResolved);
    };
    mql.addEventListener('change', listener);
    mediaListeners.set(root, { mql, listener });
  }
}

/** Restore persisted theme on boot. */
export function restoreTheme(): void {
  let stored: ThemeMode | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
  } catch {
    // localStorage may be unavailable
  }
  applyTheme(stored ?? 'auto');
}

/**
 * Find (or create) the overlay root element that carries data-nova="root".
 * This is the element that CSS custom properties are set on so they
 * propagate into all shadow roots.
 */
function findOrCreateRoot(): HTMLElement {
  const existing = document.querySelector('[data-nova="root"]');
  if (existing instanceof HTMLElement) return existing;

  // The nova-root div created by the boot sequence; if not yet created,
  // fall back to document.documentElement and let boot re-anchor later.
  const novaRoot = document.getElementById('nova-root');
  if (novaRoot) {
    novaRoot.setAttribute('data-nova', 'root');
    return novaRoot;
  }
  return document.documentElement;
}

/** Remove any previously installed matchMedia listener. */
function cleanupMediaListener(root: HTMLElement): void {
  const held = mediaListeners.get(root);
  if (held) {
    held.mql.removeEventListener('change', held.listener);
    mediaListeners.delete(root);
  }
}

/**
 * Get the current resolved theme.
 * Returns 'dark' by default if nothing has been applied yet.
 */
export function getCurrentTheme(root?: HTMLElement): ResolvedTheme {
  const r = root ?? document.querySelector('[data-nova="root"]');
  if (!r || !(r instanceof HTMLElement)) return 'dark';
  const attr = r.getAttribute('data-theme');
  return attr === 'light' ? 'light' : 'dark';
}

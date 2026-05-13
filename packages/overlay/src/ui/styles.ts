/**
 * CSS-in-JS helper for inline styles.
 * Converts style objects to CSS strings and provides style constants.
 *
 * All color constants now refer to CSS custom properties defined by
 * packages/overlay/src/ui/theme.ts.  This allows the overlay to respond
 * to theme changes (light / dark / auto) without re-rendering.
 *
 * Backdrop-filter usage with opaque fallback:
 * ```
 *   background: var(--nova-panel-bg);
 *   backdrop-filter: blur(20px);
 *   -webkit-backdrop-filter: blur(20px);
 * ```
 */

export type StyleObject = Record<string, string | number>;

export function toStyleString(styles: StyleObject): string {
  return Object.entries(styles)
    .map(([key, value]) => {
      const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
      return `${cssKey}: ${typeof value === 'number' ? `${value}px` : value}`;
    })
    .join('; ');
}

export function applyStyles(element: HTMLElement, styles: StyleObject): void {
  const styleStr = toStyleString(styles);
  element.setAttribute('style', styleStr);
}

/**
 * Semantic color tokens — all refer to CSS custom properties set by
 * applyTheme() so that light / dark / auto mode is honored.
 */
export const COLORS = {
  idle: 'var(--nova-pill-idle)',
  listening: 'var(--nova-success)',
  processing: 'var(--nova-accent)',
  error: 'var(--nova-error)',
  info: 'var(--nova-accent)',
  success: 'var(--nova-success)',
  white: '#ffffff',
  overlayBg: 'var(--nova-panel-bg)',
  inputBg: 'var(--nova-input-bg)',
  inputBorder: 'var(--nova-input-border)',
  textPrimary: 'var(--nova-text-primary)',
  textSecondary: 'var(--nova-text-secondary)',
} as const;

export const Z_INDEX = {
  activityLog: 2147483635,
  suggestionPanel: 2147483636,
  selector: 2147483636,
  transcriptBar: 2147483637,
  taskPanel: 2147483638,
  secretConsole: 2147483639,
  pill: 2147483640,
  commandInput: 2147483641,
  multiSelector: 2147483641,
  areaSelector: 2147483642,
  toast: 2147483645,
} as const;

export const PILL_SIZE = 48;

export const TRANSITION = 'all 0.2s ease';

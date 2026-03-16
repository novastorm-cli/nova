/**
 * CSS-in-JS helper for inline styles.
 * Converts style objects to CSS strings and provides style constants.
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

export const COLORS = {
  idle: '#6b7280',
  listening: '#10b981',
  processing: '#3b82f6',
  error: '#ef4444',
  info: '#3b82f6',
  success: '#10b981',
  white: '#ffffff',
  overlayBg: '#1f2937',
  inputBg: '#111827',
  inputBorder: '#374151',
  textPrimary: '#f9fafb',
  textSecondary: '#9ca3af',
} as const;

export const Z_INDEX = {
  pill: 2147483640,
  commandInput: 2147483641,
  selector: 2147483639,
  toast: 2147483642,
  transcriptBar: 2147483638,
} as const;

export const PILL_SIZE = 48;

export const TRANSITION = 'all 0.2s ease';

import type { IScreenshotCapture } from '../contracts/ICapture.js';

const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;

type Html2CanvasFn = (
  element: HTMLElement,
  options?: Record<string, unknown>,
) => Promise<HTMLCanvasElement>;

async function loadHtml2Canvas(): Promise<Html2CanvasFn> {
  const mod: unknown = await import('html2canvas');
  const m = mod as { default?: unknown };
  const fn = typeof m.default === 'function' ? m.default : mod;
  return fn as Html2CanvasFn;
}

export class ScreenshotCapture implements IScreenshotCapture {
  async captureViewport(): Promise<Blob> {
    // Try html2canvas first, fall back to simple canvas capture
    try {
      const html2canvas = await loadHtml2Canvas();
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        allowTaint: false,
        logging: false,
        ignoreElements: (element: Element) => {
          // Skip Nova overlay elements
          return element.hasAttribute('data-nova-transcript') ||
                 element.hasAttribute('data-nova-pill') ||
                 element.hasAttribute('data-nova-toast');
        },
      });

      const resized = this.resizeIfNeeded(canvas);
      return this.canvasToBlob(resized);
    } catch {
      // html2canvas failed (e.g. unsupported CSS like lab() colors)
      // Fall back to a simple viewport screenshot via canvas
      return this.fallbackCapture();
    }
  }

  private async fallbackCapture(): Promise<Blob> {
    // Create a simple canvas with the page dimensions and a message
    // This is a minimal fallback — the screenshot won't be pixel-perfect
    // but it allows the AI to at least know the viewport size
    const width = Math.min(window.innerWidth || 800, MAX_WIDTH);
    const height = Math.min(window.innerHeight || 600, MAX_HEIGHT);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('Canvas 2D context not available for fallback screenshot');
    }

    // Draw a white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Try to capture visible text content for context
    ctx.fillStyle = '#333333';
    ctx.font = '14px system-ui, sans-serif';

    const lines = [
      `Page: ${document.title || window.location.pathname}`,
      `URL: ${window.location.href}`,
      `Viewport: ${window.innerWidth}x${window.innerHeight}`,
      '',
      'Note: Full screenshot unavailable (CSS compatibility issue).',
      'The page content is described by the DOM snapshot.',
    ];

    let y = 30;
    for (const line of lines) {
      ctx.fillText(line, 20, y);
      y += 22;
    }

    return this.canvasToBlob(canvas);
  }

  private canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to convert canvas to PNG blob'));
        }
      }, 'image/png');
    });
  }

  private resizeIfNeeded(source: HTMLCanvasElement): HTMLCanvasElement {
    const { width, height } = source;

    if (width <= MAX_WIDTH && height <= MAX_HEIGHT) {
      return source;
    }

    const scale = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height);
    const targetWidth = Math.round(width * scale);
    const targetHeight = Math.round(height * scale);

    const resized = document.createElement('canvas');
    resized.width = targetWidth;
    resized.height = targetHeight;

    const ctx = resized.getContext('2d');
    if (!ctx) {
      return source;
    }

    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
    return resized;
  }
}

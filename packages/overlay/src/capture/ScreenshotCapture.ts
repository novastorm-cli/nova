import type { IScreenshotCapture } from '../contracts/ICapture.js';

const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;

type Html2CanvasFn = (
  element: HTMLElement,
  options?: Record<string, unknown>,
) => Promise<HTMLCanvasElement>;

async function loadHtml2Canvas(): Promise<Html2CanvasFn> {
  // Dynamic import to handle CJS/ESM interop under Node16 module resolution.
  const mod: unknown = await import('html2canvas');
  const m = mod as { default?: unknown };
  const fn = typeof m.default === 'function' ? m.default : mod;
  return fn as Html2CanvasFn;
}

export class ScreenshotCapture implements IScreenshotCapture {
  async captureViewport(): Promise<Blob> {
    const html2canvas = await loadHtml2Canvas();
    const canvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: false,
      logging: false,
    });

    const resized = this.resizeIfNeeded(canvas);

    return new Promise<Blob>((resolve, reject) => {
      resized.toBlob((blob) => {
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

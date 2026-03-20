import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

let dom: JSDOM;
let cleanup: () => void;

beforeEach(() => {
  dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost',
    pretendToBeVisual: true,
  });

  const origDocument = globalThis.document;
  const origImage = globalThis.Image;
  const origHTMLCanvasElement = globalThis.HTMLCanvasElement;

  globalThis.document = dom.window.document as unknown as Document;
  globalThis.HTMLCanvasElement = dom.window.HTMLCanvasElement as unknown as typeof HTMLCanvasElement;
  globalThis.Image = dom.window.Image as unknown as typeof Image;

  cleanup = () => {
    globalThis.document = origDocument;
    globalThis.Image = origImage;
    globalThis.HTMLCanvasElement = origHTMLCanvasElement;
  };
});

afterEach(() => {
  cleanup();
});

async function createCapture() {
  const mod = await import('../AreaCapture.js');
  return new mod.AreaCapture();
}

describe('AreaCapture', () => {
  describe('cropFromScreenshot', () => {
    it('should create a canvas with the correct dimensions', async () => {
      const capture = await createCapture();

      // Mock the canvas context
      const drawImageFn = vi.fn();
      const toDataURLFn = vi.fn().mockReturnValue('data:image/png;base64,cropped');

      const mockCtx = {
        drawImage: drawImageFn,
      };

      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = origCreateElement(tag);
        if (tag === 'canvas') {
          vi.spyOn(el as HTMLCanvasElement, 'getContext').mockReturnValue(mockCtx as unknown as CanvasRenderingContext2D);
          vi.spyOn(el as HTMLCanvasElement, 'toDataURL').mockReturnValue('data:image/png;base64,cropped');
        }
        return el;
      });

      // We need to provide a valid image. In jsdom, Image.onload won't fire automatically.
      // So we mock Image to immediately call onload.
      const OrigImage = globalThis.Image;
      globalThis.Image = class MockImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        private _src = '';

        get src() { return this._src; }
        set src(value: string) {
          this._src = value;
          // Trigger onload asynchronously
          setTimeout(() => this.onload?.(), 0);
        }
      } as unknown as typeof Image;

      const result = await capture.cropFromScreenshot(
        'iVBORw0KGgoAAAANS',
        { x: 10, y: 20, width: 100, height: 50 },
      );

      expect(result).toBe('data:image/png;base64,cropped');
      expect(drawImageFn).toHaveBeenCalledWith(
        expect.anything(),
        10, 20, 100, 50,
        0, 0, 100, 50,
      );

      globalThis.Image = OrigImage;
    });

    it('should handle base64 strings with data URL prefix', async () => {
      const capture = await createCapture();

      const drawImageFn = vi.fn();
      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        const el = origCreateElement(tag);
        if (tag === 'canvas') {
          vi.spyOn(el as HTMLCanvasElement, 'getContext').mockReturnValue({
            drawImage: drawImageFn,
          } as unknown as CanvasRenderingContext2D);
          vi.spyOn(el as HTMLCanvasElement, 'toDataURL').mockReturnValue('data:image/png;base64,result');
        }
        return el;
      });

      const OrigImage = globalThis.Image;
      let capturedSrc = '';
      globalThis.Image = class MockImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        private _src = '';

        get src() { return this._src; }
        set src(value: string) {
          this._src = value;
          capturedSrc = value;
          setTimeout(() => this.onload?.(), 0);
        }
      } as unknown as typeof Image;

      await capture.cropFromScreenshot(
        'data:image/png;base64,existingPrefix',
        { x: 0, y: 0, width: 50, height: 50 },
      );

      // Should not double-prefix
      expect(capturedSrc).toBe('data:image/png;base64,existingPrefix');

      globalThis.Image = OrigImage;
    });

    it('should reject when image fails to load', async () => {
      const capture = await createCapture();

      const OrigImage = globalThis.Image;
      globalThis.Image = class MockImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        private _src = '';

        get src() { return this._src; }
        set src(value: string) {
          this._src = value;
          setTimeout(() => this.onerror?.(), 0);
        }
      } as unknown as typeof Image;

      await expect(
        capture.cropFromScreenshot('bad-data', { x: 0, y: 0, width: 10, height: 10 }),
      ).rejects.toThrow('Failed to load screenshot image for cropping');

      globalThis.Image = OrigImage;
    });
  });
});

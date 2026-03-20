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

export class AreaCapture {
  /**
   * Captures a cropped screenshot of the selected area directly.
   * Uses html2canvas to render the page, then crops to the specified region.
   *
   * @returns base64 data URL of the cropped area (image/png)
   */
  async capture(area: { x: number; y: number; width: number; height: number }): Promise<string> {
    const html2canvas = await loadHtml2Canvas();
    const fullCanvas = await html2canvas(document.body, {
      useCORS: true,
      allowTaint: false,
      logging: false,
      ignoreElements: (element: Element) => {
        return element.hasAttribute('data-nova-area-selector') ||
               element.hasAttribute('data-nova-pill') ||
               element.hasAttribute('data-nova-toast') ||
               element.hasAttribute('data-nova-transcript');
      },
    });

    return this.cropCanvas(fullCanvas, area);
  }

  /**
   * Crops a region from an existing full screenshot (base64 string).
   *
   * @param fullScreenshotBase64 - base64 encoded image (with or without data URL prefix)
   * @param area - the rectangle to crop
   * @returns base64 data URL of the cropped area (image/png)
   */
  cropFromScreenshot(
    fullScreenshotBase64: string,
    area: { x: number; y: number; width: number; height: number },
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = area.width;
        canvas.height = area.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas 2d context'));
          return;
        }

        ctx.drawImage(
          img,
          area.x, area.y, area.width, area.height,
          0, 0, area.width, area.height,
        );

        resolve(canvas.toDataURL('image/png'));
      };

      img.onerror = () => {
        reject(new Error('Failed to load screenshot image for cropping'));
      };

      // Ensure data URL prefix is present
      const src = fullScreenshotBase64.startsWith('data:')
        ? fullScreenshotBase64
        : `data:image/png;base64,${fullScreenshotBase64}`;
      img.src = src;
    });
  }

  private cropCanvas(
    source: HTMLCanvasElement,
    area: { x: number; y: number; width: number; height: number },
  ): string {
    const canvas = document.createElement('canvas');
    canvas.width = area.width;
    canvas.height = area.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas 2d context');
    }

    ctx.drawImage(
      source,
      area.x, area.y, area.width, area.height,
      0, 0, area.width, area.height,
    );

    return canvas.toDataURL('image/png');
  }
}

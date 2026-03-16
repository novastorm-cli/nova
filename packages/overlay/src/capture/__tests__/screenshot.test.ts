// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('html2canvas', () => ({ default: vi.fn() }));

import { ScreenshotCapture } from '../ScreenshotCapture.js';
import html2canvas from 'html2canvas';

const mockedHtml2canvas = vi.mocked(html2canvas);

describe('ScreenshotCapture', () => {
  let capture: ScreenshotCapture;

  beforeEach(() => {
    vi.clearAllMocks();
    capture = new ScreenshotCapture();
  });

  it('captureViewport() calls html2canvas and returns a Blob', async () => {
    const fakeBlob = new Blob(['png-data'], { type: 'image/png' });
    const fakeCanvas = {
      toBlob: vi.fn((cb: (blob: Blob | null) => void) => cb(fakeBlob)),
      width: 800,
      height: 600,
    } as unknown as HTMLCanvasElement;

    mockedHtml2canvas.mockResolvedValue(fakeCanvas);

    const result = await capture.captureViewport();

    expect(mockedHtml2canvas).toHaveBeenCalled();
    expect(result).toBeInstanceOf(Blob);
  });

  it('captureViewport() throws when html2canvas fails', async () => {
    mockedHtml2canvas.mockRejectedValue(new Error('cross-origin iframe'));

    await expect(capture.captureViewport()).rejects.toThrow();
  });
});

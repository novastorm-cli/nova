export interface IScreenshotCapture {
  /**
   * Captures the current viewport as PNG blob.
   * Uses html2canvas. Resizes to max 1920x1080 if viewport is larger.
   *
   * @returns PNG blob
   * @throws if html2canvas fails (e.g. cross-origin iframes)
   */
  captureViewport(): Promise<Blob>;
}

export interface IDomCapture {
  /**
   * Captures HTML snippet of an element and its context.
   *
   * Includes: the element + 2 levels of parent elements.
   * Strips noisy attributes: data-reactid, data-testid, class names > 100 chars.
   * Adds inline computed styles for: color, background, font-size, display, position.
   *
   * @returns cleaned HTML string, max ~2000 chars
   */
  captureElement(element: HTMLElement): string;
}

export interface IVoiceCapture {
  /**
   * Starts continuous voice recognition using Web Speech API.
   * Emits interim and final transcription results via callback.
   *
   * Supports: Russian (ru-RU) and English (en-US).
   * Auto-detects language if browser supports it.
   *
   * Does nothing if Web Speech API is not available (no error).
   */
  start(): void;

  /** Stops voice recognition. */
  stop(): void;

  /** Returns true if currently listening. */
  isListening(): boolean;

  /**
   * Register callback for transcription results.
   * @param handler - receives { text: string, isFinal: boolean }
   */
  onTranscript(handler: (result: { text: string; isFinal: boolean }) => void): void;
}

export interface IConsoleCapture {
  /**
   * Installs console.error and console.warn interceptors.
   * Stores last 20 errors. Does NOT suppress original console output.
   * Idempotent — safe to call multiple times.
   */
  install(): void;

  /** Removes interceptors, restores original console methods. */
  uninstall(): void;

  /** Returns captured errors (newest first). */
  getErrors(): string[];

  /** Register callback for new errors. */
  onError(handler: (error: string) => void): void;
}

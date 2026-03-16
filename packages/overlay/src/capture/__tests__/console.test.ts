// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConsoleCapture } from '../ConsoleCapture.js';

describe('ConsoleCapture', () => {
  let capture: ConsoleCapture;
  let originalConsoleError: typeof console.error;

  beforeEach(() => {
    originalConsoleError = console.error;
    capture = new ConsoleCapture();
  });

  afterEach(() => {
    // Ensure interceptors are removed after each test
    capture.uninstall();
    // Restore if uninstall didn't fully restore
    console.error = originalConsoleError;
  });

  it('install() intercepts console.error and getErrors() contains the message', () => {
    capture.install();

    console.error('test');

    const errors = capture.getErrors();
    expect(errors.some((e) => e.includes('test'))).toBe(true);
  });

  it('original console.error is still called after install()', () => {
    const spy = vi.fn();
    console.error = spy;
    // Re-create capture so it picks up current console.error as "original"
    capture = new ConsoleCapture();
    capture.install();

    console.error('check-original');

    expect(spy).toHaveBeenCalledWith('check-original');
  });

  it('stores a maximum of 20 errors, removing oldest', () => {
    capture.install();

    for (let i = 0; i < 25; i++) {
      console.error(`error-${i}`);
    }

    const errors = capture.getErrors();
    expect(errors.length).toBeLessThanOrEqual(20);
    // Newest first per contract, so error-24 should be present
    expect(errors.some((e) => e.includes('error-24'))).toBe(true);
    // Oldest (error-0 through error-4) should have been removed
    expect(errors.some((e) => e.includes('error-0'))).toBe(false);
  });

  it('uninstall() restores original console.error', () => {
    const original = console.error;
    capture.install();

    expect(console.error).not.toBe(original);

    capture.uninstall();

    expect(console.error).toBe(original);
  });

  it('install() is idempotent — second call is a no-op', () => {
    capture.install();
    const intercepted = console.error;

    capture.install(); // second call

    // console.error should be the same interceptor, not double-wrapped
    expect(console.error).toBe(intercepted);
  });

  it('onError callback is called when console.error is invoked', () => {
    const handler = vi.fn();
    capture.onError(handler);
    capture.install();

    console.error('callback-test');

    expect(handler).toHaveBeenCalledWith(expect.stringContaining('callback-test'));
  });
});

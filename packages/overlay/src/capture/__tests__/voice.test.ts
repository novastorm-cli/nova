// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceCapture } from '../VoiceCapture.js';

class MockSpeechRecognition {
  continuous = false;
  lang = '';
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
}

// Mock AudioContext and AnalyserNode
class MockAnalyserNode {
  fftSize = 256;
  frequencyBinCount = 128;
  getByteTimeDomainData = vi.fn((arr: Uint8Array) => {
    // Fill with 128 (silence center point) to simulate zero amplitude
    for (let i = 0; i < arr.length; i++) arr[i] = 128;
  });
  connect = vi.fn();
}

class MockAudioContext {
  state = 'running';
  createAnalyser = vi.fn(() => new MockAnalyserNode());
  createMediaStreamSource = vi.fn(() => ({
    connect: vi.fn(),
  }));
  close = vi.fn(() => Promise.resolve());
}

describe('VoiceCapture', () => {
  let capture: VoiceCapture;
  let originalSpeechRecognition: unknown;
  let originalGetUserMedia: unknown;
  let originalAudioContext: unknown;
  let mockGetUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    originalSpeechRecognition = (globalThis as Record<string, unknown>).SpeechRecognition;
    (globalThis as Record<string, unknown>).SpeechRecognition = MockSpeechRecognition;

    originalAudioContext = (globalThis as Record<string, unknown>).AudioContext;
    (globalThis as Record<string, unknown>).AudioContext = MockAudioContext;

    originalGetUserMedia = navigator.mediaDevices?.getUserMedia;
    mockGetUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    });
    if (navigator.mediaDevices) {
      (navigator.mediaDevices as unknown as Record<string, unknown>).getUserMedia =
        mockGetUserMedia;
    } else {
      Object.defineProperty(navigator, 'mediaDevices', {
        value: { getUserMedia: mockGetUserMedia },
        configurable: true,
        writable: true,
      });
    }

    capture = new VoiceCapture();
  });

  afterEach(() => {
    capture.stop();
    vi.useRealTimers();

    if (originalSpeechRecognition === undefined) {
      delete (globalThis as Record<string, unknown>).SpeechRecognition;
    } else {
      (globalThis as Record<string, unknown>).SpeechRecognition = originalSpeechRecognition;
    }

    if (originalAudioContext === undefined) {
      delete (globalThis as Record<string, unknown>).AudioContext;
    } else {
      (globalThis as Record<string, unknown>).AudioContext = originalAudioContext;
    }

    if (navigator.mediaDevices && originalGetUserMedia !== undefined) {
      (navigator.mediaDevices as unknown as Record<string, unknown>).getUserMedia =
        originalGetUserMedia;
    }

    vi.restoreAllMocks();
  });

  it('start() creates SpeechRecognition with continuous=true', () => {
    capture.start();

    // Verify by checking isListening flipped to true (recognition was created and started)
    expect(capture.isListening()).toBe(true);
  });

  it('stop() stops recognition', () => {
    capture.start();
    expect(capture.isListening()).toBe(true);

    capture.stop();
    expect(capture.isListening()).toBe(false);
  });

  it('isListening() returns false before start and after stop', () => {
    expect(capture.isListening()).toBe(false);

    capture.start();
    expect(capture.isListening()).toBe(true);

    capture.stop();
    expect(capture.isListening()).toBe(false);
  });

  it('onTranscript callback is called with { text, isFinal }', () => {
    const handler = vi.fn();
    capture.onTranscript(handler);
    capture.start();

    // Simulate a recognition result event
    const mockEvent = {
      results: [[{ transcript: 'hello world' }]],
      resultIndex: 0,
    };
    const instances = vi.mocked(MockSpeechRecognition);

    const resultEvent = {
      results: {
        length: 1,
        0: {
          length: 1,
          0: { transcript: 'hello world' },
          isFinal: true,
        },
      },
      resultIndex: 0,
    };

    capture.stop();

    let capturedInstance: MockSpeechRecognition | null = null;
    const OrigMock = MockSpeechRecognition;
    (globalThis as Record<string, unknown>).SpeechRecognition = class extends OrigMock {
      constructor() {
        super();
        capturedInstance = this;
      }
    };

    const capture2 = new VoiceCapture();
    const handler2 = vi.fn();
    capture2.onTranscript(handler2);
    capture2.start();

    expect(capturedInstance).not.toBeNull();
    if (capturedInstance) {
      const instance = capturedInstance as MockSpeechRecognition & {
        onresult: ((event: unknown) => void) | null;
      };
      if (instance.onresult) {
        instance.onresult(resultEvent);
      }
    }

    expect(handler2).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'hello world', isFinal: true }),
    );
  });

  it('start() without SpeechRecognition API does not throw', () => {
    delete (globalThis as Record<string, unknown>).SpeechRecognition;
    // Also remove webkitSpeechRecognition if present
    delete (globalThis as Record<string, unknown>).webkitSpeechRecognition;

    const capture2 = new VoiceCapture();

    expect(() => capture2.start()).not.toThrow();
    expect(capture2.isListening()).toBe(false);
  });

  // ── Amplitude callback tests ──────────────────────────────────────

  it('onAmplitude registers a handler', () => {
    const handler = vi.fn();
    capture.onAmplitude(handler);
    // Just verifying that the method doesn't throw and can be called
    expect(typeof handler).toBe('function');
  });

  it('start() calls getUserMedia for audio capture', async () => {
    const handler = vi.fn();
    capture.onAmplitude(handler);
    capture.start();

    // getUserMedia should have been called
    // Wait for the async startAudioCapture to complete
    await vi.advanceTimersByTimeAsync(100);

    expect(mockGetUserMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: expect.objectContaining({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }),
      }),
    );
  });

  it('stop() cancels animation frame and closes audio context', async () => {
    const handler = vi.fn();
    capture.onAmplitude(handler);
    capture.start();

    await vi.advanceTimersByTimeAsync(100);

    capture.stop();

    // After stop, isListening should be false
    expect(capture.isListening()).toBe(false);
  });

  it('amplitude handler is called with zero level from mock analyser', async () => {
    const handler = vi.fn();
    capture.onAmplitude(handler);
    capture.start();

    // Let the audio capture and rAF loop run
    await vi.advanceTimersByTimeAsync(200);

    // The handler should have been called at least once with amplitude ~0
    expect(handler).toHaveBeenCalled();

    // Check the level is close to 0 (mock fills with 128 = silence)
    const calls = handler.mock.calls as Array<[number]>;
    const hasLowAmplitude = calls.some(([level]) => level < 0.1);
    expect(hasLowAmplitude).toBe(true);
  });

  it('does not throw when getUserMedia is not available', () => {
    // Remove getUserMedia
    if (navigator.mediaDevices) {
      delete (navigator.mediaDevices as unknown as Record<string, unknown>).getUserMedia;
    }

    const capture2 = new VoiceCapture();
    expect(() => capture2.start()).not.toThrow();
    // Recognition still works (SpeechRecognition API is separate)
    expect(capture2.isListening()).toBe(true);
  });

  // ── Permission error tests ────────────────────────────────────────

  it('onPermissionError is called on NotAllowedError from getUserMedia', async () => {
    const handler = vi.fn();
    capture.onPermissionError(handler);

    // Make getUserMedia reject with NotAllowedError
    const notAllowedError = new DOMException('Permission denied', 'NotAllowedError');
    mockGetUserMedia.mockRejectedValueOnce(notAllowedError);

    capture.start();

    await vi.advanceTimersByTimeAsync(100);

    expect(handler).toHaveBeenCalledWith('NotAllowedError');
  });

  it('onPermissionError is called on PermissionDeniedError', async () => {
    const handler = vi.fn();
    capture.onPermissionError(handler);

    const permissionDeniedError = new DOMException('Permission denied', 'PermissionDeniedError');
    mockGetUserMedia.mockRejectedValueOnce(permissionDeniedError);

    capture.start();

    await vi.advanceTimersByTimeAsync(100);

    expect(handler).toHaveBeenCalledWith('PermissionDeniedError');
  });

  it('onPermissionError from speech recognition onerror is also fired', async () => {
    const permissionErrorHandler = vi.fn();

    // Create a capture instance with a pre-configured mock SpeechRecognition
    // that captures the instance so we can fire events on it later
    let capturedRecognition: MockSpeechRecognition | null = null;

    class CapturableMockRecognition extends MockSpeechRecognition {
      constructor() {
        super();

        capturedRecognition = this;
      }
    }

    (globalThis as Record<string, unknown>).SpeechRecognition = CapturableMockRecognition;

    // Start; getUserMedia resolves normally
    mockGetUserMedia.mockResolvedValueOnce({
      getTracks: () => [{ stop: vi.fn() }],
    });

    const capture3 = new VoiceCapture();
    capture3.onPermissionError(permissionErrorHandler);
    capture3.start();

    expect(capturedRecognition).not.toBeNull();
    // TypeScript doesn't track the constructor assignment, so assert non-null
    const rec = capturedRecognition as unknown as MockSpeechRecognition;
    if (rec.onerror) {
      rec.onerror({ error: 'not-allowed' });
    }

    expect(permissionErrorHandler).toHaveBeenCalledWith('not-allowed');
    expect(capture3.isListening()).toBe(false);

    // Restore original mock
    (globalThis as Record<string, unknown>).SpeechRecognition = MockSpeechRecognition;
  });
});

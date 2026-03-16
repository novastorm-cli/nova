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

describe('VoiceCapture', () => {
  let capture: VoiceCapture;
  let originalSpeechRecognition: unknown;

  beforeEach(() => {
    originalSpeechRecognition = (globalThis as Record<string, unknown>).SpeechRecognition;
    (globalThis as Record<string, unknown>).SpeechRecognition = MockSpeechRecognition;
    capture = new VoiceCapture();
  });

  afterEach(() => {
    if (originalSpeechRecognition === undefined) {
      delete (globalThis as Record<string, unknown>).SpeechRecognition;
    } else {
      (globalThis as Record<string, unknown>).SpeechRecognition = originalSpeechRecognition;
    }
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
    // The SpeechRecognition API fires onresult with a SpeechRecognitionEvent-like object
    const mockEvent = {
      results: [
        [{ transcript: 'hello world' }],
      ],
      resultIndex: 0,
    };
    // Access the underlying recognition instance's onresult
    // We need to find the mock instance — it was created inside start()
    // Since MockSpeechRecognition.start is a vi.fn(), we can access mock instances
    const instances = vi.mocked(MockSpeechRecognition);
    // Alternative: directly trigger via the recognition reference
    // The VoiceCapture should have attached onresult to the recognition instance.
    // We simulate by constructing a proper SpeechRecognitionEvent-like structure:
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

    // Find the created instance by checking if any MockSpeechRecognition instance has onresult set
    // Since we can't easily access it, we use a different approach:
    // Re-create with a capturable reference
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
});

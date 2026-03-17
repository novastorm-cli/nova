import type { IVoiceCapture } from '../contracts/ICapture.js';

type TranscriptResult = { text: string; isFinal: boolean };

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  const win = window as unknown as Record<string, unknown>;
  return (
    (win['SpeechRecognition'] as SpeechRecognitionConstructor | undefined) ??
    (win['webkitSpeechRecognition'] as SpeechRecognitionConstructor | undefined) ??
    null
  );
}

export class VoiceCapture implements IVoiceCapture {
  private recognition: SpeechRecognition | null = null;
  private listening = false;
  private handlers: Array<(result: TranscriptResult) => void> = [];
  private autoRestart = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private lang = '';

  /**
   * Set the recognition language.
   * Examples: 'en-US', 'ru-RU', 'de-DE', 'ja-JP'
   * Empty string = use navigator.language
   */
  setLanguage(lang: string): void {
    this.lang = lang;
    // Fully restart with new language
    if (this.recognition) {
      this.forceStop();
      this.start();
    }
  }

  getLanguage(): string {
    return this.lang;
  }

  start(): void {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    // Clean up any existing recognition
    this.forceStop();

    this.autoRestart = true;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;

    // Resolve language: explicit > navigator.language > 'en-US'
    const resolvedLang = this.lang || navigator.language || 'en-US';
    recognition.lang = resolvedLang;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        const isFinal = result.isFinal;
        this.emit({ text, isFinal });
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.autoRestart = false;
        this.listening = false;
      }
      // 'no-speech', 'aborted', 'network' → onend will handle restart
    };

    recognition.onend = () => {
      this.listening = false;

      if (this.autoRestart) {
        // Restart after a pause — gives browser time to release mic
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          if (this.autoRestart) {
            this.start();
          }
        }, 500);
      }
    };

    this.recognition = recognition;

    try {
      recognition.start();
      this.listening = true;
    } catch {
      // start() can throw if called too rapidly
      this.listening = false;
    }
  }

  stop(): void {
    this.autoRestart = false;
    this.forceStop();
  }

  private forceStop(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // ignore
      }
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onend = null;
      this.recognition = null;
    }
    this.listening = false;
  }

  isListening(): boolean {
    return this.listening;
  }

  onTranscript(handler: (result: TranscriptResult) => void): void {
    this.handlers.push(handler);
  }

  private emit(result: TranscriptResult): void {
    for (const handler of this.handlers) {
      handler(result);
    }
  }
}

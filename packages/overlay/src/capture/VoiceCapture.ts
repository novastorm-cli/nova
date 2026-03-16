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
  private autoRestart = true;
  private lastStartTime = 0;
  private rapidFailCount = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    if (this.listening) return;

    this.autoRestart = true;
    this.rapidFailCount = 0;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

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
        this.emit({ text: '', isFinal: true }); // signal to UI that voice failed
      }
      // For 'no-speech' and 'aborted', let onend handle auto-restart
    };

    recognition.onend = () => {
      const wasListening = this.listening;
      this.listening = false;

      if (this.autoRestart && wasListening) {
        const elapsed = Date.now() - this.lastStartTime;
        if (elapsed < 100) {
          this.rapidFailCount++;
          if (this.rapidFailCount >= 3) {
            this.autoRestart = false;
            return;
          }
        } else {
          this.rapidFailCount = 0;
        }

        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          if (this.autoRestart) {
            this.doStart();
          }
        }, 300);
      }
    };

    this.recognition = recognition;
    this.doStart();
  }

  stop(): void {
    this.autoRestart = false;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.recognition && this.listening) {
      this.recognition.stop();
      this.listening = false;
      this.recognition = null;
    }
  }

  private doStart(): void {
    if (!this.recognition) return;
    this.listening = true;
    this.lastStartTime = Date.now();
    this.recognition.start();
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

import type { IVoiceCapture } from '../contracts/ICapture.js';

type TranscriptResult = { text: string; isFinal: boolean; timestamp: number };

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

/**
 * Compute RMS amplitude from time-domain analyser data.
 * Returns a value in 0.0–1.0 range.
 */
function computeRms(analyser: AnalyserNode, dataArray: Uint8Array): number {
  analyser.getByteTimeDomainData(dataArray as Uint8Array<ArrayBuffer>);
  let sumSquares = 0;
  for (let i = 0; i < dataArray.length; i++) {
    // Convert unsigned byte 0–255 to signed float -1.0 to 1.0
    const normalized = (dataArray[i] - 128) / 128;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / dataArray.length);
}

export class VoiceCapture implements IVoiceCapture {
  private recognition: SpeechRecognition | null = null;
  private listening = false;
  private transcriptHandlers: Array<(result: TranscriptResult) => void> = [];
  private amplitudeHandlers: Array<(level: number) => void> = [];
  private permissionErrorHandlers: Array<(error: string) => void> = [];
  private autoRestart = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private lang = '';

  // Web Audio state
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private dataArray: Uint8Array | null = null;
  private animFrameId: number | null = null;

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
    // Clean up any existing recognition and audio
    this.forceStop();

    this.autoRestart = true;

    // Start audio capture for amplitude analysis (fire-and-forget)
    void this.startAudioCapture();

    // Start speech recognition
    this.startRecognition();
  }

  stop(): void {
    this.autoRestart = false;
    this.forceStop();
  }

  /**
   * Start microphone audio capture via getUserMedia + AnalyserNode.
   * Emits amplitude values to onAmplitude handlers on each animation frame.
   * Emits permission errors to onPermissionError handlers.
   */
  private async startAudioCapture(): Promise<void> {
    // Only attempt if getUserMedia is available
    if (!navigator.mediaDevices?.getUserMedia) return;

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      source.connect(this.analyser);
      // Note: analyser intentionally not connected to destination (no echo)

      this.startAmplitudeLoop();
    } catch (err: unknown) {
      this.stopAudioCapture();

      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          for (const handler of this.permissionErrorHandlers) {
            handler(err.name);
          }
          // Stop the overall recording since we can't get audio
          this.autoRestart = false;
          if (this.recognition) {
            try {
              this.recognition.abort();
            } catch {
              // ignore
            }
          }
          this.listening = false;
          return;
        }
      }

      // Other errors (NotFoundError, NotReadableError) — log but don't block
      // Audio capture failure is non-fatal; speech recognition may still work
    }
  }

  /**
   * Start the rAF loop that computes amplitude from the analyser node.
   */
  private startAmplitudeLoop(): void {
    if (!this.analyser || !this.dataArray) return;

    const analyser = this.analyser;
    const dataArray = this.dataArray;

    const loop = (): void => {
      if (!this.listening || this.analyser !== analyser) return;

      const rms = computeRms(analyser, dataArray);
      for (const handler of this.amplitudeHandlers) {
        handler(rms);
      }

      this.animFrameId = requestAnimationFrame(loop);
    };

    this.animFrameId = requestAnimationFrame(loop);
  }

  /**
   * Stop audio capture and clean up Web Audio resources.
   */
  private stopAudioCapture(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        track.stop();
      }
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {
        // ignore close errors
      });
      this.audioContext = null;
    }

    this.analyser = null;
    this.dataArray = null;
  }

  /**
   * Start speech recognition.
   */
  private startRecognition(): void {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

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
        this.emitTranscript({ text, isFinal, timestamp: Date.now() });
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.autoRestart = false;
        this.listening = false;
        for (const handler of this.permissionErrorHandlers) {
          handler(event.error);
        }
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

    this.stopAudioCapture();

    this.listening = false;
  }

  isListening(): boolean {
    return this.listening;
  }

  onTranscript(handler: (result: TranscriptResult) => void): void {
    this.transcriptHandlers.push(handler);
  }

  onAmplitude(handler: (level: number) => void): void {
    this.amplitudeHandlers.push(handler);
  }

  onPermissionError(handler: (error: string) => void): void {
    this.permissionErrorHandlers.push(handler);
  }

  private emitTranscript(result: TranscriptResult): void {
    for (const handler of this.transcriptHandlers) {
      handler(result);
    }
  }
}

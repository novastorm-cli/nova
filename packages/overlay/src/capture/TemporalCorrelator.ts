import type { ICursorTracker, IDomCapture } from '../contracts/ICapture.js';
import type { GestureRecognizer } from './GestureRecognizer.js';
import type { Gesture, GestureContext } from './GestureTypes.js';
import { buildGestureElement } from './gestureUtils.js';

const DEICTIC_WORDS = new Set(['this', 'that', 'here', 'there', 'these', 'those']);

const TIME_WINDOW_MS = 200;
const MAX_SUMMARY_LENGTH = 800;
const MAX_GESTURES = 3;
const DEFAULT_DURATION_MS = 500;

interface TranscriptEntry {
  text: string;
  isFinal: boolean;
  timestamp: number;
}

export class TemporalCorrelator {
  private tracker: ICursorTracker;
  private gestureRecognizer: GestureRecognizer;
  private domCapture: IDomCapture;
  private transcripts: TranscriptEntry[] = [];

  constructor(
    tracker: ICursorTracker,
    gestureRecognizer: GestureRecognizer,
    domCapture: IDomCapture,
  ) {
    this.tracker = tracker;
    this.gestureRecognizer = gestureRecognizer;
    this.domCapture = domCapture;
  }

  addTranscript(result: { text: string; isFinal: boolean; timestamp: number }): void {
    this.transcripts.push({
      text: result.text,
      isFinal: result.isFinal,
      timestamp: result.timestamp,
    });
  }

  resolve(): GestureContext {
    const recognizedGestures = this.gestureRecognizer.recognize();
    const deicticGestures = this.resolveDeicticReferences();

    // Merge gesture lists, deduplicate by time overlap
    const allGestures = [...recognizedGestures];
    for (const dg of deicticGestures) {
      const isDuplicate = allGestures.some(
        (g) => Math.abs(g.startTime - dg.startTime) < TIME_WINDOW_MS * 2,
      );
      if (!isDuplicate) {
        allGestures.push(dg);
      }
    }

    // Sort by endTime, take most recent
    allGestures.sort((a, b) => b.endTime - a.endTime);
    const gestures = allGestures.slice(0, MAX_GESTURES);

    const summary = this.generateSummary(gestures);

    return { gestures, summary };
  }

  clear(): void {
    this.transcripts = [];
  }

  private resolveDeicticReferences(): Gesture[] {
    const gestures: Gesture[] = [];

    for (let i = 0; i < this.transcripts.length; i++) {
      const entry = this.transcripts[i]!;
      const words = entry.text.split(/\s+/);

      // Estimate duration from gap to next transcript
      const nextTs =
        i + 1 < this.transcripts.length
          ? this.transcripts[i + 1]!.timestamp
          : entry.timestamp + DEFAULT_DURATION_MS;
      const duration = Math.max(nextTs - entry.timestamp, DEFAULT_DURATION_MS);

      for (let wIdx = 0; wIdx < words.length; wIdx++) {
        const word = words[wIdx]!.toLowerCase().replace(/[.,!?;:]/g, '');
        if (!DEICTIC_WORDS.has(word)) continue;

        // Interpolate word timestamp within transcript
        const wordTs = entry.timestamp + (wIdx / Math.max(words.length, 1)) * duration;

        // Find element under cursor at wordTs +/- window
        let element = this.tracker.getElementAtTime(wordTs);

        if (!element) {
          // Try nearby timestamps
          element =
            this.tracker.getElementAtTime(wordTs - TIME_WINDOW_MS) ??
            this.tracker.getElementAtTime(wordTs + TIME_WINDOW_MS);
        }

        if (!element) {
          // Find element with maximum dwell in the window
          element = this.findMaxDwellElement(wordTs - TIME_WINDOW_MS, wordTs + TIME_WINDOW_MS);
        }

        if (element) {
          const gestureElement = buildGestureElement(element, 'source', this.domCapture);
          gestures.push({
            type: 'dwell',
            startTime: wordTs - TIME_WINDOW_MS,
            endTime: wordTs + TIME_WINDOW_MS,
            elements: [gestureElement],
          });
        }
      }
    }

    return gestures;
  }

  private findMaxDwellElement(startTs: number, endTs: number): Element | null {
    const trail = this.tracker.getTrail();
    const elementDwellTime = new Map<Element, number>();

    let prevTs = startTs;
    for (const point of trail) {
      if (point.timestamp < startTs) continue;
      if (point.timestamp > endTs) break;

      const el = this.tracker.getElementAtTime(point.timestamp);
      if (el) {
        const dt = point.timestamp - prevTs;
        elementDwellTime.set(el, (elementDwellTime.get(el) ?? 0) + dt);
      }
      prevTs = point.timestamp;
    }

    let maxElement: Element | null = null;
    let maxTime = 0;
    for (const [el, time] of elementDwellTime) {
      if (time > maxTime) {
        maxTime = time;
        maxElement = el;
      }
    }

    return maxElement;
  }

  private generateSummary(gestures: Gesture[]): string {
    if (gestures.length === 0) return '';

    const parts: string[] = [];

    for (const gesture of gestures) {
      const duration = ((gesture.endTime - gesture.startTime) / 1000).toFixed(1);

      switch (gesture.type) {
        case 'dwell': {
          const el = gesture.elements[0];
          if (el) {
            parts.push(
              `User pointed at <${el.tagName}${el.selector !== el.tagName ? ` (${el.selector})` : ''}> for ${duration}s`,
            );
          }
          break;
        }
        case 'circle': {
          const el = gesture.elements[0];
          if (el) {
            parts.push(
              `User circled around <${el.tagName}${el.selector !== el.tagName ? ` (${el.selector})` : ''}> area`,
            );
          }
          break;
        }
        case 'path': {
          const src = gesture.elements.find((e) => e.role === 'source');
          const tgt = gesture.elements.find((e) => e.role === 'target');
          if (src && tgt) {
            parts.push(
              `User moved cursor from <${src.tagName}> to <${tgt.tagName}> (${duration}s)`,
            );
          }
          break;
        }
      }
    }

    // Add transcript context
    const finalTranscripts = this.transcripts
      .filter((t) => t.isFinal)
      .map((t) => t.text.trim())
      .filter((t) => t.length > 0);

    if (finalTranscripts.length > 0) {
      parts.push(`Speech: "${finalTranscripts.join(' ')}"`);
    }

    let summary = parts.join('; ');
    if (summary.length > MAX_SUMMARY_LENGTH) {
      summary = summary.slice(0, MAX_SUMMARY_LENGTH);
    }

    return summary;
  }
}

import type { EventBus } from '../models/events.js';
import { BehaviorTracker } from './BehaviorTracker.js';
import { PatternDetector } from './PatternDetector.js';
import { SuggestionGenerator } from './SuggestionGenerator.js';
import { SuggestionStore } from './SuggestionStore.js';

export interface PassiveEngineConfig {
  enabled: boolean;
  analyzeIntervalMs: number;
}

export class PassiveEngine {
  private readonly tracker: BehaviorTracker;
  private readonly detector: PatternDetector;
  private readonly generator: SuggestionGenerator;
  private readonly store: SuggestionStore;
  private readonly bus: EventBus;
  private readonly config: PassiveEngineConfig;

  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private behaviorHandler: ((event: { type: 'passive_behavior'; data: import('../models/types.js').BehaviorEvent }) => void) | null = null;
  private responseHandler: ((event: { type: 'suggestion_response'; data: { suggestionId: string; approved: boolean } }) => void) | null = null;

  constructor(bus: EventBus, novaPath: string, config: PassiveEngineConfig) {
    this.bus = bus;
    this.config = config;
    this.tracker = new BehaviorTracker();
    this.detector = new PatternDetector();
    this.generator = new SuggestionGenerator();
    this.store = new SuggestionStore(novaPath);
  }

  start(): void {
    if (!this.config.enabled) return;

    this.behaviorHandler = (event) => {
      this.tracker.track(event.data);
    };
    this.bus.on('passive_behavior', this.behaviorHandler);

    this.responseHandler = (event) => {
      const { suggestionId, approved } = event.data;
      void this.store.update(suggestionId, approved ? 'approved' : 'rejected');
    };
    this.bus.on('suggestion_response', this.responseHandler);

    this.intervalHandle = setInterval(() => {
      void this.analyze();
    }, this.config.analyzeIntervalMs);
  }

  stop(): void {
    if (this.behaviorHandler) {
      this.bus.off('passive_behavior', this.behaviorHandler);
      this.behaviorHandler = null;
    }

    if (this.responseHandler) {
      this.bus.off('suggestion_response', this.responseHandler);
      this.responseHandler = null;
    }

    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async analyze(): Promise<void> {
    const patterns = this.detector.detect(this.tracker);

    for (const pattern of patterns) {
      this.bus.emit({ type: 'passive_pattern', data: pattern });
    }

    const suggestions = this.generator.generate(patterns);

    for (const suggestion of suggestions) {
      await this.store.save(suggestion);
      this.bus.emit({ type: 'passive_suggestion', data: suggestion });
    }
  }

  getTracker(): BehaviorTracker {
    return this.tracker;
  }
}

import { randomUUID } from 'node:crypto';
import type { BehaviorPattern, PassiveSuggestion } from '../models/types.js';

export class SuggestionGenerator {
  generate(patterns: BehaviorPattern[]): PassiveSuggestion[] {
    return patterns.map((pattern) => this.patternToSuggestion(pattern));
  }

  private patternToSuggestion(pattern: BehaviorPattern): PassiveSuggestion {
    switch (pattern.type) {
      case 'frequent_page':
        return this.createSuggestion(pattern, {
          title: 'Frequently visited page detected',
          description: `Noticed you visit ${pattern.metadata['url'] as string} frequently. Consider adding a shortcut/dashboard widget.`,
          taskDescription: `Add quick-access shortcut for ${pattern.metadata['url'] as string}`,
          taskType: 'single_file',
          lane: 1,
        });

      case 'repeated_action':
        return this.createSuggestion(pattern, {
          title: 'Repeated action detected',
          description: `You keep ${pattern.metadata['action'] as string} on "${pattern.metadata['target'] as string}". Want to automate this with a default filter?`,
          taskDescription: `Automate repeated ${pattern.metadata['action'] as string} action on ${pattern.metadata['target'] as string}`,
          taskType: 'single_file',
          lane: 2,
        });

      case 'slow_api':
        return this.createSuggestion(pattern, {
          title: 'Slow API endpoint detected',
          description: `API ${pattern.metadata['endpoint'] as string} is consistently slow. Consider adding caching or pagination.`,
          taskDescription: `Optimize slow API endpoint ${pattern.metadata['endpoint'] as string}`,
          taskType: 'multi_file',
          lane: 3,
        });

      case 'recurring_error':
        return this.createSuggestion(pattern, {
          title: 'Recurring error detected',
          description: `Error "${pattern.metadata['message'] as string}" keeps occurring. Want Nova to investigate and fix?`,
          taskDescription: `Investigate and fix recurring error: ${pattern.metadata['message'] as string}`,
          taskType: 'multi_file',
          lane: 2,
        });

      case 'unused_feature':
        return this.createSuggestion(pattern, {
          title: 'Potentially unused feature',
          description: pattern.description,
          taskDescription: 'Review and clean up unused feature',
          taskType: 'refactor',
          lane: 4,
        });
    }
  }

  private createSuggestion(
    pattern: BehaviorPattern,
    opts: {
      title: string;
      description: string;
      taskDescription: string;
      taskType: 'css' | 'single_file' | 'multi_file' | 'refactor';
      lane: 1 | 2 | 3 | 4;
    },
  ): PassiveSuggestion {
    return {
      id: randomUUID(),
      pattern,
      title: opts.title,
      description: opts.description,
      suggestedTasks: [
        {
          description: opts.taskDescription,
          type: opts.taskType,
          estimatedLane: opts.lane,
        },
      ],
      status: 'pending',
      createdAt: Date.now(),
    };
  }
}

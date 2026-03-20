import { describe, it, expect } from 'vitest';
import { SuggestionGenerator } from '../SuggestionGenerator.js';
import type { BehaviorPattern } from '../../models/types.js';

function createPattern(overrides: Partial<BehaviorPattern> = {}): BehaviorPattern {
  return {
    id: 'test-pattern-id',
    type: 'frequent_page',
    description: 'Test pattern',
    confidence: 0.8,
    occurrences: 5,
    firstSeen: 1000,
    lastSeen: 2000,
    metadata: { url: '/dashboard' },
    ...overrides,
  };
}

describe('SuggestionGenerator', () => {
  const generator = new SuggestionGenerator();

  it('should generate suggestion for frequent_page pattern', () => {
    const pattern = createPattern({
      type: 'frequent_page',
      metadata: { url: '/dashboard' },
    });

    const suggestions = generator.generate([pattern]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].title).toBe('Frequently visited page detected');
    expect(suggestions[0].description).toContain('/dashboard');
    expect(suggestions[0].status).toBe('pending');
    expect(suggestions[0].suggestedTasks).toHaveLength(1);
    expect(suggestions[0].suggestedTasks[0].type).toBe('single_file');
    expect(suggestions[0].suggestedTasks[0].estimatedLane).toBe(1);
  });

  it('should generate suggestion for repeated_action pattern', () => {
    const pattern = createPattern({
      type: 'repeated_action',
      metadata: { action: 'click', target: '#sort-btn' },
    });

    const suggestions = generator.generate([pattern]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].title).toBe('Repeated action detected');
    expect(suggestions[0].description).toContain('click');
    expect(suggestions[0].description).toContain('#sort-btn');
  });

  it('should generate suggestion for slow_api pattern', () => {
    const pattern = createPattern({
      type: 'slow_api',
      metadata: { endpoint: '/api/users', avgDuration: '3500' },
    });

    const suggestions = generator.generate([pattern]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].title).toBe('Slow API endpoint detected');
    expect(suggestions[0].description).toContain('/api/users');
    expect(suggestions[0].suggestedTasks[0].type).toBe('multi_file');
  });

  it('should generate suggestion for recurring_error pattern', () => {
    const pattern = createPattern({
      type: 'recurring_error',
      metadata: { message: 'TypeError: Cannot read property' },
    });

    const suggestions = generator.generate([pattern]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].title).toBe('Recurring error detected');
    expect(suggestions[0].description).toContain('TypeError');
  });

  it('should generate suggestion for unused_feature pattern', () => {
    const pattern = createPattern({
      type: 'unused_feature',
      description: 'Feature X seems unused',
      metadata: {},
    });

    const suggestions = generator.generate([pattern]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].title).toBe('Potentially unused feature');
    expect(suggestions[0].suggestedTasks[0].type).toBe('refactor');
  });

  it('should generate unique IDs for each suggestion', () => {
    const patterns = [createPattern(), createPattern()];
    const suggestions = generator.generate(patterns);
    expect(suggestions[0].id).not.toBe(suggestions[1].id);
  });

  it('should return empty array for empty input', () => {
    const suggestions = generator.generate([]);
    expect(suggestions).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { NudgeRenderer } from '../NudgeRenderer.js';
import type { NudgeContext } from '@novastorm-ai/core';

describe('NudgeRenderer', () => {
  const renderer = new NudgeRenderer();

  function makeContext(overrides: Partial<NudgeContext> = {}): NudgeContext {
    return {
      level: 0,
      devCount: 5,
      tier: 'company',
      hasLicense: false,
      ...overrides,
    };
  }

  it('should return null for nudge level 0', () => {
    const result = renderer.render(makeContext({ level: 0 }));
    expect(result).toBeNull();
  });

  it('should return informational message for nudge level 1', () => {
    const result = renderer.render(makeContext({ level: 1 }));

    expect(result).not.toBeNull();
    expect(result).toContain('free for teams of 3 or fewer');
    expect(result).toContain('https://nova-architect.dev/pricing');
  });

  it('should return warning with devCount for nudge level 2', () => {
    const result = renderer.render(makeContext({ level: 2, devCount: 7 }));

    expect(result).not.toBeNull();
    expect(result).toContain('7 developers');
    expect(result).toContain('https://nova-architect.dev/pricing');
  });

  it('should return box format for nudge level 3', () => {
    const result = renderer.render(makeContext({ level: 3, devCount: 12 }));

    expect(result).not.toBeNull();
    expect(result).toContain('License Required');
    expect(result).toContain('12');
    expect(result).toContain('commercial license');
    expect(result).toContain('https://nova-architect.dev/pricing');
  });

  it('should pad devCount in level 3 box', () => {
    const result = renderer.render(makeContext({ level: 3, devCount: 5 }));

    expect(result).not.toBeNull();
    expect(result).toContain('5  ');
  });

  it('should return null for unknown nudge level', () => {
    const result = renderer.render(makeContext({ level: 99 as NudgeContext['level'] }));
    expect(result).toBeNull();
  });
});

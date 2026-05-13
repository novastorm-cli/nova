import { describe, it, expect } from 'vitest';
import { BRAND, DEPRECATION } from '../strings.js';

describe('Brand strings', () => {
  it('product name is Novastorm', () => {
    expect(BRAND.product).toBe('Novastorm');
  });

  it('product name does not contain Nova Architect', () => {
    expect(BRAND.product).not.toBe('Nova Architect');
    expect(BRAND.product).not.toContain('Architect');
  });

  it('URL is set', () => {
    expect(BRAND.url).toBe('https://cli.novastorm.ai');
  });
});

describe('Deprecation strings', () => {
  it('chat deprecation message uses "gone in v1.0" and "instead"', () => {
    const msg = DEPRECATION.removedCommands.chat;
    expect(msg).toContain('gone in v1.0');
    expect(msg).toContain('instead');
    expect(msg).toContain('interactive chat');
  });

  it('tasks deprecation message uses "gone in v1.0" and "instead"', () => {
    const msg = DEPRECATION.removedCommands.tasks;
    expect(msg).toContain('gone in v1.0');
    expect(msg).toContain('instead');
    expect(msg).toContain('overlay');
  });

  it('watch deprecation message uses "gone in v1.0" and "instead"', () => {
    const msg = DEPRECATION.removedCommands.watch;
    expect(msg).toContain('gone in v1.0');
    expect(msg).toContain('instead');
    expect(msg).toContain('nova start');
  });

  it('review deprecation message uses "gone in v1.0" and "instead"', () => {
    const msg = DEPRECATION.removedCommands.review;
    expect(msg).toContain('gone in v1.0');
    expect(msg).toContain('instead');
    expect(msg).toContain('code review');
  });

  it('models.fast deprecation warning contains removal version', () => {
    const msg = DEPRECATION.modelsFastWarning;
    expect(msg).toContain('fast');
    expect(msg).toContain('standard');
    expect(msg).toContain('v2.0');
    expect(msg).toContain('deprecated');
  });

  it('all removed command messages are distinct', () => {
    const msgs = new Set(Object.values(DEPRECATION.removedCommands));
    expect(msgs.size).toBe(4);
  });
});

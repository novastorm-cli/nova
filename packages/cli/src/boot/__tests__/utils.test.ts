import { describe, it, expect } from 'vitest';
import { isNonInteractive } from '../utils.js';

describe('isNonInteractive', () => {
  it('returns true when NOVA_NON_INTERACTIVE=1', () => {
    process.env['NOVA_NON_INTERACTIVE'] = '1';
    expect(isNonInteractive({})).toBe(true);
    delete process.env['NOVA_NON_INTERACTIVE'];
  });

  it('returns true when --yes is set', () => {
    expect(isNonInteractive({ yes: true })).toBe(true);
  });

  it('returns false when neither is set', () => {
    expect(isNonInteractive({})).toBe(false);
  });

  it('returns false when --yes is explicitly false', () => {
    expect(isNonInteractive({ yes: false })).toBe(false);
  });
});

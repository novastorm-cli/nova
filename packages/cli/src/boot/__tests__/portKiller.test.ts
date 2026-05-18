import { describe, it, expect } from 'vitest';
import { killPort } from '../PortKiller.js';

describe('PortKiller', () => {
  it('returns empty result when port is free', async () => {
    const result = await killPort(35999);
    expect(result).toEqual({ pids: [], skipped: [] });
  });

  it('result has expected shape', async () => {
    const result = await killPort(35998);
    expect(result).toHaveProperty('pids');
    expect(result).toHaveProperty('skipped');
    expect(Array.isArray(result.pids)).toBe(true);
    expect(Array.isArray(result.skipped)).toBe(true);
  });

  it('completes quickly for free ports', async () => {
    const start = Date.now();
    await killPort(35997);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  it('returns empty for multiple free ports', async () => {
    const ports = [35996, 35995, 35994];
    for (const port of ports) {
      const result = await killPort(port);
      expect(result.pids).toEqual([]);
    }
  });

  it('handles edge case ports gracefully', async () => {
    // These should not throw
    const r1 = await killPort(-1);
    const r2 = await killPort(0);
    expect(r1.pids).toEqual([]);
    expect(r2.pids).toEqual([]);
  });

  it('returns empty result for high ports', async () => {
    const result = await killPort(49152);
    expect(result.pids).toEqual([]);
  });

  it('consistent shape across calls', async () => {
    const r1 = await killPort(35993);
    const r2 = await killPort(35992);
    expect(r1).toEqual(r2);
  });
});

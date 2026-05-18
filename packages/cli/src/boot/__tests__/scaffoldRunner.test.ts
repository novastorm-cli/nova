import { describe, it, expect } from 'vitest';
import { runScaffold } from '../ScaffoldRunner.js';

describe('ScaffoldRunner', () => {
  it('is a function', () => {
    expect(typeof runScaffold).toBe('function');
  });

  it('returns null when devCommand is already known', async () => {
    const result = await runScaffold(
      process.cwd(),
      { project: { devCommand: '', port: 0, frontend: undefined, backends: [] } } as any,
      {},
      'npm run dev',
      3000,
    );
    expect(result).toBeNull();
  });

  it('accepts the expected number of parameters', () => {
    expect(runScaffold.length).toBe(5);
  });
});

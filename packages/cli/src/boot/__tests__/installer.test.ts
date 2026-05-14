import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureDependencies } from '../Installer.js';

describe('Installer.ensureDependencies', () => {
  const mockStack = {
    framework: 'next.js',
    language: 'typescript',
    packageManager: 'npm',
    typescript: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is a function', () => {
    expect(typeof ensureDependencies).toBe('function');
  });

  it('accepts expected parameters', async () => {
    // Verify the function signature is correct by checking it exists
    // and has the expected number of parameters (via length)
    expect(ensureDependencies.length).toBe(4); // (cwd, stack, options, llmClient)
  });

  it('does not throw when called with non-Node framework', async () => {
    // For non-Node frameworks, ensureDependencies should be a no-op
    const nonNodeStack = { ...mockStack, framework: 'flask' };
    // Should not throw even without node_modules
    await expect(
      ensureDependencies('/tmp/nonexistent', nonNodeStack, {}, null),
    ).resolves.toBeUndefined();
  });
});

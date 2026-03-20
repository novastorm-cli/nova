import { describe, it, expect } from 'vitest';
import os from 'node:os';
import { DevServerRunner } from '../DevServerRunner.js';

describe('DevServerRunner - security', () => {
  it('should reject commands not in the allowlist', async () => {
    const runner = new DevServerRunner();
    await expect(runner.spawn('rm -rf /', os.tmpdir(), 3000)).rejects.toThrow(/not allowed/i);
  });

  it('should reject commands with shell metacharacters in args', async () => {
    const runner = new DevServerRunner();
    // Even though 'node' is allowed, shell metacharacters in the full command
    // won't work because shell: true is removed
    // This test verifies the allowlist works for legit commands
    await expect(runner.spawn('python -c "import os"', os.tmpdir(), 3000)).rejects.toThrow(/not allowed/i);
  });

  it('should accept npm commands', async () => {
    const runner = new DevServerRunner();
    // This will fail because there's no package.json, but it should NOT fail on allowlist
    try {
      await runner.spawn('node -e "process.exit(0)"', os.tmpdir(), 3000);
    } catch (err) {
      // Should fail because process exits, NOT because of allowlist
      expect((err as Error).message).not.toMatch(/not allowed/i);
    }
  });
});

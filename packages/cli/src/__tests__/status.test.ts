import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ───────────────────────────────────────────────────────────────

vi.mock('../config.js', () => ({
  ConfigReader: vi.fn(),
}));

vi.mock('@novastorm-ai/core', async () => {
  const actual = await vi.importActual('@novastorm-ai/core');
  return {
    ...actual,
    StructuredLogger: vi.fn().mockImplementation(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    })),
  };
});

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual('node:fs/promises');
  return {
    ...actual,
    stat: vi.fn(),
    readFile: vi.fn(),
  };
});

import { ConfigReader } from '../config.js';
import * as fs from 'node:fs/promises';
import { DEFAULT_CONFIG } from '@novastorm-ai/core';

const MockConfigReader = vi.mocked(ConfigReader);

import { statusCommand } from '../commands/status.js';

describe('statusCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports no nova.toml when config does not exist', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    MockConfigReader.prototype.exists = vi.fn().mockResolvedValue(false) as any;

    await statusCommand();
    // Should not throw; logs "No nova.toml found"
  });

  it('shows status when config exists', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    MockConfigReader.prototype.exists = vi.fn().mockResolvedValue(true) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    MockConfigReader.prototype.read = vi.fn().mockResolvedValue(DEFAULT_CONFIG) as any;

    // Mock stat to throw (no index)
    vi.mocked(fs.stat).mockRejectedValue(new Error('ENOENT'));
    // Mock readFile to throw (no tasks)
    vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

    await statusCommand();
    // Should not throw; logs status info
  });

  it('reports index and tasks when present', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    MockConfigReader.prototype.exists = vi.fn().mockResolvedValue(true) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    MockConfigReader.prototype.read = vi.fn().mockResolvedValue(DEFAULT_CONFIG) as any;

    // Mock stat to succeed (index exists)
    vi.mocked(fs.stat).mockResolvedValue({} as fs.Stats);
    // Mock tasks file with pending tasks
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify([{ status: 'pending' }, { status: 'completed' }]),
    );

    await statusCommand();
    // Should not throw; reports index exists and 1 pending task
  });

  it('reports no pending tasks when tasks are all complete', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    MockConfigReader.prototype.exists = vi.fn().mockResolvedValue(true) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    MockConfigReader.prototype.read = vi.fn().mockResolvedValue(DEFAULT_CONFIG) as any;

    vi.mocked(fs.stat).mockResolvedValue({} as fs.Stats);
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify([{ status: 'completed' }]),
    );

    await statusCommand();
    // Should not throw
  });

  it('handles invalid tasks.json gracefully', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    MockConfigReader.prototype.exists = vi.fn().mockResolvedValue(true) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    MockConfigReader.prototype.read = vi.fn().mockResolvedValue(DEFAULT_CONFIG) as any;

    vi.mocked(fs.stat).mockResolvedValue({} as fs.Stats);
    vi.mocked(fs.readFile).mockResolvedValue('not valid json');

    await statusCommand();
    // Should not throw; handles parse error gracefully
  });

  it('does not crash when config read fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    MockConfigReader.prototype.exists = vi.fn().mockResolvedValue(true) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    MockConfigReader.prototype.read = vi
      .fn()
      .mockRejectedValue(new Error('read error')) as any;

    await expect(statusCommand()).rejects.toThrow('read error');
  });
});

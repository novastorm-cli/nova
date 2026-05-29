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

vi.mock('node:readline/promises', () => ({
  createInterface: vi.fn().mockReturnValue({
    question: vi.fn().mockResolvedValue(''),
    close: vi.fn(),
  }),
}));

import { ConfigReader } from '../config.js';

const MockConfigReader = vi.mocked(ConfigReader);

import { initCommand } from '../commands/init.js';

describe('initCommand', () => {
  let mockExists: ReturnType<typeof vi.fn>;
  let mockWrite: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExists = vi.fn();
    mockWrite = vi.fn().mockResolvedValue(undefined);

    MockConfigReader.prototype.exists = mockExists as any;

    MockConfigReader.prototype.write = mockWrite as any;
  });

  it('reports when nova.toml already exists', async () => {
    mockExists.mockResolvedValue(true);

    await initCommand();
    // Should NOT call write since config already exists
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('creates nova.toml when it does not exist (with mocked readline)', async () => {
    mockExists.mockResolvedValue(false);

    await initCommand();
    // Should call write to create the config
    expect(mockWrite).toHaveBeenCalledTimes(1);
  });
});

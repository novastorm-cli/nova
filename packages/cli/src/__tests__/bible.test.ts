import { describe, it, expect, vi } from 'vitest';

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

import { bibleCommand } from '../commands/bible.js';

describe('bibleCommand', () => {
  it('prints bible text when no subcommand', async () => {
    await bibleCommand();
    // Should not throw
  });

  it('prints bible text with --read flag', async () => {
    await bibleCommand('--read');
    // Should not throw
  });

  it('prints bible text with "read" subcommand', async () => {
    await bibleCommand('read');
    // Should not throw
  });

  it('prints warning for unknown subcommand', async () => {
    await bibleCommand('unknown');
    // Should not throw
  });
});

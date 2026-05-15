import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ILogger } from '@novastorm-ai/core';

vi.mock('open', () => ({ default: vi.fn() }));

import open from 'open';
import { openBrowser } from '../BrowserOpener.js';

const mockOpen = vi.mocked(open);

function mockLogger(): { logger: ILogger; output: () => string } {
  const calls: string[] = [];
  const logger: ILogger = {
    debug: (msg: string) => { calls.push(msg); },
    info: (msg: string) => { calls.push(msg); },
    warn: (msg: string) => { calls.push(msg); },
    error: (msg: string) => { calls.push(msg); },
    child: () => logger,
  };
  return { logger, output: () => calls.join(' ') };
}

describe('BrowserOpener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpen.mockResolvedValue(undefined as any);
  });

  it('calls open() with the URL when noOpen is false', async () => {
    const { logger } = mockLogger();
    await openBrowser('http://localhost:3501', { logger });
    expect(mockOpen).toHaveBeenCalledWith('http://localhost:3501');
  });

  it('skips open() when noOpen is true', async () => {
    const { logger } = mockLogger();
    await openBrowser('http://localhost:3501', { noOpen: true, logger });
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('prints proxy URL even when browser not opened', async () => {
    const { logger, output } = mockLogger();
    await openBrowser('http://localhost:3501', { noOpen: true, logger });
    const text = output();
    expect(text).toContain('http://localhost:3501');
    expect(text).toContain('--no-open');
  });

  it('handles open() rejection gracefully', async () => {
    mockOpen.mockRejectedValue(new Error('No browser found'));
    const { logger, output } = mockLogger();
    await openBrowser('http://localhost:3501', { logger });
    const text = output();
    expect(text).toContain('manually');
  });
});

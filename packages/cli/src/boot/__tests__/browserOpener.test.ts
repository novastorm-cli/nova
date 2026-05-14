import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('open', () => ({ default: vi.fn() }));

import open from 'open';
import { openBrowser } from '../BrowserOpener.js';

const mockOpen = vi.mocked(open);

describe('BrowserOpener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpen.mockResolvedValue(undefined);
  });

  it('calls open() with the URL when noOpen is false', async () => {
    await openBrowser('http://localhost:3501');
    expect(mockOpen).toHaveBeenCalledWith('http://localhost:3501');
  });

  it('skips open() when noOpen is true', async () => {
    await openBrowser('http://localhost:3501', { noOpen: true });
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it('prints proxy URL even when browser not opened', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await openBrowser('http://localhost:3501', { noOpen: true });
    const calls = spy.mock.calls.flat().join(' ');
    expect(calls).toContain('http://localhost:3501');
    expect(calls).toContain('--no-open');
    spy.mockRestore();
  });

  it('handles open() rejection gracefully', async () => {
    mockOpen.mockRejectedValue(new Error('No browser found'));
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await openBrowser('http://localhost:3501');
    const calls = spy.mock.calls.flat().join(' ');
    expect(calls).toContain('manually');
    spy.mockRestore();
  });
});

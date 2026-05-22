import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────

vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  input: vi.fn(),
}));

vi.mock('../boot/PortManager.js', () => ({
  PortManager: {
    killPort: vi.fn().mockResolvedValue(undefined),
    isPortInUse: vi.fn().mockResolvedValue(false),
    findFreePortPair: vi.fn().mockResolvedValue({ devPort: 3001, proxyPort: 3002 }),
  },
}));

// The logger output goes to process.stderr as JSON. We'll spy on that.
// But StructuredLogger is a module-level const, so we spy at the write level.

// ── Helpers ──────────────────────────────────────────────────────────────

interface MockDevServer {
  spawn: ReturnType<typeof vi.fn>;
  getLogs: ReturnType<typeof vi.fn>;
  getActualPort: ReturnType<typeof vi.fn>;
  onReady: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
  onOutput: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  isRunning: ReturnType<typeof vi.fn>;
}

function createMockDevServer(logs: string = ''): MockDevServer {
  return {
    spawn: vi.fn().mockResolvedValue(undefined),
    getLogs: vi.fn().mockReturnValue(logs),
    getActualPort: vi.fn().mockReturnValue(null),
    onReady: vi.fn(),
    onError: vi.fn(),
    onOutput: vi.fn(),
    kill: vi.fn().mockResolvedValue(undefined),
    isRunning: vi.fn().mockReturnValue(false),
  };
}

function createMockAutoFixer() {
  return {
    forceFixNow: vi.fn().mockResolvedValue(undefined),
    handleOutput: vi.fn(),
    isAutofixTask: vi.fn().mockReturnValue(false),
  };
}

/**
 * Parses JSON log lines from stderr writes and returns the message strings
 * filtered by level.
 */
function getAllLoggedMessages(stderrSpy: any): string[] {
  const writes = (stderrSpy.mock.calls as any[]).map((c: any[]) => c[0] as string).join('');
  return writes
    .split('\n')
    .filter((line: string) => line.startsWith('{'))
    .map((line: string) => {
      try {
        return JSON.parse(line) as { level: string; message: string };
      } catch {
        return null;
      }
    })
    .filter((entry: { level: string; message: string } | null): entry is { level: string; message: string } => entry !== null)
    .map((entry: { level: string; message: string }) => entry.message);
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('recoverDevServer', () => {
  let stderrSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    // Capture StructuredLogger output (it writes JSON to stderr)
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultOptions = { port: '3000', noOpen: true } as any;
  const defaultLlClient = { chat: vi.fn() };

  // ------------------------------------------------------------------
  // VAL-ERR-001: Dev server logs shown on failure
  // ------------------------------------------------------------------
  it('shows dev server logs before the interactive prompt', async () => {
    const prompts = await import('@inquirer/prompts');
    vi.mocked(prompts.select).mockResolvedValue('exit');

    const devServer = createMockDevServer('line1\nline2\nerror: port in use\nline3');
    const autoFixer = createMockAutoFixer();

    const { recoverDevServer } = await import('../commands/start.js');

    await expect(
      recoverDevServer(
        new Error('EADDRINUSE: port 3000 already in use'),
        'npm run dev',
        '/test',
        3000,
        defaultOptions,
        defaultLlClient,
        devServer as any,
        autoFixer,
      ),
    ).rejects.toThrow('process.exit');

    // getLogs was called
    expect(devServer.getLogs).toHaveBeenCalled();

    // Collect all log messages
    const messages = getAllLoggedMessages(stderrSpy).join('\n');

    // The log output should contain the dev server log lines
    expect(messages).toContain('line1');
    expect(messages).toContain('line2');
    expect(messages).toContain('error: port in use');
    expect(messages).toContain('line3');
    expect(messages).toContain('Dev server output');

    // The error message should also be shown
    expect(messages).toContain('EADDRINUSE');
  });

  // ------------------------------------------------------------------
  // VAL-ERR-002: Logs truncated at 50 lines
  // ------------------------------------------------------------------
  it('truncates dev server logs to last 50 lines when >50 lines', async () => {
    const prompts = await import('@inquirer/prompts');
    vi.mocked(prompts.select).mockResolvedValue('exit');

    // Generate 200 lines of logs
    const allLines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`);
    const fullLogs = allLines.join('\n');

    const devServer = createMockDevServer(fullLogs);
    const autoFixer = createMockAutoFixer();

    const { recoverDevServer } = await import('../commands/start.js');

    await expect(
      recoverDevServer(
        new Error('Build error'),
        'npm run dev',
        '/test',
        3000,
        defaultOptions,
        defaultLlClient,
        devServer as any,
        autoFixer,
      ),
    ).rejects.toThrow('process.exit');

    const messages = getAllLoggedMessages(stderrSpy).join('\n');

    // Should show truncation notice
    expect(messages).toContain('last 50');
    expect(messages).toContain('200');

    // Should show the last line (line 200)
    expect(messages).toContain('line 200');

    // Should NOT show the first line
    const logBlock = messages.split('Dev server output')[1] ?? '';
    expect(logBlock).not.toContain('line 1\n');
  });

  // ------------------------------------------------------------------
  // VAL-ERR-003: Empty logs handled
  // ------------------------------------------------------------------
  it('handles empty dev server logs without crashing', async () => {
    const prompts = await import('@inquirer/prompts');
    vi.mocked(prompts.select).mockResolvedValue('exit');

    const devServer = createMockDevServer('');
    const autoFixer = createMockAutoFixer();

    const { recoverDevServer } = await import('../commands/start.js');

    await expect(
      recoverDevServer(
        new Error('Build error'),
        'npm run dev',
        '/test',
        3000,
        defaultOptions,
        defaultLlClient,
        devServer as any,
        autoFixer,
      ),
    ).rejects.toThrow('process.exit');

    const messages = getAllLoggedMessages(stderrSpy).join('\n');

    // No "Dev server output:" header for empty logs
    expect(messages).not.toContain('Dev server output');

    // Error message should still be shown
    expect(messages).toContain('Build error');
  });

  // ------------------------------------------------------------------
  // VAL-ERR-010: "AI fix" calls autoFixer.forceFixNow() with error context
  // ------------------------------------------------------------------
  it('AI fix calls autoFixer.forceFixNow() with error and log context', async () => {
    const prompts = await import('@inquirer/prompts');
    vi.mocked(prompts.select)
      .mockResolvedValueOnce('ai-fix')
      .mockResolvedValue('exit');

    const devServer = createMockDevServer('log line A\nlog line B');
    const autoFixer = createMockAutoFixer();
    (autoFixer.forceFixNow as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const { recoverDevServer } = await import('../commands/start.js');

    // Should NOT throw process.exit because ai-fix succeeds and returns
    await recoverDevServer(
      new Error('Module not found: ./missing'),
      'npm run dev',
      '/test',
      3000,
      defaultOptions,
      defaultLlClient,
      devServer as any,
      autoFixer,
    );

    // autoFixer.forceFixNow should have been called once
    expect(autoFixer.forceFixNow).toHaveBeenCalledTimes(1);

    // The argument should contain both error message and log lines
    const fixArg = (autoFixer.forceFixNow as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(fixArg).toContain('Module not found');
    expect(fixArg).toContain('log line A');
    expect(fixArg).toContain('log line B');
    expect(fixArg).toContain('Dev server output');
  });

  // ------------------------------------------------------------------
  // VAL-ERR-011: No "Describe what to fix:" prompt
  // ------------------------------------------------------------------
  it('does not show "Describe what to fix:" input prompt', async () => {
    const prompts = await import('@inquirer/prompts');
    vi.mocked(prompts.select)
      .mockResolvedValueOnce('ai-fix')
      .mockResolvedValue('exit');

    const devServer = createMockDevServer('log output');
    const autoFixer = createMockAutoFixer();
    (autoFixer.forceFixNow as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const { recoverDevServer } = await import('../commands/start.js');

    await recoverDevServer(
      new Error('Build error'),
      'npm run dev',
      '/test',
      3000,
      defaultOptions,
      defaultLlClient,
      devServer as any,
      autoFixer,
    );

    // input() should NOT be called (no "Describe what to fix:" prompt)
    expect(prompts.input).not.toHaveBeenCalled();

    // Confirm no message containing "Describe what to fix" in log output
    const messages = getAllLoggedMessages(stderrSpy).join('\n');
    expect(messages).not.toContain('Describe what to fix');
  });

  // ------------------------------------------------------------------
  // VAL-ERR-012: Graceful fallback when autoFixer is null
  // ------------------------------------------------------------------
  it('falls back gracefully when autoFixer is null and AI fix is selected', async () => {
    const prompts = await import('@inquirer/prompts');
    vi.mocked(prompts.select)
      .mockResolvedValueOnce('ai-fix')
      .mockResolvedValue('exit');

    const devServer = createMockDevServer('some logs');

    const { recoverDevServer } = await import('../commands/start.js');

    await expect(
      recoverDevServer(
        new Error('Build error'),
        'npm run dev',
        '/test',
        3000,
        defaultOptions,
        defaultLlClient,
        devServer as any,
        null, // autoFixer = null
      ),
    ).rejects.toThrow('process.exit');

    const messages = getAllLoggedMessages(stderrSpy).join('\n').toLowerCase();

    // Should show message about autofix being unavailable
    expect(messages).toContain('auto-fix unavailable');
    expect(messages).toContain('no ai configured');
  });

  // ------------------------------------------------------------------
  // VAL-ERR-013: Other recovery options preserved
  // ------------------------------------------------------------------
  it('preserves kill-port recovery option', async () => {
    const prompts = await import('@inquirer/prompts');
    vi.mocked(prompts.select).mockResolvedValue('kill-retry');

    const { PortManager } = await import('../boot/PortManager.js');
    vi.mocked(PortManager.killPort).mockResolvedValue(undefined);

    const devServer = createMockDevServer('');
    const autoFixer = createMockAutoFixer();

    const { recoverDevServer } = await import('../commands/start.js');

    await recoverDevServer(
      new Error('EADDRINUSE: port 3000 already in use'),
      'npm run dev',
      '/test',
      3000,
      defaultOptions,
      defaultLlClient,
      devServer as any,
      autoFixer,
    );

    // killRetry should call PortManager.killPort and then devServer.spawn
    expect(PortManager.killPort).toHaveBeenCalledWith(3000);
    expect(devServer.spawn).toHaveBeenCalledWith('npm run dev', '/test', 3000);
  });

  it('preserves change-port recovery option', async () => {
    const prompts = await import('@inquirer/prompts');
    vi.mocked(prompts.select).mockResolvedValue('change-port');
    vi.mocked(prompts.input).mockResolvedValue('3010');

    const devServer = createMockDevServer('');
    const autoFixer = createMockAutoFixer();

    const { recoverDevServer } = await import('../commands/start.js');

    await recoverDevServer(
      new Error('EADDRINUSE: port 3000 already in use'),
      'npm run dev',
      '/test',
      3000,
      defaultOptions,
      defaultLlClient,
      devServer as any,
      autoFixer,
    );

    // Should prompt for new port
    expect(prompts.input).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Port:', default: '3010' }),
    );
    // Should spawn with new port
    expect(devServer.spawn).toHaveBeenCalledWith('npm run dev', '/test', 3010);
  });

  it('preserves exit option', async () => {
    const prompts = await import('@inquirer/prompts');
    vi.mocked(prompts.select).mockResolvedValue('exit');

    const devServer = createMockDevServer('');
    const autoFixer = createMockAutoFixer();

    const { recoverDevServer } = await import('../commands/start.js');

    await expect(
      recoverDevServer(
        new Error('Build error'),
        'npm run dev',
        '/test',
        3000,
        defaultOptions,
        defaultLlClient,
        devServer as any,
        autoFixer,
      ),
    ).rejects.toThrow('process.exit');

    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  // ------------------------------------------------------------------
  // VAL-ERR-014: AutoFixer result communicated to user
  // ------------------------------------------------------------------
  it('communicates autoFixer success to user with retry message', async () => {
    const prompts = await import('@inquirer/prompts');
    vi.mocked(prompts.select)
      .mockResolvedValueOnce('ai-fix')
      .mockResolvedValue('exit');

    const devServer = createMockDevServer('logs');
    const autoFixer = createMockAutoFixer();
    (autoFixer.forceFixNow as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const { recoverDevServer } = await import('../commands/start.js');

    await recoverDevServer(
      new Error('Build error'),
      'npm run dev',
      '/test',
      3000,
      defaultOptions,
      defaultLlClient,
      devServer as any,
      autoFixer,
    );

    // After successful fix, should show success message and retry
    const messages = getAllLoggedMessages(stderrSpy).join('\n');
    expect(messages).toContain('Auto-fix succeeded');
    expect(messages).toContain('Retrying dev server');

    // Should have retried spawn
    expect(devServer.spawn).toHaveBeenCalledWith('npm run dev', '/test', 3000);
  });

  it('communicates autoFixer failure reason to user', async () => {
    const prompts = await import('@inquirer/prompts');
    vi.mocked(prompts.select)
      .mockResolvedValueOnce('ai-fix')
      .mockResolvedValue('exit');

    const devServer = createMockDevServer('logs');
    const autoFixer = createMockAutoFixer();
    (autoFixer.forceFixNow as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Autofix budget exhausted'),
    );

    const { recoverDevServer } = await import('../commands/start.js');

    await expect(
      recoverDevServer(
        new Error('Build error'),
        'npm run dev',
        '/test',
        3000,
        defaultOptions,
        defaultLlClient,
        devServer as any,
        autoFixer,
      ),
    ).rejects.toThrow('process.exit');

    const messages = getAllLoggedMessages(stderrSpy).join('\n');

    // Should show failure message with reason
    expect(messages).toContain('Auto-fix failed');
    expect(messages).toContain('Autofix budget exhausted');
  });
});

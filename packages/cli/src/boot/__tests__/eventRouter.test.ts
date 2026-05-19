import { describe, it, expect, vi } from 'vitest';
import { setupEventRouting } from '../EventRouter.js';

describe('EventRouter', () => {
  it('is a function', () => {
    expect(typeof setupEventRouting).toBe('function');
  });

  it('accepts expected parameters without throwing', () => {
    const mockWsServer = {
      onObservation: vi.fn(),
      onConfirm: vi.fn(),
      onConfirmTasks: vi.fn(),
      onCancel: vi.fn(),
      onAppend: vi.fn(),
      onSecretsSubmit: vi.fn(),
      onBrowserError: vi.fn(),
      onRevertFile: vi.fn(),
      sendEvent: vi.fn(),
    };

    const mockEventBus = {
      on: vi.fn(),
      emit: vi.fn(),
    };

    const deps = {
      wsServer: mockWsServer as any,
      eventBus: mockEventBus as any,
      brain: null,
      llmClient: null,
      config: { behavior: { confirmTasks: true }, project: { port: 3000 } } as any,
      options: {} as any,
      gitManager: { getLog: vi.fn().mockResolvedValue([]), rollback: vi.fn() } as any,
      executorPool: null,
      commitQueue: {} as any,
      autoFixer: null,
      devServer: { getLogs: vi.fn().mockReturnValue(''), onError: vi.fn() } as any,
      logger: {
        logObservation: vi.fn(),
        logAnalyzing: vi.fn(),
        logTasks: vi.fn(),
        logTaskStarted: vi.fn(),
        logTaskCompleted: vi.fn(),
        logTaskFailed: vi.fn(),
        logFileChanged: vi.fn(),
      } as any,
      projectMap: { stack: { framework: 'next.js', language: 'typescript' } } as any,
      taskMap: new Map(),
      pendingTasks: [],
      lastObservation: { current: null },
    };

    expect(() => setupEventRouting(deps)).not.toThrow();

    // Verify the event wiring was set up
    expect(mockEventBus.on).toHaveBeenCalledWith('observation', expect.any(Function));
    expect(mockEventBus.on).toHaveBeenCalledWith('task_created', expect.any(Function));
    expect(mockEventBus.on).toHaveBeenCalledWith('task_started', expect.any(Function));
    expect(mockEventBus.on).toHaveBeenCalledWith('task_completed', expect.any(Function));
    expect(mockEventBus.on).toHaveBeenCalledWith('task_failed', expect.any(Function));
    expect(mockEventBus.on).toHaveBeenCalledWith('file_changed', expect.any(Function));
    expect(mockEventBus.on).toHaveBeenCalledWith('llm_chunk', expect.any(Function));
    expect(mockEventBus.on).toHaveBeenCalledWith('secrets_required', expect.any(Function));
    expect(mockEventBus.on).toHaveBeenCalledWith('status', expect.any(Function));

    // Verify WS callbacks were registered
    expect(mockWsServer.onObservation).toHaveBeenCalled();
    expect(mockWsServer.onConfirm).toHaveBeenCalled();
    expect(mockWsServer.onConfirmTasks).toHaveBeenCalled();
    expect(mockWsServer.onCancel).toHaveBeenCalled();
    expect(mockWsServer.onAppend).toHaveBeenCalled();
    expect(mockWsServer.onSecretsSubmit).toHaveBeenCalled();
    expect(mockWsServer.onBrowserError).toHaveBeenCalled();
    expect(mockWsServer.onRevertFile).toHaveBeenCalled();
  });
});

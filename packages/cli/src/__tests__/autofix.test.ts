import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ErrorAutoFixer } from '../autofix.js';
import type {
  LlmClient,
  IGitManager,
  EventBus,
  ILogger,
  ProjectMap,
  ChatResponse,
  Message,
  LlmOptions,
  MiniContext,
  StackInfo,
} from '@novastorm-ai/core';
import type { WebSocketServer } from '@novastorm-ai/proxy';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_FILE_CONTENT =
  'const x = 1;\nexport default function Page() { return <div>Hello</div>; }\n';

function validDiff(): string {
  return (
    '--- a/src/page.tsx\n' +
    '+++ b/src/page.tsx\n' +
    '@@ -1,3 +1,3 @@\n' +
    '-const x = 1\n' +
    '+const x: number = 1\n' +
    ' export default function Page() { return <div>Hello</div>; }\n'
  );
}

function invalidDiff(): string {
  return 'this is not a valid diff at all';
}

function createMockLlmClient(responses: string[] = [validDiff()]): LlmClient {
  let callIndex = 0;
  return {
    chat: vi.fn(async (_messages: Message[], _options?: LlmOptions): Promise<ChatResponse> => {
      const content = responses[callIndex] ?? responses[responses.length - 1]!;
      callIndex++;
      return { content };
    }),
    chatWithVision: vi.fn(async (): Promise<ChatResponse> => {
      throw new Error('vision not supported in mock');
    }),
    stream: vi.fn(async function* () {}),
  } as LlmClient;
}

function createFailingLlmClient(failureCount: number = 3): LlmClient {
  let callIndex = 0;
  return {
    chat: vi.fn(async (_messages: Message[], _options?: LlmOptions): Promise<ChatResponse> => {
      callIndex++;
      if (callIndex <= failureCount) {
        return { content: invalidDiff() };
      }
      return { content: validDiff() };
    }),
    chatWithVision: vi.fn(async (): Promise<ChatResponse> => {
      throw new Error('vision not supported in mock');
    }),
    stream: vi.fn(async function* () {}),
  } as LlmClient;
}

function createMockGitManager(): IGitManager {
  return {
    isGitRepo: vi.fn(() => true),
    getCurrentBranch: vi.fn(() => 'nova/autofix-test'),
    createBranch: vi.fn(() => 'nova/test-branch'),
    checkoutBranch: vi.fn(),
    stageFiles: vi.fn(),
    commit: vi.fn(() => 'abc1234567890'),
    getDiff: vi.fn(() => ''),
    push: vi.fn(),
    pull: vi.fn(),
    merge: vi.fn(),
    getCommitHistory: vi.fn(() => []),
    getStatus: vi.fn(() => ({ staged: [], unstaged: [], untracked: [] })),
    branchExists: vi.fn(() => false),
    deleteBranch: vi.fn(),
    getFileHistory: vi.fn(() => []),
  } as unknown as IGitManager;
}

function createMockEventBus(): EventBus {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    removeAllListeners: vi.fn(),
  } as unknown as EventBus;
}

function createMockWsServer(): WebSocketServer {
  return {
    sendEvent: vi.fn(),
    onConfirm: vi.fn(),
    onSecretsSubmit: vi.fn(),
    close: vi.fn(),
  } as unknown as WebSocketServer;
}

function createMockProjectMap(files?: Record<string, string>): ProjectMap {
  const stack: StackInfo = {
    framework: 'nextjs',
    language: 'typescript',
    packageManager: 'pnpm',
    typescript: true,
  };
  const fileContexts = new Map<string, MiniContext>();
  if (files) {
    for (const [p, content] of Object.entries(files)) {
      fileContexts.set(p, { filePath: p, content, importedTypes: '' });
    }
  } else {
    fileContexts.set('src/page.tsx', {
      filePath: 'src/page.tsx',
      content: DEFAULT_FILE_CONTENT,
      importedTypes: '',
    });
  }
  return {
    stack,
    devCommand: 'pnpm dev',
    port: 3500,
    routes: [],
    components: [],
    endpoints: [],
    models: [],
    dependencies: new Map(),
    fileContexts,
    compressedContext: '',
  };
}

function createMockLogger(): ILogger & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    debug: vi.fn((msg: string) => {
      messages.push('DEBUG: ' + msg);
    }),
    info: vi.fn((msg: string) => {
      messages.push('INFO: ' + msg);
    }),
    warn: vi.fn((msg: string) => {
      messages.push('WARN: ' + msg);
    }),
    error: vi.fn((msg: string, ctx?: Record<string, unknown>) => {
      messages.push('ERROR: ' + msg + (ctx ? ' ' + JSON.stringify(ctx) : ''));
    }),
    child: vi.fn(() => createMockLogger()),
  };
}

function setupTempDir(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-autofix-test-'));
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'page.tsx'), DEFAULT_FILE_CONTENT);
  return tmpDir;
}

function cleanupTempDir(tmpDir: string): void {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ErrorAutoFixer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = setupTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tmpDir);
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Retry counter and budget exhaustion
  // -----------------------------------------------------------------------

  it('retries up to MAX_AUTOFIX_ATTEMPTS when diff fails to apply', async () => {
    const failingLlm = createFailingLlmClient(3);
    const logger = createMockLogger();

    const autofix = new ErrorAutoFixer(
      tmpDir,
      failingLlm,
      createMockGitManager(),
      createMockEventBus(),
      createMockWsServer(),
      createMockProjectMap(),
      undefined,
      'test-model',
      logger,
    );

    const errorOutput = "Module not found: Can't resolve './missing' in ./src/page.tsx:5:12";
    await autofix.forceFixNow(errorOutput);

    const exhaustionLog = logger.messages.find((m) => m.includes('autofix_budget_exhausted'));
    expect(exhaustionLog).toBeDefined();

    const jsonStr = exhaustionLog!.replace('ERROR: ', '');
    const parsed = JSON.parse(jsonStr);
    expect(parsed.event).toBe('autofix_budget_exhausted');
    expect(parsed.totalAttempts).toBe(3);
    expect(Array.isArray(parsed.failedTaskIds)).toBe(true);
    expect(parsed.failedTaskIds.length).toBeGreaterThanOrEqual(1);

    // Verify multiple LLM calls were made (retried)
    const chatCalls = (failingLlm.chat as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(chatCalls).toBeGreaterThanOrEqual(2);
  });

  it('increments retry counter on each failed diff apply', async () => {
    const alwaysFailing = createMockLlmClient([invalidDiff(), invalidDiff(), invalidDiff()]);
    const logger = createMockLogger();

    const autofix = new ErrorAutoFixer(
      tmpDir,
      alwaysFailing,
      createMockGitManager(),
      createMockEventBus(),
      createMockWsServer(),
      createMockProjectMap(),
      undefined,
      'test-model',
      logger,
    );

    const errorOutput = 'SyntaxError: Unexpected token in ./src/page.tsx:3:1';
    await autofix.forceFixNow(errorOutput);

    const chatCalls = (alwaysFailing.chat as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(chatCalls).toBe(3);

    const exhaustionMsg = logger.messages.find((m) => m.includes('autofix_budget_exhausted'));
    expect(exhaustionMsg).toBeDefined();

    const jsonStr = exhaustionMsg!.replace('ERROR: ', '');
    const parsed = JSON.parse(jsonStr);
    expect(parsed.totalAttempts).toBe(3);
  });

  it('does not silently stop after single failed attempt', async () => {
    const llm = createMockLlmClient([invalidDiff(), invalidDiff(), validDiff()]);
    const logger = createMockLogger();

    const autofix = new ErrorAutoFixer(
      tmpDir,
      llm,
      createMockGitManager(),
      createMockEventBus(),
      createMockWsServer(),
      createMockProjectMap(),
      undefined,
      'test-model',
      logger,
    );

    const errorOutput = 'Failed to compile: ./src/page.tsx:5:12\nError: Unexpected token';
    await autofix.forceFixNow(errorOutput);

    const chatCalls = (llm.chat as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(chatCalls).toBeGreaterThanOrEqual(2);

    const retryLogs = logger.messages.filter((m) => m.includes('retrying'));
    expect(retryLogs.length).toBeGreaterThanOrEqual(1);
  });

  it('emits budget exhaustion with last error and failed task IDs', async () => {
    const failingLlm = createFailingLlmClient(3);
    const logger = createMockLogger();
    const wsServer = createMockWsServer();

    const autofix = new ErrorAutoFixer(
      tmpDir,
      failingLlm,
      createMockGitManager(),
      createMockEventBus(),
      wsServer,
      createMockProjectMap(),
      undefined,
      'test-model',
      logger,
    );

    const errorOutput = 'Build error: Compilation failed in ./src/page.tsx:3:1';
    await autofix.forceFixNow(errorOutput);

    const exhaustionLog = logger.messages.find((m) => m.includes('autofix_budget_exhausted'));
    expect(exhaustionLog).toBeDefined();

    const jsonStr = exhaustionLog!.replace('ERROR: ', '');
    const parsed = JSON.parse(jsonStr);
    expect(parsed.lastError).toBeDefined();
    expect(parsed.totalAttempts).toBe(3);
    expect(Array.isArray(parsed.failedTaskIds)).toBe(true);
    expect(parsed.failedTaskIds.length).toBeGreaterThanOrEqual(1);
    expect(parsed.lastFailureReason).toBeDefined();

    const wsCalls = (wsServer.sendEvent as ReturnType<typeof vi.fn>).mock.calls;
    const budgetCalls = wsCalls.filter(
      (c: unknown[]) =>
        ((c[0] as Record<string, unknown>)?.data as Record<string, unknown>)?.message ===
        'autofix_budget_exhausted',
    );
    expect(budgetCalls.length).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // Deletion-intent prompt detection via LLM message inspection
  // -----------------------------------------------------------------------

  it('includes deletion instruction when error mentions conflicting routes', async () => {
    const llm = createMockLlmClient([validDiff()]);

    const autofix = new ErrorAutoFixer(
      tmpDir,
      llm,
      createMockGitManager(),
      createMockEventBus(),
      createMockWsServer(),
      createMockProjectMap(),
      undefined,
      'test-model',
      createMockLogger(),
    );

    const errorOutput =
      'Build error: App Router and Pages Router both match path "/". ' +
      'Please remove one of them. File: ./src/page.tsx:3:1';

    await autofix.forceFixNow(errorOutput);

    const chatMock = llm.chat as ReturnType<typeof vi.fn>;
    expect(chatMock.mock.calls.length).toBeGreaterThanOrEqual(1);

    const messages = chatMock.mock.calls[0]![0] as Message[];
    const userMsg = messages.find((m: Message) => m.role === 'user');
    expect(userMsg).toBeDefined();

    const content = userMsg!.content;
    const hasDeletionInstruction =
      content.includes('REMOVE') ||
      content.includes('DELETE') ||
      content.includes('remove or delete');
    expect(hasDeletionInstruction).toBe(true);
  });

  it('includes deletion instruction for duplicate route errors', async () => {
    const llm = createMockLlmClient([validDiff()]);

    const autofix = new ErrorAutoFixer(
      tmpDir,
      llm,
      createMockGitManager(),
      createMockEventBus(),
      createMockWsServer(),
      createMockProjectMap(),
      undefined,
      'test-model',
      createMockLogger(),
    );

    const errorOutput =
      'Error: You have a duplicate route. Both app/page.tsx and pages/index.tsx resolve to "/". ' +
      './src/page.tsx:3:1';

    await autofix.forceFixNow(errorOutput);

    const chatMock = llm.chat as ReturnType<typeof vi.fn>;
    const messages = chatMock.mock.calls[0]![0] as Message[];
    const userMsg = messages.find((m: Message) => m.role === 'user');
    expect(userMsg).toBeDefined();

    const content = userMsg!.content;
    const hasDeletionInstruction = content.includes('REMOVE') || content.includes('DELETE');
    expect(hasDeletionInstruction).toBe(true);
  });

  it('includes deletion instruction for "both match" collision errors', async () => {
    const llm = createMockLlmClient([validDiff()]);

    const autofix = new ErrorAutoFixer(
      tmpDir,
      llm,
      createMockGitManager(),
      createMockEventBus(),
      createMockWsServer(),
      createMockProjectMap(),
      undefined,
      'test-model',
      createMockLogger(),
    );

    const errorOutput =
      'Error: Multiple modules match path "./config". Both src/config.ts and ' +
      'src/config/index.ts exist. ./src/page.tsx:3:1';

    await autofix.forceFixNow(errorOutput);

    const chatMock = llm.chat as ReturnType<typeof vi.fn>;
    const messages = chatMock.mock.calls[0]![0] as Message[];
    const userMsg = messages.find((m: Message) => m.role === 'user');
    expect(userMsg).toBeDefined();

    const content = userMsg!.content;
    const hasDeletionInstruction = content.includes('REMOVE') || content.includes('DELETE');
    expect(hasDeletionInstruction).toBe(true);
  });

  it('includes deletion instruction for "conflicting" errors', async () => {
    const llm = createMockLlmClient([validDiff()]);

    const autofix = new ErrorAutoFixer(
      tmpDir,
      llm,
      createMockGitManager(),
      createMockEventBus(),
      createMockWsServer(),
      createMockProjectMap(),
      undefined,
      'test-model',
      createMockLogger(),
    );

    const errorOutput =
      'TypeScript error: Conflicting definitions for module "./utils". ' +
      'Remove the duplicate. ./src/page.tsx:3:1';

    await autofix.forceFixNow(errorOutput);

    const chatMock = llm.chat as ReturnType<typeof vi.fn>;
    const messages = chatMock.mock.calls[0]![0] as Message[];
    const userMsg = messages.find((m: Message) => m.role === 'user');
    expect(userMsg).toBeDefined();

    const content = userMsg!.content;
    const hasDeletionInstruction = content.includes('REMOVE') || content.includes('DELETE');
    expect(hasDeletionInstruction).toBe(true);
  });

  it('does NOT include deletion instruction for non-collision errors', async () => {
    const llm = createMockLlmClient([validDiff()]);

    const autofix = new ErrorAutoFixer(
      tmpDir,
      llm,
      createMockGitManager(),
      createMockEventBus(),
      createMockWsServer(),
      createMockProjectMap(),
      undefined,
      'test-model',
      createMockLogger(),
    );

    const errorOutput = "Module not found: Can't resolve 'react' in ./src/page.tsx:5:12";

    await autofix.forceFixNow(errorOutput);

    const chatMock = llm.chat as ReturnType<typeof vi.fn>;
    const messages = chatMock.mock.calls[0]![0] as Message[];
    const userMsg = messages.find((m: Message) => m.role === 'user');
    expect(userMsg).toBeDefined();

    const content = userMsg!.content;
    const hasExplicitDeletion =
      content.includes('REMOVE or DELETE') || content.includes('Prefer deletion');
    expect(hasExplicitDeletion).toBe(false);
  });

  // -----------------------------------------------------------------------
  // isAutofixTask
  // -----------------------------------------------------------------------

  it('isAutofixTask returns false for non-existent task ID', async () => {
    const llm = createMockLlmClient([validDiff()]);

    const autofix = new ErrorAutoFixer(
      tmpDir,
      llm,
      createMockGitManager(),
      createMockEventBus(),
      createMockWsServer(),
      createMockProjectMap(),
      undefined,
      'test-model',
      createMockLogger(),
    );

    const errorOutput = "Module not found: Can't resolve './missing' in ./src/page.tsx:5:12";
    await autofix.forceFixNow(errorOutput);

    expect(autofix.isAutofixTask('nonexistent-id')).toBe(false);
  });

  // -----------------------------------------------------------------------
  // handleOutput
  // -----------------------------------------------------------------------

  it('handleOutput triggers fix on error pattern match', async () => {
    const llm = createMockLlmClient([validDiff()]);

    const autofix = new ErrorAutoFixer(
      tmpDir,
      llm,
      createMockGitManager(),
      createMockEventBus(),
      createMockWsServer(),
      createMockProjectMap(),
      undefined,
      'test-model',
      createMockLogger(),
    );

    // handleOutput is debounced (1000ms); include file path so Lane2 can match
    const errorOutput = 'Failed to compile: ./src/page.tsx:3:1\nError: something went wrong';
    autofix.handleOutput(errorOutput);

    // Wait for debounce + fix to complete
    await new Promise((resolve) => setTimeout(resolve, 2000));

    expect((llm.chat as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('handleOutput ignores non-error output', async () => {
    const llm = createMockLlmClient([validDiff()]);

    const autofix = new ErrorAutoFixer(
      tmpDir,
      llm,
      createMockGitManager(),
      createMockEventBus(),
      createMockWsServer(),
      createMockProjectMap(),
      undefined,
      'test-model',
      createMockLogger(),
    );

    autofix.handleOutput('ready started server on 0.0.0.0:3000, url: http://localhost:3000');
    autofix.handleOutput('compiled successfully in 200ms');

    // Wait to ensure no fix is triggered
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect((llm.chat as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});

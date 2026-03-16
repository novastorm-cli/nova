import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  TaskItem,
  ProjectMap,
  StackInfo,
  MiniContext,
  ExecutionResult,
  LlmClient,
} from '../../models/types.js';
import type { IGitManager } from '../../contracts/IGitManager.js';
import type { ILane2Executor } from '../../contracts/IExecutor.js';

const { Lane2Executor } = await import('../Lane2Executor.js');

function createTaskItem(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'task-lane2-1',
    description: 'Add a loading spinner to the dashboard',
    files: ['src/Dashboard.tsx'],
    type: 'single_file',
    lane: 2,
    status: 'pending',
    ...overrides,
  };
}

function createProjectMap(
  tmpDir: string,
  fileContent: string,
  overrides: Partial<ProjectMap> = {},
): ProjectMap {
  const stack: StackInfo = {
    framework: 'next.js',
    language: 'typescript',
    packageManager: 'npm',
    typescript: true,
  };

  const miniContext: MiniContext = {
    filePath: 'src/Dashboard.tsx',
    content: fileContent,
    importedTypes: '',
  };

  const fileContexts = new Map<string, MiniContext>();
  fileContexts.set('src/Dashboard.tsx', miniContext);

  return {
    stack,
    devCommand: 'npm run dev',
    port: 3000,
    routes: [],
    components: [],
    endpoints: [],
    models: [],
    dependencies: new Map(),
    fileContexts,
    compressedContext: '',
    ...overrides,
  };
}

function createMockLlmClient(diffResponse: string): LlmClient {
  return {
    chat: vi.fn().mockResolvedValue(diffResponse),
    chatWithVision: vi.fn().mockResolvedValue(''),
    stream: vi.fn(),
  };
}

function createMockGitManager(commitHash = 'abc1234'): IGitManager {
  return {
    createBranch: vi.fn().mockResolvedValue('nova/1234567890'),
    commit: vi.fn().mockResolvedValue(commitHash),
    rollback: vi.fn().mockResolvedValue(undefined),
    getDiff: vi.fn().mockResolvedValue(''),
    getLog: vi.fn().mockResolvedValue([]),
    getCurrentBranch: vi.fn().mockResolvedValue('main'),
    getDevCount: vi.fn().mockResolvedValue(1),
    hasUncommittedChanges: vi.fn().mockResolvedValue(false),
    stash: vi.fn().mockResolvedValue(undefined),
    unstash: vi.fn().mockResolvedValue(undefined),
  };
}

describe('Lane2Executor', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane2-test-'));
    // Set up as a git repo so file operations work
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sends to mock LLM, applies diff, commits, and returns ExecutionResult', async () => {
    const originalContent = 'export function Dashboard() {\n  return <div>Dashboard</div>;\n}\n';
    const filePath = path.join(tmpDir, 'src/Dashboard.tsx');
    fs.writeFileSync(filePath, originalContent, 'utf-8');

    const llmDiffResponse = [
      '```diff',
      '--- a/src/Dashboard.tsx',
      '+++ b/src/Dashboard.tsx',
      '@@ -1,3 +1,5 @@',
      ' export function Dashboard() {',
      '-  return <div>Dashboard</div>;',
      '+  const [loading] = useState(true);',
      '+  if (loading) return <Spinner />;',
      '+  return <div>Dashboard</div>;',
      ' }',
      '```',
    ].join('\n');

    const commitHash = 'f4c8e21';
    const mockLlm = createMockLlmClient(llmDiffResponse);
    const mockGit = createMockGitManager(commitHash);

    const executor: ILane2Executor = new Lane2Executor(tmpDir, mockLlm, mockGit);

    const task = createTaskItem();
    const projectMap = createProjectMap(tmpDir, originalContent);

    const result: ExecutionResult = await executor.execute(task, projectMap);

    // LLM was called
    expect(mockLlm.chat).toHaveBeenCalledOnce();

    // Git commit was called
    expect(mockGit.commit).toHaveBeenCalled();

    // Result shape
    expect(result.success).toBe(true);
    expect(result.taskId).toBe(task.id);
    expect(result.diff).toBeDefined();
    expect(typeof result.diff).toBe('string');
    expect(result.commitHash).toBe(commitHash);
  });
});

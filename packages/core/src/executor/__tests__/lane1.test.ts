import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TaskItem, ProjectMap, StackInfo, ExecutionResult } from '../../models/types.js';
import type { ILane1Executor } from '../../contracts/IExecutor.js';

const { Lane1Executor } = await import('../Lane1Executor.js');

function createTaskItem(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'task-lane1-1',
    description: 'Change color: red to color: blue',
    files: ['style.css'],
    type: 'css',
    lane: 1,
    status: 'pending',
    ...overrides,
  };
}

function createProjectMap(overrides: Partial<ProjectMap> = {}): ProjectMap {
  const stack: StackInfo = {
    framework: 'vite',
    language: 'typescript',
    packageManager: 'npm',
    typescript: true,
  };

  return {
    stack,
    devCommand: 'npm run dev',
    port: 3000,
    routes: [],
    components: [],
    endpoints: [],
    models: [],
    dependencies: new Map(),
    fileContexts: new Map(),
    compressedContext: '',
    ...overrides,
  };
}

describe('Lane1Executor', () => {
  let tmpDir: string;
  let executor: ILane1Executor;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane1-test-'));
    executor = new Lane1Executor(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('applies CSS change "color: red" to "color: blue" and returns diff', async () => {
    const cssFile = path.join(tmpDir, 'style.css');
    fs.writeFileSync(cssFile, 'body {\n  color: red;\n  margin: 0;\n}\n', 'utf-8');

    const task = createTaskItem({
      description: 'Change color: red to color: blue',
      files: [cssFile],
    });
    const projectMap = createProjectMap();

    const result: ExecutionResult = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    expect(result.taskId).toBe(task.id);
    expect(result.diff).toBeDefined();
    expect(typeof result.diff).toBe('string');

    // Verify the file was actually modified
    const updatedContent = fs.readFileSync(cssFile, 'utf-8');
    expect(updatedContent).toContain('color: blue');
    expect(updatedContent).not.toContain('color: red');
  });
});

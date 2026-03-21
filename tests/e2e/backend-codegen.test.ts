import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, cpSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { TaskItem, ProjectMap, LlmClient, MiniContext } from '../../packages/core/src/models/types.js';
import type { IGitManager } from '../../packages/core/src/contracts/IGitManager.js';
import type { EventBus } from '../../packages/core/src/models/events.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_PROJECT = '/Users/vladimirpronevic/RiderProjects/test-project';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(prefix = 'nova-codegen-'): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

const tmpDirsToClean: string[] = [];

function trackTmp(): string {
  const dir = makeTmp();
  tmpDirsToClean.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirsToClean) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
  }
});

function makeTask(overrides: Partial<TaskItem> & Pick<TaskItem, 'description' | 'files' | 'type' | 'lane'>): TaskItem {
  return {
    id: crypto.randomUUID(),
    status: 'pending',
    ...overrides,
  };
}

function makeProjectMap(fileContexts: Map<string, MiniContext>, overrides?: Partial<ProjectMap>): ProjectMap {
  return {
    stack: { framework: 'next.js', language: 'typescript', typescript: true },
    devCommand: 'npm run dev',
    port: 3000,
    routes: [],
    components: [],
    endpoints: [],
    models: [],
    dependencies: new Map(),
    fileContexts,
    compressedContext: 'Test project context',
    ...overrides,
  };
}

function makeMockGit(): IGitManager {
  return {
    commit: vi.fn(async () => 'abc1234'),
    createBranch: vi.fn(async () => 'nova/test'),
    rollback: vi.fn(),
    getDiff: vi.fn(async () => ''),
    getLog: vi.fn(async () => []),
    getCurrentBranch: vi.fn(async () => 'main'),
    getDevCount: vi.fn(async () => 1),
    hasUncommittedChanges: vi.fn(async () => false),
    stash: vi.fn(),
    unstash: vi.fn(),
  };
}

function makeMockLlm(chatResponse: string, streamResponse?: string): LlmClient {
  return {
    chat: vi.fn(async () => chatResponse),
    chatWithVision: vi.fn(async () => ''),
    stream: vi.fn(async function* () {
      yield streamResponse ?? chatResponse;
    }),
  };
}

function makeMockEventBus(): EventBus {
  return { emit: vi.fn(), on: vi.fn(), off: vi.fn() };
}

// ============================================================================
// 1. Lane1Executor -- Real CSS Changes
// ============================================================================

describe.concurrent('Lane1Executor -- Real CSS Changes', () => {

  it.concurrent('a) changes color from red to blue in a CSS file', async () => {
    const { Lane1Executor } = await import('../../packages/core/src/executor/Lane1Executor.js');

    const tmp = trackTmp();
    const cssFile = path.join(tmp, 'styles.css');
    writeFileSync(cssFile, '.header {\n  color: red;\n  font-size: 16px;\n}\n', 'utf-8');

    const executor = new Lane1Executor(tmp);
    const task = makeTask({
      description: 'change color from red to blue',
      files: [cssFile],
      type: 'css',
      lane: 1,
    });

    const fileContexts = new Map<string, MiniContext>();
    const projectMap = makeProjectMap(fileContexts);

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    expect(result.taskId).toBe(task.id);
    expect(result.diff).toBeDefined();
    expect(result.diff!.length).toBeGreaterThan(0);

    const updated = readFileSync(cssFile, 'utf-8');
    expect(updated).toContain('color: blue');
    expect(updated).not.toContain('color: red');
    // font-size should be unchanged
    expect(updated).toContain('font-size: 16px');
  });

  it.concurrent('b) sets background to green on a component file with inline style', async () => {
    const { Lane1Executor } = await import('../../packages/core/src/executor/Lane1Executor.js');

    const tmp = trackTmp();
    const tsxFile = path.join(tmp, 'Card.tsx');
    writeFileSync(
      tsxFile,
      'export function Card() {\n  return <div style={{ background: "white", padding: "10px" }}>Hello</div>;\n}\n',
      'utf-8',
    );

    const executor = new Lane1Executor(tmp);
    const task = makeTask({
      description: 'set background to green',
      files: [tsxFile],
      type: 'css',
      lane: 1,
    });

    const projectMap = makeProjectMap(new Map());
    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);

    const updated = readFileSync(tsxFile, 'utf-8');
    expect(updated).toContain('green');
  });

  it.concurrent('c) makes font-size 20px on a .css file', async () => {
    const { Lane1Executor } = await import('../../packages/core/src/executor/Lane1Executor.js');

    const tmp = trackTmp();
    const cssFile = path.join(tmp, 'global.css');
    writeFileSync(cssFile, 'body {\n  font-size: 14px;\n  margin: 0;\n}\n', 'utf-8');

    const executor = new Lane1Executor(tmp);
    const task = makeTask({
      description: 'make font-size 20px',
      files: [cssFile],
      type: 'css',
      lane: 1,
    });

    const projectMap = makeProjectMap(new Map());
    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    expect(result.diff).toBeDefined();

    const updated = readFileSync(cssFile, 'utf-8');
    expect(updated).toContain('font-size: 20px');
    expect(updated).not.toContain('font-size: 14px');
  });

  it.concurrent('d) returns success:false gracefully for unparseable description', async () => {
    const { Lane1Executor } = await import('../../packages/core/src/executor/Lane1Executor.js');

    const tmp = trackTmp();
    const cssFile = path.join(tmp, 'app.css');
    writeFileSync(cssFile, '.container { display: flex; }\n', 'utf-8');

    const executor = new Lane1Executor(tmp);
    const task = makeTask({
      description: 'add a login form',
      files: [cssFile],
      type: 'css',
      lane: 1,
    });

    const projectMap = makeProjectMap(new Map());
    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(false);
    expect(result.taskId).toBe(task.id);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Could not parse');
  });
});

// ============================================================================
// 2. Lane2Executor with Mock LLM
// ============================================================================

describe.concurrent('Lane2Executor -- Mock LLM', () => {

  it.concurrent('a) LLM returns valid diff -> applied to file, commit called', async () => {
    const { Lane2Executor } = await import('../../packages/core/src/executor/Lane2Executor.js');

    const tmp = trackTmp();
    const filePath = 'app/page.tsx';
    const absPath = path.join(tmp, filePath);
    mkdirSync(path.dirname(absPath), { recursive: true });
    writeFileSync(absPath, 'export default function Home() {\n  return <div>Hello</div>;\n}\n', 'utf-8');

    const diffResponse = [
      '--- a/app/page.tsx',
      '+++ b/app/page.tsx',
      '@@ -1,3 +1,3 @@',
      ' export default function Home() {',
      '-  return <div>Hello</div>;',
      '+  return <div>Hello World</div>;',
      ' }',
    ].join('\n');

    const llm = makeMockLlm(diffResponse);
    const git = makeMockGit();

    const executor = new Lane2Executor(tmp, llm, git);

    const fileContexts = new Map<string, MiniContext>();
    fileContexts.set(filePath, {
      filePath,
      content: 'export default function Home() {\n  return <div>Hello</div>;\n}\n',
      importedTypes: '',
    });

    const task = makeTask({
      description: 'change greeting to Hello World',
      files: [filePath],
      type: 'single_file',
      lane: 2,
    });

    const projectMap = makeProjectMap(fileContexts);
    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    expect(result.commitHash).toBe('abc1234');
    expect(git.commit).toHaveBeenCalledTimes(1);

    const updated = readFileSync(absPath, 'utf-8');
    expect(updated).toContain('Hello World');
  });

  it.concurrent('b) LLM returns diff wrapped in markdown fences -> still extracted and applied', async () => {
    const { Lane2Executor } = await import('../../packages/core/src/executor/Lane2Executor.js');

    const tmp = trackTmp();
    const filePath = 'app/layout.tsx';
    const absPath = path.join(tmp, filePath);
    mkdirSync(path.dirname(absPath), { recursive: true });
    writeFileSync(absPath, 'export const title = "My App";\nexport const version = "1.0";\n', 'utf-8');

    const diffResponse = [
      '```diff',
      '--- a/app/layout.tsx',
      '+++ b/app/layout.tsx',
      '@@ -1,2 +1,2 @@',
      '-export const title = "My App";',
      '+export const title = "Nova App";',
      ' export const version = "1.0";',
      '```',
    ].join('\n');

    const llm = makeMockLlm(diffResponse);
    const git = makeMockGit();
    const executor = new Lane2Executor(tmp, llm, git);

    const fileContexts = new Map<string, MiniContext>();
    fileContexts.set(filePath, {
      filePath,
      content: 'export const title = "My App";\nexport const version = "1.0";\n',
      importedTypes: '',
    });

    const task = makeTask({
      description: 'change app title to Nova App',
      files: [filePath],
      type: 'single_file',
      lane: 2,
    });

    const projectMap = makeProjectMap(fileContexts);
    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    expect(result.commitHash).toBe('abc1234');

    const updated = readFileSync(absPath, 'utf-8');
    expect(updated).toContain('Nova App');
    expect(updated).not.toContain('My App');
  });

  it.concurrent('c) no target file specified -> returns error gracefully', async () => {
    const { Lane2Executor } = await import('../../packages/core/src/executor/Lane2Executor.js');

    const tmp = trackTmp();
    const llm = makeMockLlm('some diff');
    const git = makeMockGit();
    const executor = new Lane2Executor(tmp, llm, git);

    const task = makeTask({
      description: 'do something',
      files: [],
      type: 'single_file',
      lane: 2,
    });

    const projectMap = makeProjectMap(new Map());
    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(false);
    expect(result.error).toContain('No target file specified');
    expect(git.commit).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 3. Lane3Executor with Mock LLM
// ============================================================================

describe.concurrent('Lane3Executor -- Mock LLM', () => {

  it.concurrent('a) LLM returns FILE block for a new file -> written to disk, committed', async () => {
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    const eventBus = makeMockEventBus();

    const fileBlockResponse = [
      '=== FILE: components/SearchBar.tsx ===',
      'export function SearchBar() {',
      '  return <input type="search" placeholder="Search..." />;',
      '}',
      '=== END FILE ===',
    ].join('\n');

    const llm = makeMockLlm('', fileBlockResponse);
    const git = makeMockGit();

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);

    const task = makeTask({
      description: 'create a SearchBar component',
      files: ['components/SearchBar.tsx'],
      type: 'multi_file',
      lane: 3,
    });

    const fileContexts = new Map<string, MiniContext>();
    const projectMap = makeProjectMap(fileContexts);

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    expect(result.commitHash).toBe('abc1234');
    expect(git.commit).toHaveBeenCalledTimes(1);

    const written = readFileSync(path.join(tmp, 'components', 'SearchBar.tsx'), 'utf-8');
    expect(written).toContain('export function SearchBar()');
    expect(written).toContain('placeholder="Search..."');
  });

  it.concurrent('b) LLM returns DIFF block for existing file -> applied, committed', async () => {
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    const eventBus = makeMockEventBus();

    // Create the existing file on disk
    const existingFilePath = 'app/page.tsx';
    const absPath = path.join(tmp, existingFilePath);
    mkdirSync(path.dirname(absPath), { recursive: true });
    writeFileSync(absPath, 'export default function Home() {\n  return <div>Hello</div>;\n}\n', 'utf-8');

    const diffBlockResponse = [
      '=== DIFF: app/page.tsx ===',
      '--- a/app/page.tsx',
      '+++ b/app/page.tsx',
      '@@ -1,3 +1,3 @@',
      ' export default function Home() {',
      '-  return <div>Hello</div>;',
      '+  return <div>Hello World</div>;',
      ' }',
      '=== END DIFF ===',
    ].join('\n');

    const llm = makeMockLlm('', diffBlockResponse);
    const git = makeMockGit();

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);

    const fileContexts = new Map<string, MiniContext>();
    fileContexts.set(existingFilePath, {
      filePath: existingFilePath,
      content: 'export default function Home() {\n  return <div>Hello</div>;\n}\n',
      importedTypes: '',
    });

    const task = makeTask({
      description: 'change greeting text',
      files: [existingFilePath],
      type: 'multi_file',
      lane: 3,
    });

    const projectMap = makeProjectMap(fileContexts);
    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    expect(result.commitHash).toBe('abc1234');

    const updated = readFileSync(absPath, 'utf-8');
    expect(updated).toContain('Hello World');
  });

  it.concurrent('c) LLM returns empty response (no blocks) -> returns success:false', async () => {
    const { Lane3Executor } = await import('../../packages/core/src/executor/Lane3Executor.js');

    const tmp = trackTmp();
    const eventBus = makeMockEventBus();

    const llm = makeMockLlm('', 'I am not sure what to do here.');
    const git = makeMockGit();

    const executor = new Lane3Executor(tmp, llm, git, eventBus, 1);

    const task = makeTask({
      description: 'do something vague',
      files: [],
      type: 'multi_file',
      lane: 3,
    });

    const projectMap = makeProjectMap(new Map());
    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(false);
    expect(result.error).toContain('did not generate any file blocks');
    expect(git.commit).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 4. fileBlocks Parsing
// ============================================================================

describe.concurrent('fileBlocks Parsing', () => {

  it.concurrent('a) parseFileBlocks with multiple FILE blocks', async () => {
    const { parseFileBlocks } = await import('../../packages/core/src/executor/fileBlocks.js');

    const response = [
      '=== FILE: components/Header.tsx ===',
      'export function Header() { return <h1>Header</h1>; }',
      '=== END FILE ===',
      '',
      '=== FILE: components/Footer.tsx ===',
      'export function Footer() { return <footer>Footer</footer>; }',
      '=== END FILE ===',
      '',
      '=== FILE: utils/helpers.ts ===',
      'export const formatDate = (d: Date) => d.toISOString();',
      '=== END FILE ===',
    ].join('\n');

    const blocks = parseFileBlocks(response);

    expect(blocks).toHaveLength(3);
    expect(blocks[0].path).toBe('components/Header.tsx');
    expect(blocks[0].content).toContain('Header');
    expect(blocks[1].path).toBe('components/Footer.tsx');
    expect(blocks[1].content).toContain('Footer');
    expect(blocks[2].path).toBe('utils/helpers.ts');
    expect(blocks[2].content).toContain('formatDate');
  });

  it.concurrent('b) parseMixedBlocks with mixed FILE + DIFF blocks', async () => {
    const { parseMixedBlocks } = await import('../../packages/core/src/executor/fileBlocks.js');

    const response = [
      '=== FILE: components/NewComponent.tsx ===',
      'export function NewComponent() { return <div>New</div>; }',
      '=== END FILE ===',
      '',
      '=== DIFF: app/page.tsx ===',
      '--- a/app/page.tsx',
      '+++ b/app/page.tsx',
      '@@ -1,3 +1,4 @@',
      ' import React from "react";',
      '+import { NewComponent } from "../components/NewComponent";',
      ' export default function Home() {',
      '   return <div>Hello</div>;',
      '=== END DIFF ===',
    ].join('\n');

    const blocks = parseMixedBlocks(response);

    expect(blocks).toHaveLength(2);

    expect(blocks[0].type).toBe('file');
    if (blocks[0].type === 'file') {
      expect(blocks[0].path).toBe('components/NewComponent.tsx');
      expect(blocks[0].content).toContain('NewComponent');
    }

    expect(blocks[1].type).toBe('diff');
    if (blocks[1].type === 'diff') {
      expect(blocks[1].path).toBe('app/page.tsx');
      expect(blocks[1].diff).toContain('@@');
      expect(blocks[1].diff).toContain('+import { NewComponent }');
    }
  });

  it.concurrent('c) parseMixedBlocks with invalid DIFF (no @@ headers) -> treated as FILE', async () => {
    const { parseMixedBlocks } = await import('../../packages/core/src/executor/fileBlocks.js');

    const response = [
      '=== DIFF: app/layout.tsx ===',
      'export default function Layout({ children }) {',
      '  return <html><body>{children}</body></html>;',
      '}',
      '=== END DIFF ===',
    ].join('\n');

    const blocks = parseMixedBlocks(response);

    expect(blocks).toHaveLength(1);
    // Should be treated as file because no @@ or --- headers
    expect(blocks[0].type).toBe('file');
    if (blocks[0].type === 'file') {
      expect(blocks[0].path).toBe('app/layout.tsx');
      expect(blocks[0].content).toContain('Layout');
    }
  });

  it.concurrent('d) addLineNumbers formats correctly', async () => {
    const { addLineNumbers } = await import('../../packages/core/src/executor/fileBlocks.js');

    const content = 'const a = 1;\nconst b = 2;\nconst c = 3;';
    const result = addLineNumbers(content);

    expect(result).toBe('1 | const a = 1;\n2 | const b = 2;\n3 | const c = 3;');
  });
});

// ============================================================================
// 5. ExecutorPool Routing & Fallback
// ============================================================================

describe.concurrent('ExecutorPool Routing & Fallback', () => {

  it.concurrent('a) Lane 1 success -> no fallback', async () => {
    const { ExecutorPool } = await import('../../packages/core/src/executor/ExecutorPool.js');

    const eventBus = makeMockEventBus();

    const lane1 = {
      execute: vi.fn(async () => ({
        success: true,
        taskId: 'task-1',
        diff: 'color: blue',
      })),
    };

    const lane2 = {
      execute: vi.fn(async () => ({
        success: true,
        taskId: 'task-1',
      })),
    };

    const pool = new ExecutorPool(lane1, lane2, eventBus);

    const task = makeTask({
      description: 'change color to blue',
      files: ['styles.css'],
      type: 'css',
      lane: 1,
    });

    const projectMap = makeProjectMap(new Map());
    const result = await pool.execute(task, projectMap);

    expect(result.success).toBe(true);
    expect(lane1.execute).toHaveBeenCalledTimes(1);
    // No fallback needed
    expect(lane2.execute).not.toHaveBeenCalled();
  });

  it.concurrent('b) Lane 1 failure -> falls back to Lane3 (fast model)', async () => {
    const { ExecutorPool } = await import('../../packages/core/src/executor/ExecutorPool.js');

    const tmp = trackTmp();
    const eventBus = makeMockEventBus();

    const lane1 = {
      execute: vi.fn(async () => ({
        success: false,
        taskId: 'task-2',
        error: 'Could not parse CSS property',
      })),
    };

    const lane2 = {
      execute: vi.fn(async () => ({
        success: true,
        taskId: 'task-2',
      })),
    };

    // Provide LLM + git + projectPath so lane3Fast is created
    const fileBlockResponse = [
      '=== FILE: styles.css ===',
      '.header { color: blue; }',
      '=== END FILE ===',
    ].join('\n');

    const llm = makeMockLlm('', fileBlockResponse);
    const git = makeMockGit();

    const pool = new ExecutorPool(lane1, lane2, eventBus, llm, git, tmp, 'fast-model', 'strong-model');

    const task = makeTask({
      description: 'change header color to blue',
      files: ['styles.css'],
      type: 'css',
      lane: 1,
    });

    const projectMap = makeProjectMap(new Map());
    const result = await pool.execute(task, projectMap);

    // Lane1 failed, should have fallen back to Lane3
    expect(lane1.execute).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it.concurrent('c) Lane 3/4 without LLM -> returns error about missing config', async () => {
    const { ExecutorPool } = await import('../../packages/core/src/executor/ExecutorPool.js');

    const eventBus = makeMockEventBus();

    const lane1 = { execute: vi.fn() };
    const lane2 = { execute: vi.fn() };

    // No LLM, no git, no projectPath -> lane3Strong will be null
    const pool = new ExecutorPool(lane1, lane2, eventBus);

    const task3 = makeTask({
      description: 'implement search feature',
      files: ['search.ts', 'index.ts'],
      type: 'multi_file',
      lane: 3,
    });

    const task4 = makeTask({
      description: 'refactor auth module',
      files: ['auth.ts'],
      type: 'refactor',
      lane: 4,
    });

    const projectMap = makeProjectMap(new Map());

    const [result3, result4] = await Promise.all([
      pool.execute(task3, projectMap),
      pool.execute(task4, projectMap),
    ]);

    expect(result3.success).toBe(false);
    expect(result3.error).toContain('requires LLM');

    expect(result4.success).toBe(false);
    expect(result4.error).toContain('requires LLM');
  });
});

// ============================================================================
// 6. PromptBuilder
// ============================================================================

describe.concurrent('PromptBuilder', () => {

  it.concurrent('a) buildAnalysisPrompt includes transcript, URL, project context', async () => {
    const { PromptBuilder } = await import('../../packages/core/src/brain/PromptBuilder.js');

    const builder = new PromptBuilder();

    const observation = {
      screenshot: Buffer.from(''),
      transcript: 'add a search bar to the homepage',
      currentUrl: 'http://localhost:3000/',
      timestamp: Date.now(),
    };

    const projectMap = makeProjectMap(new Map(), {
      compressedContext: 'Next.js app with Tailwind CSS, 5 routes, 12 components',
    });

    const messages = builder.buildAnalysisPrompt(observation, projectMap);

    expect(messages.length).toBeGreaterThan(0);

    const fullContent = messages.map((m) => m.content).join('\n');

    expect(fullContent).toContain('add a search bar to the homepage');
    expect(fullContent).toContain('http://localhost:3000/');
    expect(fullContent).toContain('Next.js app with Tailwind CSS');
    // Should contain JSON instructions
    expect(fullContent).toContain('JSON');
  });

  it.concurrent('b) buildDecomposePrompt includes task description and files', async () => {
    const { PromptBuilder } = await import('../../packages/core/src/brain/PromptBuilder.js');

    const builder = new PromptBuilder();

    const task = makeTask({
      description: 'implement user authentication with JWT',
      files: ['app/api/auth/route.ts', 'lib/auth.ts', 'middleware.ts'],
      type: 'multi_file',
      lane: 3,
    });

    const projectMap = makeProjectMap(new Map(), {
      compressedContext: 'Express-like API with prisma ORM',
    });

    const messages = builder.buildDecomposePrompt(task, projectMap);

    expect(messages.length).toBeGreaterThan(0);

    const fullContent = messages.map((m) => m.content).join('\n');

    expect(fullContent).toContain('implement user authentication with JWT');
    expect(fullContent).toContain('app/api/auth/route.ts');
    expect(fullContent).toContain('lib/auth.ts');
    expect(fullContent).toContain('middleware.ts');
    expect(fullContent).toContain('Express-like API with prisma ORM');
  });
});

// ============================================================================
// 7. End-to-End Backend Generation on test-project
// ============================================================================

describe.concurrent('E2E Backend Generation on test-project', () => {

  it.runIf(existsSync(TEST_PROJECT)).concurrent(
    'a) Index test-project, create Lane1 CSS change task, execute on copy -> file changed',
    async () => {
      const { ProjectIndexer } = await import('../../packages/core/src/indexer/ProjectIndexer.js');
      const { Lane1Executor } = await import('../../packages/core/src/executor/Lane1Executor.js');

      const tmp = trackTmp();
      cpSync(TEST_PROJECT, tmp, {
        recursive: true,
        filter: (src) => !src.includes('node_modules') && !src.includes('.next') && !src.includes('.nova'),
      });

      const indexer = new ProjectIndexer();
      const projectMap = await indexer.index(tmp);

      // Find a CSS file in the project to modify
      const cssFiles: string[] = [];
      for (const [filePath] of projectMap.fileContexts) {
        if (filePath.endsWith('.css')) {
          cssFiles.push(filePath);
        }
      }

      // Always create a controlled CSS file with known content
      const targetFile = path.join(tmp, 'app', 'test-target.css');
      mkdirSync(path.dirname(targetFile), { recursive: true });
      writeFileSync(targetFile, '.header {\n  color: red;\n  margin: 0;\n}\n', 'utf-8');

      const beforeContent = readFileSync(targetFile, 'utf-8');

      const executor = new Lane1Executor(tmp);
      const task = makeTask({
        description: 'change color from red to blue',
        files: [targetFile],
        type: 'css',
        lane: 1,
      });

      expect(beforeContent).toMatch(/color:\s*red/);

      const result = await executor.execute(task, projectMap);
      expect(result.success).toBe(true);

      const afterContent = readFileSync(targetFile, 'utf-8');
      expect(afterContent).not.toBe(beforeContent);
      expect(afterContent).toContain('blue');
    },
    30_000,
  );

  it.runIf(existsSync(TEST_PROJECT)).concurrent(
    'b) Index test-project, run Brain.analyze with mock LLM -> verify task structure',
    async () => {
      const { ProjectIndexer } = await import('../../packages/core/src/indexer/ProjectIndexer.js');
      const { Brain } = await import('../../packages/core/src/brain/Brain.js');

      const tmp = trackTmp();
      cpSync(TEST_PROJECT, tmp, {
        recursive: true,
        filter: (src) => !src.includes('node_modules') && !src.includes('.next') && !src.includes('.nova'),
      });

      const indexer = new ProjectIndexer();
      const projectMap = await indexer.index(tmp);

      // Mock LLM that returns a valid task JSON
      const llmResponse = JSON.stringify([
        {
          description: 'Add GET /api/products endpoint',
          files: ['app/api/products/route.ts'],
          type: 'multi_file',
        },
      ]);

      const llm: LlmClient = {
        chat: vi.fn(async () => llmResponse),
        chatWithVision: vi.fn(async () => llmResponse),
        stream: vi.fn(async function* () { yield llmResponse; }),
      };

      const brain = new Brain(llm);

      const observation = {
        screenshot: Buffer.from(''),
        transcript: 'add an API endpoint for products',
        currentUrl: 'http://localhost:3000/',
        timestamp: Date.now(),
      };

      const tasks = await brain.analyze(observation, projectMap);

      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks[0].description).toContain('products');
      expect(tasks[0].files).toContain('app/api/products/route.ts');
      // Single file with "Add" description -> classifier assigns lane 2
      expect([2, 3]).toContain(tasks[0].lane);
      expect(tasks[0].status).toBe('pending');
      expect(tasks[0].id).toBeDefined();
    },
    30_000,
  );
});

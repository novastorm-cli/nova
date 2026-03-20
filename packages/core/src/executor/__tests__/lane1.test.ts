import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TaskItem, ProjectMap, StackInfo, ExecutionResult } from '../../models/types.js';
import type { ILane1Executor } from '../../contracts/IExecutor.js';

const { Lane1Executor, parseTextChange, parseConfigChange, parsePropertyChange } = await import('../Lane1Executor.js');

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

  // ============================================================
  // CSS changes (existing behavior)
  // ============================================================

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

  // ============================================================
  // Text / attribute changes
  // ============================================================

  it('changes placeholder attribute in JSX file', async () => {
    const jsxFile = path.join(tmpDir, 'Search.tsx');
    fs.writeFileSync(jsxFile, '<input placeholder="Search..." className="input" />\n', 'utf-8');

    const task = createTaskItem({
      description: "change placeholder from 'Search...' to 'Find items...'",
      files: [jsxFile],
    });
    const projectMap = createProjectMap();

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    expect(result.diff).toBeDefined();

    const updatedContent = fs.readFileSync(jsxFile, 'utf-8');
    expect(updatedContent).toContain('placeholder="Find items..."');
    expect(updatedContent).not.toContain('placeholder="Search..."');
  });

  it('sets placeholder attribute without from value', async () => {
    const jsxFile = path.join(tmpDir, 'Input.tsx');
    fs.writeFileSync(jsxFile, '<input placeholder="Old value" />\n', 'utf-8');

    const task = createTaskItem({
      description: "set placeholder to 'Enter email'",
      files: [jsxFile],
    });
    const projectMap = createProjectMap();

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    const updatedContent = fs.readFileSync(jsxFile, 'utf-8');
    expect(updatedContent).toContain('placeholder="Enter email"');
  });

  it('changes JSX text content (label): >Name< to >Full Name<', async () => {
    const jsxFile = path.join(tmpDir, 'Form.tsx');
    fs.writeFileSync(jsxFile, '<label>Name</label>\n<span>Other</span>\n', 'utf-8');

    const task = createTaskItem({
      description: "change text 'Name' to 'Full Name'",
      files: [jsxFile],
    });
    const projectMap = createProjectMap();

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    const updatedContent = fs.readFileSync(jsxFile, 'utf-8');
    expect(updatedContent).toContain('>Full Name<');
    expect(updatedContent).not.toContain('>Name<');
  });

  it('changes title attribute', async () => {
    const jsxFile = path.join(tmpDir, 'Tooltip.tsx');
    fs.writeFileSync(jsxFile, '<div title="Old tooltip">Content</div>\n', 'utf-8');

    const task = createTaskItem({
      description: "change title from 'Old tooltip' to 'New tooltip'",
      files: [jsxFile],
    });
    const projectMap = createProjectMap();

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    const updatedContent = fs.readFileSync(jsxFile, 'utf-8');
    expect(updatedContent).toContain('title="New tooltip"');
    expect(updatedContent).not.toContain('title="Old tooltip"');
  });

  it('changes alt text attribute', async () => {
    const jsxFile = path.join(tmpDir, 'Image.tsx');
    fs.writeFileSync(jsxFile, '<img src="logo.png" alt="Logo" />\n', 'utf-8');

    const task = createTaskItem({
      description: "change alt from 'Logo' to 'Company Logo'",
      files: [jsxFile],
    });
    const projectMap = createProjectMap();

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    const updatedContent = fs.readFileSync(jsxFile, 'utf-8');
    expect(updatedContent).toContain('alt="Company Logo"');
    expect(updatedContent).not.toContain('alt="Logo"');
  });

  it('changes JSX button text via replace...with pattern', async () => {
    const jsxFile = path.join(tmpDir, 'Button.tsx');
    fs.writeFileSync(jsxFile, '<button>Submit</button>\n', 'utf-8');

    const task = createTaskItem({
      description: "replace 'Submit' with 'Send'",
      files: [jsxFile],
    });
    const projectMap = createProjectMap();

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    const updatedContent = fs.readFileSync(jsxFile, 'utf-8');
    expect(updatedContent).toContain('>Send<');
    expect(updatedContent).not.toContain('>Submit<');
  });

  // ============================================================
  // Config changes
  // ============================================================

  it('changes a value in JSON config', async () => {
    const jsonFile = path.join(tmpDir, 'config.json');
    fs.writeFileSync(jsonFile, '{\n  "port": 3000,\n  "host": "localhost"\n}\n', 'utf-8');

    const task = createTaskItem({
      description: 'change port to 4000',
      files: [jsonFile],
    });
    const projectMap = createProjectMap();

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    expect(result.diff).toBeDefined();

    const updatedContent = fs.readFileSync(jsonFile, 'utf-8');
    const parsed = JSON.parse(updatedContent);
    expect(parsed.port).toBe(4000);
    expect(parsed.host).toBe('localhost');
  });

  it('changes a value in YAML config', async () => {
    const yamlFile = path.join(tmpDir, 'config.yaml');
    fs.writeFileSync(yamlFile, 'timeout: 30\nretries: 3\n', 'utf-8');

    const task = createTaskItem({
      description: 'change timeout to 60',
      files: [yamlFile],
    });
    const projectMap = createProjectMap();

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    const updatedContent = fs.readFileSync(yamlFile, 'utf-8');
    expect(updatedContent).toContain('timeout: 60');
    expect(updatedContent).not.toContain('timeout: 30');
    // Other values untouched
    expect(updatedContent).toContain('retries: 3');
  });

  it('changes a value in .env file', async () => {
    const envFile = path.join(tmpDir, '.env');
    fs.writeFileSync(envFile, 'API_URL=http://old-api.example.com\nDEBUG=false\n', 'utf-8');

    const task = createTaskItem({
      description: 'change API_URL to http://new-api.example.com',
      files: [envFile],
    });
    const projectMap = createProjectMap();

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(true);
    const updatedContent = fs.readFileSync(envFile, 'utf-8');
    expect(updatedContent).toContain('API_URL=http://new-api.example.com');
    expect(updatedContent).not.toContain('API_URL=http://old-api.example.com');
    expect(updatedContent).toContain('DEBUG=false');
  });

  // ============================================================
  // Error / fallback cases
  // ============================================================

  it('returns error for unrecognized description', async () => {
    const task = createTaskItem({
      description: 'do something completely unknown and weird',
      files: [],
    });
    const projectMap = createProjectMap();

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Could not parse change from task description');
  });

  it('returns error when text not found in target files', async () => {
    const jsxFile = path.join(tmpDir, 'Empty.tsx');
    fs.writeFileSync(jsxFile, '<div>Nothing here</div>\n', 'utf-8');

    const task = createTaskItem({
      description: "change placeholder from 'NonExistent' to 'New'",
      files: [jsxFile],
    });
    const projectMap = createProjectMap();

    const result = await executor.execute(task, projectMap);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Could not find matching text in target files');
  });
});

// ============================================================
// Unit tests for parse functions
// ============================================================

describe('parseTextChange', () => {
  it('parses "change placeholder from \'X\' to \'Y\'"', () => {
    const result = parseTextChange("change placeholder from 'Search...' to 'Find items...'");
    expect(result).toEqual({ type: 'text', attribute: 'placeholder', from: 'Search...', to: 'Find items...' });
  });

  it('parses "set placeholder to \'X\'"', () => {
    const result = parseTextChange("set placeholder to 'Enter email'");
    expect(result).toEqual({ type: 'text', attribute: 'placeholder', from: null, to: 'Enter email' });
  });

  it('parses "change label from \'X\' to \'Y\'"', () => {
    const result = parseTextChange("change label from 'Name' to 'Full Name'");
    expect(result).toEqual({ type: 'text', attribute: 'label', from: 'Name', to: 'Full Name' });
  });

  it('parses "change title to \'X\'"', () => {
    const result = parseTextChange("change title to 'Dashboard'");
    expect(result).toEqual({ type: 'text', attribute: 'title', from: null, to: 'Dashboard' });
  });

  it('parses "change text \'X\' to \'Y\'"', () => {
    const result = parseTextChange("change text 'Submit' to 'Send'");
    expect(result).toEqual({ type: 'text', from: 'Submit', to: 'Send' });
  });

  it('parses "replace \'X\' with \'Y\'"', () => {
    const result = parseTextChange("replace 'Hello World' with 'Welcome'");
    expect(result).toEqual({ type: 'text', from: 'Hello World', to: 'Welcome' });
  });

  it('returns null for non-text descriptions', () => {
    const result = parseTextChange('make background blue');
    expect(result).toBeNull();
  });
});

describe('parseConfigChange', () => {
  it('parses "change port to 4000"', () => {
    const result = parseConfigChange('change port to 4000');
    expect(result).toEqual({ type: 'config', key: 'port', from: null, to: '4000' });
  });

  it('parses "set timeout to 5000"', () => {
    const result = parseConfigChange('set timeout to 5000');
    expect(result).toEqual({ type: 'config', key: 'timeout', from: null, to: '5000' });
  });

  it('parses "update apiUrl to /api/v2"', () => {
    const result = parseConfigChange('update apiUrl to /api/v2');
    expect(result).toEqual({ type: 'config', key: 'apiUrl', from: null, to: '/api/v2' });
  });

  it('does not match CSS property names', () => {
    const result = parseConfigChange('change color to blue');
    expect(result).toBeNull();
  });

  it('does not match text attribute names', () => {
    const result = parseConfigChange("change placeholder to 'hello'");
    expect(result).toBeNull();
  });
});

describe('parsePropertyChange', () => {
  it('parses "color: red to color: blue"', () => {
    const result = parsePropertyChange('Change color: red to color: blue');
    expect(result).toEqual({ property: 'color', from: 'red', to: 'blue' });
  });

  it('parses "set color to blue"', () => {
    const result = parsePropertyChange('set color to blue');
    expect(result).toEqual({ property: 'color', from: null, to: 'blue' });
  });
});

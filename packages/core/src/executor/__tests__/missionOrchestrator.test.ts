import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TaskItem, ProjectMap, StackInfo, RouteInfo, Message, ChatResponse, LlmOptions, MissionPlan, MissionFeature } from '../../models/types.js';
import type { LlmClient } from '../../contracts/ILlmClient.js';
import { CircularDependencyError, MissingDependencyError, type IOrchestrator } from '../../contracts/IOrchestrator.js';
import { MissionOrchestrator } from '../MissionOrchestrator.js';

// ── Helpers ───────────────────────────────────────────────────────────

function createTaskItem(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'task-orch-1',
    description: 'Build a login page with form validation',
    files: ['app/login/page.tsx'],
    type: 'multi_file',
    lane: 5,
    status: 'pending',
    ...overrides,
  };
}

function createProjectMap(overrides: Partial<ProjectMap> = {}): ProjectMap {
  const stack: StackInfo = {
    framework: 'next.js',
    language: 'typescript',
    packageManager: 'pnpm',
    typescript: true,
  };

  const routes: RouteInfo[] = [
    { path: '/', filePath: 'app/page.tsx', type: 'page' },
    { path: '/dashboard', filePath: 'app/dashboard/page.tsx', type: 'page' },
    { path: '/api/users', filePath: 'app/api/users/route.ts', type: 'api' },
  ];

  const fileContexts = new Map<string, { filePath: string; content: string; importedTypes: string }>();
  fileContexts.set('app/page.tsx', {
    filePath: 'app/page.tsx',
    content: 'export default function Home() { return <div>Home</div>; }',
    importedTypes: '',
  });
  fileContexts.set('app/layout.tsx', {
    filePath: 'app/layout.tsx',
    content: 'export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }',
    importedTypes: 'React.ReactNode',
  });
  fileContexts.set('package.json', {
    filePath: 'package.json',
    content: JSON.stringify({
      dependencies: { next: '^15.0.0', react: '^19.0.0', 'react-dom': '^19.0.0', tailwindcss: '^4.0.0' },
      devDependencies: { typescript: '^5.0.0', '@types/react': '^19.0.0' },
    }),
    importedTypes: '',
  });

  return {
    stack,
    devCommand: 'pnpm dev',
    port: 3000,
    routes,
    components: [],
    endpoints: [],
    models: [],
    dependencies: new Map(),
    fileContexts,
    compressedContext: '',
    ...overrides,
  };
}

function createMockLlmClient(responseContent: string): LlmClient {
  return {
    supportsVision: false,
    chat: vi.fn().mockResolvedValue({ content: responseContent } satisfies ChatResponse),
    chatWithVision: vi.fn(),
    stream: vi.fn(),
  } as unknown as LlmClient;
}

function createOrchestrator(llmResponse: string, modelName: string = 'claude-opus-4-6'): IOrchestrator {
  const llmClient = createMockLlmClient(llmResponse);
  return new MissionOrchestrator(llmClient, modelName);
}

function makeValidPlanJson(features: Array<Partial<MissionFeature>> = []): string {
  const defaults: MissionFeature[] = features.map((f, i) => ({
    id: f.id ?? `feature-${i + 1}`,
    description: f.description ?? `Implement feature ${i + 1}`,
    files: f.files ?? [`app/feature-${i + 1}/page.tsx`],
    type: f.type ?? 'multi_file',
    dependencies: f.dependencies ?? [],
  }));
  return JSON.stringify({ features: defaults });
}

function makeJsonWrappedInMarkdown(json: string): string {
  return `Here is the plan:\n\`\`\`json\n${json}\n\`\`\`\nThis should work.`;
}

// ── VAL-ORCH-001: Parses valid MissionPlan JSON ────────────────────────

describe('MissionOrchestrator - VAL-ORCH-001: Parses valid MissionPlan JSON', () => {
  it('parses a simple valid plan with one feature', async () => {
    const planJson = makeValidPlanJson([
      { id: 'f1', description: 'Build login page', files: ['app/login/page.tsx'], type: 'multi_file', dependencies: [] },
    ]);
    const orchestrator = createOrchestrator(makeJsonWrappedInMarkdown(planJson));

    const task = createTaskItem();
    const projectMap = createProjectMap();
    const plan = await orchestrator.plan(task, projectMap);

    expect(plan.features).toHaveLength(1);
    expect(plan.features[0]!.id).toBe('f1');
    expect(plan.features[0]!.description).toBe('Build login page');
    expect(plan.features[0]!.files).toEqual(['app/login/page.tsx']);
    expect(plan.features[0]!.type).toBe('multi_file');
    expect(plan.features[0]!.dependencies).toEqual([]);
  });

  it('parses a plan with multiple features', async () => {
    const planJson = makeValidPlanJson([
      { id: 'f1', description: 'Auth module', files: ['app/auth/page.tsx'], type: 'multi_file', dependencies: [] },
      { id: 'f2', description: 'Dashboard page', files: ['app/dashboard/page.tsx'], type: 'multi_file', dependencies: ['f1'] },
      { id: 'f3', description: 'API routes', files: ['app/api/auth/route.ts'], type: 'multi_file', dependencies: ['f1'] },
    ]);
    const orchestrator = createOrchestrator(makeJsonWrappedInMarkdown(planJson));

    const task = createTaskItem();
    const projectMap = createProjectMap();
    const plan = await orchestrator.plan(task, projectMap);

    expect(plan.features).toHaveLength(3);
    expect(plan.features[0]!.id).toBe('f1');
    expect(plan.features[1]!.id).toBe('f2');
    expect(plan.features[2]!.id).toBe('f3');
  });

  it('rejects feature without id', async () => {
    const planJson = JSON.stringify({
      features: [
        { description: 'Missing ID', files: ['test.ts'], type: 'multi_file', dependencies: [] },
      ],
    });
    const orchestrator = createOrchestrator(makeJsonWrappedInMarkdown(planJson));

    const task = createTaskItem();
    const projectMap = createProjectMap();

    await expect(orchestrator.plan(task, projectMap)).rejects.toThrow();
  });

  it('rejects feature with non-array files', async () => {
    const planJson = JSON.stringify({
      features: [
        { id: 'f1', description: 'Test', files: 'not-an-array', type: 'multi_file', dependencies: [] },
      ],
    });
    const orchestrator = createOrchestrator(makeJsonWrappedInMarkdown(planJson));

    const task = createTaskItem();
    const projectMap = createProjectMap();

    await expect(orchestrator.plan(task, projectMap)).rejects.toThrow();
  });

  it('parses JSON not wrapped in markdown code fences', async () => {
    const planJson = makeValidPlanJson([
      { id: 'f1', description: 'Simple feature', files: ['app/page.tsx'], type: 'multi_file', dependencies: [] },
    ]);
    const orchestrator = createOrchestrator(planJson); // plain JSON, no markdown wrapping

    const task = createTaskItem();
    const projectMap = createProjectMap();
    const plan = await orchestrator.plan(task, projectMap);

    expect(plan.features).toHaveLength(1);
    expect(plan.features[0]!.id).toBe('f1');
  });

  it('parses JSON wrapped in triple-backtick code block without language', async () => {
    const planJson = makeValidPlanJson([
      { id: 'f1', description: 'Test', files: ['test.ts'], type: 'multi_file', dependencies: [] },
    ]);
    // wrap in ``` without json specifier
    const wrapped = '```\n' + planJson + '\n```';
    const orchestrator = createOrchestrator(wrapped);

    const task = createTaskItem();
    const projectMap = createProjectMap();
    const plan = await orchestrator.plan(task, projectMap);

    expect(plan.features).toHaveLength(1);
    expect(plan.features[0]!.id).toBe('f1');
  });

  it('rejects syntactically invalid JSON', async () => {
    // Valid brace structure but broken JSON syntax
    const orchestrator = createOrchestrator('{"features": [}');

    const task = createTaskItem();
    const projectMap = createProjectMap();

    await expect(orchestrator.plan(task, projectMap)).rejects.toThrow();
  });

  it('rejects valid JSON with wrong schema (features not an array)', async () => {
    const orchestrator = createOrchestrator('{"features": "not-an-array"}');

    const task = createTaskItem();
    const projectMap = createProjectMap();

    await expect(orchestrator.plan(task, projectMap)).rejects.toThrow();
  });
});

// ── VAL-ORCH-002: Rejects circular dependencies ────────────────────────

describe('MissionOrchestrator - VAL-ORCH-002: Rejects circular dependencies', () => {
  it('detects simple cycle: f1 -> f2 -> f1', async () => {
    const planJson = makeValidPlanJson([
      { id: 'f1', description: 'A', files: ['a.ts'], type: 'multi_file', dependencies: ['f2'] },
      { id: 'f2', description: 'B', files: ['b.ts'], type: 'multi_file', dependencies: ['f1'] },
    ]);
    const orchestrator = createOrchestrator(makeJsonWrappedInMarkdown(planJson));

    const task = createTaskItem();
    const projectMap = createProjectMap();

    await expect(orchestrator.plan(task, projectMap)).rejects.toThrow(CircularDependencyError);
    try {
      await orchestrator.plan(task, projectMap);
    } catch (err) {
      expect(err).toBeInstanceOf(CircularDependencyError);
      expect((err as CircularDependencyError).cyclePath.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('detects longer cycle: f1 -> f2 -> f3 -> f1', async () => {
    const planJson = makeValidPlanJson([
      { id: 'f1', description: 'A', files: ['a.ts'], type: 'multi_file', dependencies: ['f2'] },
      { id: 'f2', description: 'B', files: ['b.ts'], type: 'multi_file', dependencies: ['f3'] },
      { id: 'f3', description: 'C', files: ['c.ts'], type: 'multi_file', dependencies: ['f1'] },
    ]);
    const orchestrator = createOrchestrator(makeJsonWrappedInMarkdown(planJson));

    const task = createTaskItem();
    const projectMap = createProjectMap();

    await expect(orchestrator.plan(task, projectMap)).rejects.toThrow(CircularDependencyError);
  });

  it('detects self-cycle: f1 -> f1', async () => {
    const planJson = makeValidPlanJson([
      { id: 'f1', description: 'Self-ref', files: ['a.ts'], type: 'multi_file', dependencies: ['f1'] },
    ]);
    const orchestrator = createOrchestrator(makeJsonWrappedInMarkdown(planJson));

    const task = createTaskItem();
    const projectMap = createProjectMap();

    await expect(orchestrator.plan(task, projectMap)).rejects.toThrow(CircularDependencyError);
  });
});

// ── VAL-ORCH-003: Rejects missing dependency references ─────────────────

describe('MissionOrchestrator - VAL-ORCH-003: Rejects missing dependency references', () => {
  it('rejects when feature references non-existent dependency', async () => {
    const planJson = makeValidPlanJson([
      { id: 'f1', description: 'A', files: ['a.ts'], type: 'multi_file', dependencies: ['f99'] },
    ]);
    const orchestrator = createOrchestrator(makeJsonWrappedInMarkdown(planJson));

    const task = createTaskItem();
    const projectMap = createProjectMap();

    await expect(orchestrator.plan(task, projectMap)).rejects.toThrow(MissingDependencyError);
    try {
      await orchestrator.plan(task, projectMap);
    } catch (err) {
      expect(err).toBeInstanceOf(MissingDependencyError);
      expect((err as MissingDependencyError).message).toContain('f99');
    }
  });

  it('rejects when multiple features reference missing dependency', async () => {
    const planJson = makeValidPlanJson([
      { id: 'f1', description: 'A', files: ['a.ts'], type: 'multi_file', dependencies: ['f99'] },
      { id: 'f2', description: 'B', files: ['b.ts'], type: 'multi_file', dependencies: ['f88'] },
    ]);
    const orchestrator = createOrchestrator(makeJsonWrappedInMarkdown(planJson));

    const task = createTaskItem();
    const projectMap = createProjectMap();

    // Should reject on first missing dependency
    await expect(orchestrator.plan(task, projectMap)).rejects.toThrow(MissingDependencyError);
  });
});

// ── VAL-ORCH-004: Rejects path traversal ──────────────────────────────

describe('MissionOrchestrator - VAL-ORCH-004: Rejects path traversal', () => {
  it('strips ../ segments from file paths', async () => {
    const planJson = makeValidPlanJson([
      {
        id: 'f1',
        description: 'Path traversal',
        files: ['../../../etc/passwd'],
        type: 'multi_file',
        dependencies: [],
      },
    ]);
    const orchestrator = createOrchestrator(makeJsonWrappedInMarkdown(planJson));

    const task = createTaskItem();
    const projectMap = createProjectMap();
    const plan = await orchestrator.plan(task, projectMap);

    // Path should be sanitized - should not contain ../
    expect(plan.features).toHaveLength(1);
    const sanitized = plan.features[0]!.files[0]!;
    expect(sanitized).not.toContain('..');
    // Should resolve to a project-relative path
    expect(sanitized.startsWith('/')).toBe(false);
  });

  it('strips leading / from absolute paths to make them project-relative', async () => {
    const planJson = makeValidPlanJson([
      {
        id: 'f1',
        description: 'Absolute path',
        files: ['/etc/hosts'],
        type: 'multi_file',
        dependencies: [],
      },
    ]);
    const orchestrator = createOrchestrator(makeJsonWrappedInMarkdown(planJson));

    const task = createTaskItem();
    const projectMap = createProjectMap();
    const plan = await orchestrator.plan(task, projectMap);

    expect(plan.features).toHaveLength(1);
    const sanitized = plan.features[0]!.files[0]!;
    expect(sanitized.startsWith('/')).toBe(false);
  });

  it('handles complex traversal attempts with multiple ../', async () => {
    const planJson = makeValidPlanJson([
      {
        id: 'f1',
        description: 'Complex traversal',
        files: ['a/../../b/../../../etc/shadow'],
        type: 'multi_file',
        dependencies: [],
      },
    ]);
    const orchestrator = createOrchestrator(makeJsonWrappedInMarkdown(planJson));

    const task = createTaskItem();
    const projectMap = createProjectMap();
    const plan = await orchestrator.plan(task, projectMap);

    expect(plan.features).toHaveLength(1);
    const sanitized = plan.features[0]!.files[0]!;
    expect(sanitized).not.toContain('..');
  });

  it('keeps valid project-relative paths unchanged', async () => {
    const planJson = makeValidPlanJson([
      {
        id: 'f1',
        description: 'Valid paths',
        files: ['app/login/page.tsx', 'components/Form.tsx'],
        type: 'multi_file',
        dependencies: [],
      },
    ]);
    const orchestrator = createOrchestrator(makeJsonWrappedInMarkdown(planJson));

    const task = createTaskItem();
    const projectMap = createProjectMap();
    const plan = await orchestrator.plan(task, projectMap);

    expect(plan.features).toHaveLength(1);
    expect(plan.features[0]!.files).toEqual(['app/login/page.tsx', 'components/Form.tsx']);
  });
});

// ── VAL-ORCH-005: Topologically sorts features ────────────────────────

describe('MissionOrchestrator - VAL-ORCH-005: Topologically sorts features', () => {
  it('puts independent features before their dependents', async () => {
    // f1 has no deps, f2 depends on f1
    const planJson = makeValidPlanJson([
      { id: 'f2', description: 'Dashboard', files: ['app/dashboard/page.tsx'], type: 'multi_file', dependencies: ['f1'] },
      { id: 'f1', description: 'Auth module', files: ['app/auth/page.tsx'], type: 'multi_file', dependencies: [] },
    ]);
    const orchestrator = createOrchestrator(makeJsonWrappedInMarkdown(planJson));

    const task = createTaskItem();
    const projectMap = createProjectMap();
    const plan = await orchestrator.plan(task, projectMap);

    expect(plan.features).toHaveLength(2);
    // f1 must come before f2 since f2 depends on f1
    const f1Index = plan.features.findIndex((f) => f.id === 'f1');
    const f2Index = plan.features.findIndex((f) => f.id === 'f2');
    expect(f1Index).toBeLessThan(f2Index);
  });

  it('respects partial ordering: multiple dependents after their dependency', async () => {
    const planJson = makeValidPlanJson([
      { id: 'f3', description: 'API routes', files: ['app/api/route.ts'], type: 'multi_file', dependencies: ['f1'] },
      { id: 'f2', description: 'Dashboard', files: ['app/dashboard/page.tsx'], type: 'multi_file', dependencies: ['f1'] },
      { id: 'f1', description: 'Auth module', files: ['app/auth/page.tsx'], type: 'multi_file', dependencies: [] },
    ]);
    const orchestrator = createOrchestrator(makeJsonWrappedInMarkdown(planJson));

    const task = createTaskItem();
    const projectMap = createProjectMap();
    const plan = await orchestrator.plan(task, projectMap);

    expect(plan.features).toHaveLength(3);
    const f1Index = plan.features.findIndex((f) => f.id === 'f1');
    const f2Index = plan.features.findIndex((f) => f.id === 'f2');
    const f3Index = plan.features.findIndex((f) => f.id === 'f3');
    // f1 must be before f2 and f3
    expect(f1Index).toBeLessThan(f2Index);
    expect(f1Index).toBeLessThan(f3Index);
  });

  it('handles chain dependency: f3 -> f2 -> f1', async () => {
    const planJson = makeValidPlanJson([
      { id: 'f3', description: 'UI', files: ['app/ui.tsx'], type: 'multi_file', dependencies: ['f2'] },
      { id: 'f1', description: 'Data model', files: ['app/model.ts'], type: 'multi_file', dependencies: [] },
      { id: 'f2', description: 'Service layer', files: ['app/service.ts'], type: 'multi_file', dependencies: ['f1'] },
    ]);
    const orchestrator = createOrchestrator(makeJsonWrappedInMarkdown(planJson));

    const task = createTaskItem();
    const projectMap = createProjectMap();
    const plan = await orchestrator.plan(task, projectMap);

    expect(plan.features).toHaveLength(3);
    const f1Index = plan.features.findIndex((f) => f.id === 'f1');
    const f2Index = plan.features.findIndex((f) => f.id === 'f2');
    const f3Index = plan.features.findIndex((f) => f.id === 'f3');
    expect(f1Index).toBeLessThan(f2Index);
    expect(f2Index).toBeLessThan(f3Index);
  });

  it('handles independent features (no deps between them) in any order', async () => {
    const planJson = makeValidPlanJson([
      { id: 'f1', description: 'A', files: ['a.ts'], type: 'multi_file', dependencies: [] },
      { id: 'f2', description: 'B', files: ['b.ts'], type: 'multi_file', dependencies: [] },
      { id: 'f3', description: 'C', files: ['c.ts'], type: 'multi_file', dependencies: [] },
    ]);
    const orchestrator = createOrchestrator(makeJsonWrappedInMarkdown(planJson));

    const task = createTaskItem();
    const projectMap = createProjectMap();
    const plan = await orchestrator.plan(task, projectMap);

    expect(plan.features).toHaveLength(3);
    const ids = plan.features.map((f) => f.id).sort();
    expect(ids).toEqual(['f1', 'f2', 'f3']);
  });

  it('returns empty plan when there are no features', async () => {
    const planJson = JSON.stringify({ features: [] });
    const orchestrator = createOrchestrator(makeJsonWrappedInMarkdown(planJson));

    const task = createTaskItem();
    const projectMap = createProjectMap();
    const plan = await orchestrator.plan(task, projectMap);

    expect(plan.features).toHaveLength(0);
  });
});

// ── VAL-ORCH-006: Prompt includes project context ──────────────────────

describe('MissionOrchestrator - VAL-ORCH-006: Prompt includes project context', () => {
  it('includes task description in the prompt', async () => {
    const planJson = makeValidPlanJson([
      { id: 'f1', description: 'Test', files: ['test.ts'], type: 'multi_file', dependencies: [] },
    ]);
    const llmClient = createMockLlmClient(makeJsonWrappedInMarkdown(planJson));
    const orchestrator = new MissionOrchestrator(llmClient, 'claude-opus-4-6');

    const task = createTaskItem({ description: 'Build a user registration system' });
    const projectMap = createProjectMap();
    await orchestrator.plan(task, projectMap);

    // Check that the prompt contained the task description
    const chatCall = (llmClient.chat as ReturnType<typeof vi.fn>).mock.calls[0] as [Message[], LlmOptions | undefined];
    const messages = chatCall[0];
    const userMessage = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).toContain('Build a user registration system');
  });

  it('includes ProjectMap framework name', async () => {
    const planJson = makeValidPlanJson([
      { id: 'f1', description: 'Test', files: ['test.ts'], type: 'multi_file', dependencies: [] },
    ]);
    const llmClient = createMockLlmClient(makeJsonWrappedInMarkdown(planJson));
    const orchestrator = new MissionOrchestrator(llmClient, 'claude-opus-4-6');

    const task = createTaskItem();
    const projectMap = createProjectMap({ stack: { framework: 'next.js', language: 'typescript', typescript: true } });
    await orchestrator.plan(task, projectMap);

    const chatCall = (llmClient.chat as ReturnType<typeof vi.fn>).mock.calls[0] as [Message[], LlmOptions | undefined];
    const messages = chatCall[0];
    const userMessage = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).toContain('next.js');
  });

  it('includes route paths in the prompt', async () => {
    const planJson = makeValidPlanJson([
      { id: 'f1', description: 'Test', files: ['test.ts'], type: 'multi_file', dependencies: [] },
    ]);
    const llmClient = createMockLlmClient(makeJsonWrappedInMarkdown(planJson));
    const orchestrator = new MissionOrchestrator(llmClient, 'claude-opus-4-6');

    const task = createTaskItem();
    const projectMap = createProjectMap();
    await orchestrator.plan(task, projectMap);

    const chatCall = (llmClient.chat as ReturnType<typeof vi.fn>).mock.calls[0] as [Message[], LlmOptions | undefined];
    const messages = chatCall[0];
    const userMessage = messages.find((m) => m.role === 'user')?.content ?? '';
    // Should mention the route paths from createProjectMap
    expect(userMessage).toContain('/dashboard');
    expect(userMessage).toContain('/api/users');
  });

  it('includes existing file list', async () => {
    const planJson = makeValidPlanJson([
      { id: 'f1', description: 'Test', files: ['test.ts'], type: 'multi_file', dependencies: [] },
    ]);
    const llmClient = createMockLlmClient(makeJsonWrappedInMarkdown(planJson));
    const orchestrator = new MissionOrchestrator(llmClient, 'claude-opus-4-6');

    const task = createTaskItem();
    const projectMap = createProjectMap();
    await orchestrator.plan(task, projectMap);

    const chatCall = (llmClient.chat as ReturnType<typeof vi.fn>).mock.calls[0] as [Message[], LlmOptions | undefined];
    const messages = chatCall[0];
    const userMessage = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).toContain('app/page.tsx');
    expect(userMessage).toContain('app/layout.tsx');
  });

  it('uses the orchestrator model name in the LLM call', async () => {
    const planJson = makeValidPlanJson([
      { id: 'f1', description: 'Test', files: ['test.ts'], type: 'multi_file', dependencies: [] },
    ]);
    const llmClient = createMockLlmClient(makeJsonWrappedInMarkdown(planJson));
    const orchestrator = new MissionOrchestrator(llmClient, 'gpt-5-orchestrator');

    const task = createTaskItem();
    const projectMap = createProjectMap();
    await orchestrator.plan(task, projectMap);

    const chatCall = (llmClient.chat as ReturnType<typeof vi.fn>).mock.calls[0] as [Message[], LlmOptions | undefined];
    const options = chatCall[1];
    expect(options?.model).toBe('gpt-5-orchestrator');
  });

  it('includes package dependencies in the prompt', async () => {
    const planJson = makeValidPlanJson([
      { id: 'f1', description: 'Test', files: ['test.ts'], type: 'multi_file', dependencies: [] },
    ]);
    const llmClient = createMockLlmClient(makeJsonWrappedInMarkdown(planJson));
    const orchestrator = new MissionOrchestrator(llmClient, 'claude-opus-4-6');

    const task = createTaskItem();
    const projectMap = createProjectMap();
    await orchestrator.plan(task, projectMap);

    const chatCall = (llmClient.chat as ReturnType<typeof vi.fn>).mock.calls[0] as [Message[], LlmOptions | undefined];
    const messages = chatCall[0];
    const userMessage = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userMessage).toContain('next');
    expect(userMessage).toContain('react');
    expect(userMessage).toContain('tailwindcss');
  });
});

// ── VAL-ORCH-007: Handles empty LLM response ──────────────────────────

describe('MissionOrchestrator - VAL-ORCH-007: Handles empty LLM response', () => {
  it('returns empty plan when LLM returns empty string', async () => {
    const llmClient = createMockLlmClient('');
    const orchestrator = new MissionOrchestrator(llmClient, 'claude-opus-4-6');

    const task = createTaskItem();
    const projectMap = createProjectMap();
    const plan = await orchestrator.plan(task, projectMap);

    expect(plan.features).toEqual([]);
  });

  it('returns empty plan when LLM returns only whitespace', async () => {
    const llmClient = createMockLlmClient('   \n  \t  ');
    const orchestrator = new MissionOrchestrator(llmClient, 'claude-opus-4-6');

    const task = createTaskItem();
    const projectMap = createProjectMap();
    const plan = await orchestrator.plan(task, projectMap);

    expect(plan.features).toEqual([]);
  });

  it('throws when LLM response has content but no parseable JSON', async () => {
    const llmClient = createMockLlmClient('I cannot process this request right now. Please try again later.');
    const orchestrator = new MissionOrchestrator(llmClient, 'claude-opus-4-6');

    const task = createTaskItem();
    const projectMap = createProjectMap();

    await expect(orchestrator.plan(task, projectMap)).rejects.toThrow();
  });
});

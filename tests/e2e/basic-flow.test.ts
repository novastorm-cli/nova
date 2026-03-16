import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { LlmClient, Observation, ProjectMap, Message } from '../../packages/core/src/models/types.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const FIXTURE_DIR = path.join(ROOT, 'tests', 'fixtures', 'nextjs-app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'nova-e2e-'));
}

function createMockLlmClient(response: string): LlmClient {
  return {
    chat: vi.fn(async () => response),
    chatWithVision: vi.fn(async () => response),
    stream: vi.fn(),
  };
}

function createObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    screenshot: Buffer.from('fake-screenshot-png'),
    currentUrl: '/',
    transcript: 'add a search input',
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Basic flow — core pipeline integration', () => {
  const tmpDirs: string[] = [];

  function getTmp(): string {
    const dir = makeTmp();
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    tmpDirs.length = 0;
  });

  // ── 1. ProjectIndexer on nextjs-app fixture ─────────────────

  it('ProjectIndexer produces a ProjectMap with routes, components, endpoints', async () => {
    const { ProjectIndexer } = await import(
      '../../packages/core/src/indexer/ProjectIndexer.js'
    );

    const tmp = getTmp();
    cpSync(FIXTURE_DIR, tmp, { recursive: true });

    const indexer = new ProjectIndexer();
    const map: ProjectMap = await indexer.index(tmp);

    expect(map.stack.framework).toBe('next.js');
    expect(map.routes.length).toBeGreaterThan(0);
    expect(map.endpoints.length).toBeGreaterThan(0);
    // The fixture has app/page.tsx
    expect(map.routes.some((r) => r.path === '/')).toBe(true);
    // The fixture has app/api/users/route.ts
    expect(map.endpoints.some((e) => e.path === '/api/users')).toBe(true);
  });

  // ── 2. NovaDir initialization ───────────────────────────────

  it('NovaDir.init() creates .nova directory structure', async () => {
    const { NovaDir } = await import(
      '../../packages/core/src/storage/NovaDir.js'
    );
    const { existsSync } = await import('node:fs');

    const tmp = getTmp();
    const novaDir = new NovaDir();

    await novaDir.init(tmp);

    expect(novaDir.exists(tmp)).toBe(true);
    expect(existsSync(path.join(tmp, '.nova', 'recipes'))).toBe(true);
    expect(existsSync(path.join(tmp, '.nova', 'history'))).toBe(true);
    expect(existsSync(path.join(tmp, '.nova', 'cache'))).toBe(true);
    expect(existsSync(path.join(tmp, '.nova', 'graph.json'))).toBe(true);
  });

  // ── 3. Brain.analyze() with mock LLM ───────────────────────

  it('Brain.analyze() creates tasks with correct lanes', async () => {
    const { Brain } = await import(
      '../../packages/core/src/brain/Brain.js'
    );

    const llmResponse = JSON.stringify([
      {
        description: 'Change header color to blue',
        files: ['app/page.tsx'],
        type: 'css',
      },
      {
        description: 'Add search input component',
        files: ['app/page.tsx', 'components/SearchInput.tsx'],
        type: 'multi_file',
      },
      {
        description: 'Refactor entire layout system',
        files: ['app/layout.tsx', 'components/Nav.tsx', 'components/Footer.tsx'],
        type: 'refactor',
      },
    ]);

    const llm = createMockLlmClient(llmResponse);
    const brain = new Brain(llm);

    const observation = createObservation();
    const projectMap: ProjectMap = {
      stack: { framework: 'next.js', language: 'typescript', packageManager: 'npm', typescript: true },
      devCommand: 'npm run dev',
      port: 3000,
      routes: [{ path: '/', filePath: 'app/page.tsx', type: 'page' }],
      components: [],
      endpoints: [],
      models: [],
      dependencies: new Map(),
      fileContexts: new Map(),
      compressedContext: 'Next.js app',
    };

    const tasks = await brain.analyze(observation, projectMap);

    expect(tasks).toHaveLength(3);

    // Task 1: CSS-only, single file => lane 1
    expect(tasks[0].lane).toBe(1);
    expect(tasks[0].status).toBe('pending');

    // Task 2: multi_file, 2 files => lane 3 (multiple files, non-style)
    expect(tasks[1].lane).toBe(3);

    // Task 3: "refactor" keyword => lane 4
    expect(tasks[2].lane).toBe(4);
  });

  // ── 4. LaneClassifier on various inputs ─────────────────────

  it('LaneClassifier assigns correct lanes', async () => {
    const { LaneClassifier } = await import(
      '../../packages/core/src/brain/LaneClassifier.js'
    );

    const classifier = new LaneClassifier();

    // Lane 1: style keyword, single file, no "add"/"create"/"new"
    expect(classifier.classify('change color to blue', ['file.tsx'])).toBe(1);

    // Lane 2: single file, non-style
    expect(classifier.classify('fix the login button', ['file.tsx'])).toBe(2);

    // Lane 3: multi-file non-style
    expect(classifier.classify('update logic', ['a.ts', 'b.ts'])).toBe(3);

    // Lane 3: explicit pattern
    expect(classifier.classify('add a new page for settings', ['pages/settings.tsx'])).toBe(3);

    // Lane 4: refactor keyword
    expect(classifier.classify('refactor the auth module', ['auth.ts'])).toBe(4);
  });

  // ── 5. DiffApplier: generate + apply ────────────────────────

  it('DiffApplier generates a diff and applies it correctly', async () => {
    const { DiffApplier } = await import(
      '../../packages/core/src/executor/DiffApplier.js'
    );

    const tmp = getTmp();
    const filePath = path.join(tmp, 'test.tsx');
    const before = 'function hello() {\n  return "world";\n}';
    const after = 'function hello() {\n  return "universe";\n}';

    writeFileSync(filePath, before, 'utf-8');

    const applier = new DiffApplier();
    const diff = applier.generate(before, after, 'test.tsx');

    expect(diff).toContain('-  return "world";');
    expect(diff).toContain('+  return "universe";');

    await applier.apply(filePath, diff);

    const result = readFileSync(filePath, 'utf-8');
    expect(result).toBe(after);
  });

  // ── 6. ContextDistiller output ──────────────────────────────

  it('ContextDistiller produces non-empty output under 3000 chars', async () => {
    const { ContextDistiller } = await import(
      '../../packages/core/src/indexer/ContextDistiller.js'
    );

    const projectMap: ProjectMap = {
      stack: { framework: 'next.js', language: 'typescript', packageManager: 'pnpm', typescript: true },
      devCommand: 'pnpm dev',
      port: 3000,
      routes: [
        { path: '/', filePath: 'app/page.tsx', type: 'page' },
        { path: '/about', filePath: 'app/about/page.tsx', type: 'page' },
      ],
      components: [
        { name: 'Header', filePath: 'components/Header.tsx', type: 'component', exports: ['Header'] },
        { name: 'Footer', filePath: 'components/Footer.tsx', type: 'component', exports: ['Footer'] },
      ],
      endpoints: [
        { method: 'GET', path: '/api/users', filePath: 'app/api/users/route.ts' },
        { method: 'POST', path: '/api/users', filePath: 'app/api/users/route.ts' },
      ],
      models: [
        { name: 'User', filePath: 'models/user.ts', fields: ['id', 'name', 'email'] },
      ],
      dependencies: new Map(),
      fileContexts: new Map(),
      compressedContext: '',
    };

    const distiller = new ContextDistiller();
    const output = distiller.distill(projectMap);

    expect(output.length).toBeGreaterThan(0);
    expect(output.length).toBeLessThan(3000);
    expect(output).toContain('next.js');
    expect(output).toContain('/api/users');
  });
});

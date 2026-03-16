import { describe, it, expect } from 'vitest';
import type { Observation, ProjectMap, TaskItem, Message } from '../../models/types.js';

// ── Mock data ──────────────────────────────────────────────────

function createObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    screenshot: Buffer.from('fake-screenshot-png'),
    currentUrl: '/dashboard',
    transcript: 'Make the header blue and add a search bar',
    timestamp: Date.now(),
    ...overrides,
  };
}

function createProjectMap(overrides: Partial<ProjectMap> = {}): ProjectMap {
  return {
    stack: {
      framework: 'next.js',
      language: 'typescript',
      packageManager: 'npm',
      typescript: true,
    },
    devCommand: 'npm run dev',
    port: 3000,
    routes: [
      { path: '/dashboard', filePath: 'app/dashboard/page.tsx', type: 'page' },
    ],
    components: [],
    endpoints: [],
    models: [],
    dependencies: new Map(),
    fileContexts: new Map(),
    compressedContext: 'Project: Next.js dashboard app with TypeScript and Tailwind',
    ...overrides,
  };
}

function createTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'task-1',
    description: 'Add user management page with API endpoint',
    files: ['app/users/page.tsx', 'app/api/users/route.ts'],
    type: 'multi_file',
    lane: 3,
    status: 'pending',
    ...overrides,
  };
}

// ── Helper ─────────────────────────────────────────────────────

function allContent(messages: Message[]): string {
  return messages.map((m) => m.content).join('\n');
}

// ── Tests ──────────────────────────────────────────────────────

const { PromptBuilder } = await import('../PromptBuilder.js');

describe('PromptBuilder', () => {
  const builder = new PromptBuilder();

  // ── buildAnalysisPrompt ────────────────────────────────────

  describe('buildAnalysisPrompt()', () => {
    it('messages contain transcript and compressedContext', () => {
      const observation = createObservation({
        transcript: 'Change the sidebar color to dark blue',
      });
      const projectMap = createProjectMap({
        compressedContext: 'Next.js 14 app with App Router',
      });

      const messages = builder.buildAnalysisPrompt(observation, projectMap);

      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBeGreaterThan(0);

      const joined = allContent(messages);
      expect(joined).toContain('Change the sidebar color to dark blue');
      expect(joined).toContain('Next.js 14 app with App Router');
    });

    it('messages contain domSnapshot if present', () => {
      const domHtml = '<div id="root"><header class="bg-white">Dashboard</header></div>';
      const observation = createObservation({ domSnapshot: domHtml });
      const projectMap = createProjectMap();

      const messages = builder.buildAnalysisPrompt(observation, projectMap);
      const joined = allContent(messages);

      expect(joined).toContain(domHtml);
    });

    it('messages do NOT contain domSnapshot when absent', () => {
      const observation = createObservation({ domSnapshot: undefined });
      const projectMap = createProjectMap();

      const messages = builder.buildAnalysisPrompt(observation, projectMap);
      const joined = allContent(messages);

      // Should still produce valid messages without domSnapshot
      expect(messages.length).toBeGreaterThan(0);
      // Ensure no placeholder leaks through
      expect(joined).not.toContain('undefined');
    });

    it('messages have valid roles', () => {
      const messages = builder.buildAnalysisPrompt(createObservation(), createProjectMap());

      for (const msg of messages) {
        expect(['system', 'user', 'assistant']).toContain(msg.role);
        expect(msg.content).toBeTruthy();
      }
    });
  });

  // ── buildDecomposePrompt ───────────────────────────────────

  describe('buildDecomposePrompt()', () => {
    it('messages contain task description and file list', () => {
      const task = createTask({
        description: 'Add user management page with API endpoint',
        files: ['app/users/page.tsx', 'app/api/users/route.ts'],
      });
      const projectMap = createProjectMap();

      const messages = builder.buildDecomposePrompt(task, projectMap);

      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBeGreaterThan(0);

      const joined = allContent(messages);
      expect(joined).toContain('Add user management page with API endpoint');
      expect(joined).toContain('app/users/page.tsx');
      expect(joined).toContain('app/api/users/route.ts');
    });

    it('messages have valid roles', () => {
      const messages = builder.buildDecomposePrompt(createTask(), createProjectMap());

      for (const msg of messages) {
        expect(['system', 'user', 'assistant']).toContain(msg.role);
        expect(msg.content).toBeTruthy();
      }
    });
  });
});

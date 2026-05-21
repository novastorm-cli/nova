import { describe, it, expect, vi } from 'vitest';
import type { TaskItem, MissionPlan, MissionFeature, FeatureResult, Message, ChatResponse } from '../../models/types.js';
import type { LlmClient } from '../../contracts/ILlmClient.js';
import { MissionDirector } from '../MissionDirector.js';

// ── Helpers ───────────────────────────────────────────────────────────

function createTaskItem(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    id: 'task-dir-1',
    description: 'Build a login page with form validation',
    files: ['app/login/page.tsx'],
    type: 'multi_file',
    lane: 5,
    status: 'pending',
    ...overrides,
  };
}

function createPlan(features: Partial<MissionFeature>[]): MissionPlan {
  return {
    features: features.map((f, i) => ({
      id: f.id ?? `feat-${i + 1}`,
      description: f.description ?? `Feature ${i + 1}`,
      files: f.files ?? [`file-${i + 1}.ts`],
      type: f.type ?? 'multi_file',
      dependencies: f.dependencies ?? [],
    })),
  };
}

function createSuccessResult(featureId: string, overrides: Partial<FeatureResult> = {}): FeatureResult {
  return {
    success: true,
    featureId,
    diff: `+++ ${featureId}.ts`,
    generatedFiles: [{ path: `${featureId}.ts`, content: '// generated' }],
    ...overrides,
  };
}

function createFailedResult(featureId: string, overrides: Partial<FeatureResult> = {}): FeatureResult {
  return {
    success: false,
    featureId,
    error: 'Implementation error',
    ...overrides,
  };
}

function createMockLlmClient(responseText?: string): LlmClient {
  return {
    chat: vi.fn().mockResolvedValue({
      content: responseText ?? '',
    } as ChatResponse),
    chatStream: vi.fn(),
  } as unknown as LlmClient;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('MissionDirector', () => {
  // VAL-ORCH-020: Director reviews all feature results and returns structured verdict
  describe('review() - structured verdict (VAL-ORCH-020)', () => {
    it('returns APPROVED when all features pass', async () => {
      const mockLlm = createMockLlmClient(
        JSON.stringify({ decision: 'APPROVED', feedback: [] }),
      );
      const director = new MissionDirector(mockLlm, 'claude-opus-4-6');
      const task = createTaskItem();
      const plan = createPlan([
        { id: 'f1', description: 'Login page' },
        { id: 'f2', description: 'API route' },
      ]);
      const results: Record<string, FeatureResult> = {
        f1: createSuccessResult('f1'),
        f2: createSuccessResult('f2'),
      };

      const verdict = await director.review(task, plan, results);

      expect(verdict.decision).toBe('APPROVED');
      expect(verdict.feedback).toEqual([]);
    });

    it('returns NEEDS_REVISION when features have errors', async () => {
      const mockLlm = createMockLlmClient(
        JSON.stringify({
          decision: 'NEEDS_REVISION',
          feedback: [
            {
              featureId: 'f2',
              actionItems: ['fix type error in login.ts'],
            },
          ],
        }),
      );
      const director = new MissionDirector(mockLlm, 'claude-opus-4-6');
      const task = createTaskItem();
      const plan = createPlan([
        { id: 'f1', description: 'Login page' },
        { id: 'f2', description: 'API route' },
      ]);
      const results: Record<string, FeatureResult> = {
        f1: createSuccessResult('f1'),
        f2: createFailedResult('f2', {
          validationErrors: [{ file: 'login.ts', line: 42, message: 'Type error' }],
        }),
      };

      const verdict = await director.review(task, plan, results);

      expect(verdict.decision).toBe('NEEDS_REVISION');
      expect(verdict.feedback).toHaveLength(1);
      expect(verdict.feedback[0]!.featureId).toBe('f2');
      expect(verdict.feedback[0]!.actionItems).toEqual(['fix type error in login.ts']);
    });

    it('parses LLM response from inside markdown code fences', async () => {
      const mockLlm = createMockLlmClient(
        '```json\n{"decision": "APPROVED", "feedback": []}\n```',
      );
      const director = new MissionDirector(mockLlm, 'claude-opus-4-6');
      const task = createTaskItem();
      const plan = createPlan([{ id: 'f1' }]);
      const results: Record<string, FeatureResult> = { f1: createSuccessResult('f1') };

      const verdict = await director.review(task, plan, results);

      expect(verdict.decision).toBe('APPROVED');
    });

    it('builds prompt with task description, plan, and all feature results', async () => {
      const mockLlm = createMockLlmClient(
        JSON.stringify({ decision: 'APPROVED', feedback: [] }),
      );
      const director = new MissionDirector(mockLlm, 'claude-opus-4-6');
      const task = createTaskItem();
      const plan = createPlan([
        { id: 'f1', description: 'Login page', files: ['app/login/page.tsx'] },
      ]);
      const results: Record<string, FeatureResult> = {
        f1: createSuccessResult('f1', {
          diff: '+++ app/login/page.tsx',
          generatedFiles: [{ path: 'app/login/page.tsx', content: '// code' }],
        }),
      };

      await director.review(task, plan, results);

      // Verify the LLM was called with relevant context
      expect(mockLlm.chat).toHaveBeenCalledTimes(1);

      const callArgs = (mockLlm.chat as ReturnType<typeof vi.fn>).mock.calls[0] as [Message[], unknown];
      const messages = callArgs[0];
      const promptContent = messages[0]!.content;

      // Prompt should contain task, plan features, and results
      expect(promptContent).toContain('Build a login page');
      expect(promptContent).toContain('f1');
      expect(promptContent).toContain('app/login/page.tsx');
      expect(promptContent).toContain('SUCCESS');
    });

    it('uses the director model (not standard)', async () => {
      const mockLlm = createMockLlmClient(
        JSON.stringify({ decision: 'APPROVED', feedback: [] }),
      );
      const director = new MissionDirector(mockLlm, 'gpt-5-director');
      const task = createTaskItem();
      const plan = createPlan([{ id: 'f1' }]);
      const results: Record<string, FeatureResult> = { f1: createSuccessResult('f1') };

      await director.review(task, plan, results);

      const callArgs = (mockLlm.chat as ReturnType<typeof vi.fn>).mock.calls[0] as [Message[], unknown];
      const options = callArgs[1] as { model?: string };
      expect(options.model).toBe('gpt-5-director');
    });
  });

  // VAL-ORCH-021: Director returns NEEDS_REVISION with per-feature action items
  describe('NEEDS_REVISION with action items (VAL-ORCH-021)', () => {
    it('includes per-feature action items in NEEDS_REVISION feedback', async () => {
      const mockLlm = createMockLlmClient(
        JSON.stringify({
          decision: 'NEEDS_REVISION',
          feedback: [
            { featureId: 'f1', actionItems: ['Add error handling'] },
            { featureId: 'f3', actionItems: ['Fix import path', 'Add type annotation'] },
          ],
        }),
      );
      const director = new MissionDirector(mockLlm, 'claude-opus-4-6');
      const task = createTaskItem();
      const plan = createPlan([
        { id: 'f1' },
        { id: 'f2' },
        { id: 'f3' },
      ]);
      const results: Record<string, FeatureResult> = {
        f1: createFailedResult('f1'),
        f2: createSuccessResult('f2'),
        f3: createFailedResult('f3'),
      };

      const verdict = await director.review(task, plan, results);

      expect(verdict.decision).toBe('NEEDS_REVISION');
      expect(verdict.feedback).toHaveLength(2);
      expect(verdict.feedback[0]!.featureId).toBe('f1');
      expect(verdict.feedback[0]!.actionItems).toEqual(['Add error handling']);
      expect(verdict.feedback[1]!.featureId).toBe('f3');
      expect(verdict.feedback[1]!.actionItems).toEqual([
        'Fix import path',
        'Add type annotation',
      ]);
    });

    it('only includes feedback for features that need changes', async () => {
      const mockLlm = createMockLlmClient(
        JSON.stringify({
          decision: 'NEEDS_REVISION',
          feedback: [{ featureId: 'f2', actionItems: ['Fix the type error'] }],
        }),
      );
      const director = new MissionDirector(mockLlm, 'claude-opus-4-6');
      const task = createTaskItem();
      const plan = createPlan([{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }]);
      const results: Record<string, FeatureResult> = {
        f1: createSuccessResult('f1'),
        f2: createFailedResult('f2'),
        f3: createSuccessResult('f3'),
      };

      const verdict = await director.review(task, plan, results);

      expect(verdict.feedback).toHaveLength(1);
      // Only f2 was mentioned - f1 and f3 are not in feedback
      expect(verdict.feedback.map((f) => f.featureId)).not.toContain('f1');
      expect(verdict.feedback.map((f) => f.featureId)).not.toContain('f3');
    });

    it('maps action items to specific feature IDs', async () => {
      const mockLlm = createMockLlmClient(
        JSON.stringify({
          decision: 'NEEDS_REVISION',
          feedback: [
            {
              featureId: 'auth-module',
              actionItems: [
                'Add password hashing to auth.ts',
                'Implement session validation',
              ],
            },
          ],
        }),
      );
      const director = new MissionDirector(mockLlm, 'claude-opus-4-6');
      const task = createTaskItem();
      const plan = createPlan([{ id: 'auth-module' }]);
      const results: Record<string, FeatureResult> = {
        'auth-module': createFailedResult('auth-module'),
      };

      const verdict = await director.review(task, plan, results);

      expect(verdict.feedback[0]!.featureId).toBe('auth-module');
      expect(verdict.feedback[0]!.actionItems).toHaveLength(2);
    });
  });

  // VAL-ORCH-022: Director loop respects maxIterations cap (default 5)
  // This is tested at the Lane5Executor level - the director itself just returns verdicts
  // But we verify the director returns consistent verdicts for the loop to respect
  describe('director verdict consistency for loop (VAL-ORCH-022)', () => {
    it('repeatedly returns NEEDS_REVISION when errors persist', async () => {
      const mockLlm = createMockLlmClient(
        JSON.stringify({
          decision: 'NEEDS_REVISION',
          feedback: [{ featureId: 'f1', actionItems: ['Still broken'] }],
        }),
      );
      const director = new MissionDirector(mockLlm, 'claude-opus-4-6');
      const task = createTaskItem();
      const plan = createPlan([{ id: 'f1' }]);
      const results: Record<string, FeatureResult> = {
        f1: createFailedResult('f1'),
      };

      // Call review multiple times - each should return NEEDS_REVISION
      const v1 = await director.review(task, plan, results);
      const v2 = await director.review(task, plan, results);
      const v3 = await director.review(task, plan, results);

      expect(v1.decision).toBe('NEEDS_REVISION');
      expect(v2.decision).toBe('NEEDS_REVISION');
      expect(v3.decision).toBe('NEEDS_REVISION');
    });

    it('eventually returns APPROVED when errors are fixed', async () => {
      let callCount = 0;
      const mockLlm: LlmClient = {
        chat: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount >= 3) {
            return { content: JSON.stringify({ decision: 'APPROVED', feedback: [] }) } as ChatResponse;
          }
          return {
            content: JSON.stringify({
              decision: 'NEEDS_REVISION',
              feedback: [{ featureId: 'f1', actionItems: ['Fix error'] }],
            }),
          } as ChatResponse;
        }),
        chatStream: vi.fn(),
      } as unknown as LlmClient;

      const director = new MissionDirector(mockLlm, 'claude-opus-4-6');
      const task = createTaskItem();
      const plan = createPlan([{ id: 'f1' }]);
      const results: Record<string, FeatureResult> = {
        f1: createSuccessResult('f1'),
      };

      const v1 = await director.review(task, plan, results);
      const v2 = await director.review(task, plan, results);
      const v3 = await director.review(task, plan, results);

      expect(v1.decision).toBe('NEEDS_REVISION');
      expect(v2.decision).toBe('NEEDS_REVISION');
      expect(v3.decision).toBe('APPROVED');
    });
  });

  // VAL-ORCH-023: Director handles malformed LLM verdict response
  describe('malformed verdict handling (VAL-ORCH-023)', () => {
    it('treats plain text response as NEEDS_REVISION (fail-safe)', async () => {
      const mockLlm = createMockLlmClient('looks good to me');
      const director = new MissionDirector(mockLlm, 'claude-opus-4-6');
      const task = createTaskItem();
      const plan = createPlan([{ id: 'f1' }]);
      const results: Record<string, FeatureResult> = { f1: createSuccessResult('f1') };

      const verdict = await director.review(task, plan, results);

      // Should fall back to NEEDS_REVISION (conservative)
      expect(verdict.decision).toBe('NEEDS_REVISION');
      // Should have a default feedback entry
      expect(verdict.feedback.length).toBeGreaterThan(0);
      expect(verdict.feedback[0]!.actionItems[0]).toContain('JSON');
    });

    it('treats valid JSON with unrecognized decision as NEEDS_REVISION', async () => {
      const mockLlm = createMockLlmClient(
        JSON.stringify({ decision: 'MAYBE', feedback: [] }),
      );
      const director = new MissionDirector(mockLlm, 'claude-opus-4-6');
      const task = createTaskItem();
      const plan = createPlan([{ id: 'f1' }]);
      const results: Record<string, FeatureResult> = { f1: createSuccessResult('f1') };

      const verdict = await director.review(task, plan, results);

      expect(verdict.decision).toBe('NEEDS_REVISION');
      expect(verdict.feedback.length).toBeGreaterThan(0);
      expect(verdict.feedback[0]!.actionItems[0]).toContain('MAYBE');
    });

    it('treats empty response as NEEDS_REVISION', async () => {
      const mockLlm = createMockLlmClient('');
      const director = new MissionDirector(mockLlm, 'claude-opus-4-6');
      const task = createTaskItem();
      const plan = createPlan([{ id: 'f1' }]);
      const results: Record<string, FeatureResult> = { f1: createSuccessResult('f1') };

      const verdict = await director.review(task, plan, results);

      expect(verdict.decision).toBe('NEEDS_REVISION');
    });

    it('treats invalid JSON as NEEDS_REVISION', async () => {
      const mockLlm = createMockLlmClient('{ decision: APPROVED, broken json }');
      const director = new MissionDirector(mockLlm, 'claude-opus-4-6');
      const task = createTaskItem();
      const plan = createPlan([{ id: 'f1' }]);
      const results: Record<string, FeatureResult> = { f1: createSuccessResult('f1') };

      const verdict = await director.review(task, plan, results);

      expect(verdict.decision).toBe('NEEDS_REVISION');
    });

    it('does not crash on any malformed response', async () => {
      const badResponses = [
        '',
        '   ',
        'just some text',
        '{ not: "json"',
        '[]',
        'null',
        '42',
        '```json\n{"decision":"INVALID"}\n```',
      ];

      for (const response of badResponses) {
        const mockLlm = createMockLlmClient(response);
        const director = new MissionDirector(mockLlm, 'claude-opus-4-6');
        const task = createTaskItem();
        const plan = createPlan([{ id: 'f1' }]);
        const results: Record<string, FeatureResult> = { f1: createSuccessResult('f1') };

        // Should never throw
        const verdict = await director.review(task, plan, results);
        expect(verdict).toBeDefined();
        expect(verdict.decision).toBe('NEEDS_REVISION');
      }
    });

    it('handles LLM call failure gracefully', async () => {
      const mockLlm: LlmClient = {
        chat: vi.fn().mockRejectedValue(new Error('Network error')),
        chatStream: vi.fn(),
      } as unknown as LlmClient;

      const director = new MissionDirector(mockLlm, 'claude-opus-4-6');
      const task = createTaskItem();
      const plan = createPlan([{ id: 'f1' }]);
      const results: Record<string, FeatureResult> = { f1: createSuccessResult('f1') };

      const verdict = await director.review(task, plan, results);

      expect(verdict.decision).toBe('NEEDS_REVISION');
      expect(verdict.feedback[0]!.actionItems[0]).toContain('Network error');
    });

    it('fills empty feedback for NEEDS_REVISION verdict', async () => {
      const mockLlm = createMockLlmClient(
        JSON.stringify({ decision: 'NEEDS_REVISION', feedback: [] }),
      );
      const director = new MissionDirector(mockLlm, 'claude-opus-4-6');
      const task = createTaskItem();
      const plan = createPlan([{ id: 'f1' }]);
      const results: Record<string, FeatureResult> = { f1: createSuccessResult('f1') };

      const verdict = await director.review(task, plan, results);

      expect(verdict.decision).toBe('NEEDS_REVISION');
      // Should have added a catch-all feedback
      expect(verdict.feedback.length).toBeGreaterThan(0);
      expect(verdict.feedback[0]!.featureId).toBe('all');
    });
  });

  // VAL-ORCH-024: Director APPROVED finalizes the mission
  describe('APPROVED verdict (VAL-ORCH-024)', () => {
    it('returns APPROVED with empty feedback for clean results', async () => {
      const mockLlm = createMockLlmClient(
        JSON.stringify({ decision: 'APPROVED', feedback: [] }),
      );
      const director = new MissionDirector(mockLlm, 'claude-opus-4-6');
      const task = createTaskItem();
      const plan = createPlan([
        { id: 'f1' },
        { id: 'f2' },
        { id: 'f3' },
      ]);
      const results: Record<string, FeatureResult> = {
        f1: createSuccessResult('f1'),
        f2: createSuccessResult('f2'),
        f3: createSuccessResult('f3'),
      };

      const verdict = await director.review(task, plan, results);

      expect(verdict.decision).toBe('APPROVED');
      expect(verdict.feedback).toEqual([]);
    });

    it('includes dependency information in the review prompt', async () => {
      const mockLlm = createMockLlmClient(
        JSON.stringify({ decision: 'APPROVED', feedback: [] }),
      );
      const director = new MissionDirector(mockLlm, 'claude-opus-4-6');
      const task = createTaskItem();
      const plan = createPlan([
        { id: 'f1', dependencies: [] },
        { id: 'f2', dependencies: ['f1'] },
      ]);
      const results: Record<string, FeatureResult> = {
        f1: createSuccessResult('f1'),
        f2: createSuccessResult('f2'),
      };

      await director.review(task, plan, results);

      const callArgs = (mockLlm.chat as ReturnType<typeof vi.fn>).mock.calls[0] as [Message[], unknown];
      const content = callArgs[0]![0]!.content;
      expect(content).toContain('f2 depends on');
      expect(content).toContain('f1');
    });

    it('reports validation errors in the review prompt', async () => {
      const mockLlm = createMockLlmClient(
        JSON.stringify({
          decision: 'NEEDS_REVISION',
          feedback: [{ featureId: 'f1', actionItems: ['Fix type error'] }],
        }),
      );
      const director = new MissionDirector(mockLlm, 'claude-opus-4-6');
      const task = createTaskItem();
      const plan = createPlan([{ id: 'f1' }]);
      const results: Record<string, FeatureResult> = {
        f1: createFailedResult('f1', {
          validationErrors: [
            { file: 'app/login.tsx', line: 42, message: 'Type "string" is not assignable to type "number"' },
          ],
        }),
      };

      await director.review(task, plan, results);

      const callArgs = (mockLlm.chat as ReturnType<typeof vi.fn>).mock.calls[0] as [Message[], unknown];
      const content = callArgs[0]![0]!.content;
      expect(content).toContain('app/login.tsx');
      expect(content).toContain('42');
      expect(content).toContain('Validation errors');
    });

    it('accepts REJECTED as valid verdict', async () => {
      const mockLlm = createMockLlmClient(
        JSON.stringify({
          decision: 'REJECTED',
          feedback: [{ featureId: 'all', actionItems: ['Completely wrong approach'] }],
        }),
      );
      const director = new MissionDirector(mockLlm, 'claude-opus-4-6');
      const task = createTaskItem();
      const plan = createPlan([{ id: 'f1' }]);
      const results: Record<string, FeatureResult> = { f1: createFailedResult('f1') };

      const verdict = await director.review(task, plan, results);

      expect(verdict.decision).toBe('REJECTED');
      expect(verdict.feedback).toHaveLength(1);
    });
  });
});

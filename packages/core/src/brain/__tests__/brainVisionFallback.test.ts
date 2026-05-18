import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Brain } from '../Brain.js';
import type { LlmClient } from '../../contracts/ILlmClient.js';
import type { Observation, ProjectMap } from '../../models/types.js';

/** Minimal mock LlmClient that returns a valid JSON task array. */
function mockLlmClient(supportsVision: boolean): LlmClient {
  return {
    supportsVision,
    chat: vi.fn().mockResolvedValue({
      content: '[{"description":"Add button","files":["app/page.tsx"],"type":"single_file"}]',
    }),
    chatWithVision: vi.fn().mockResolvedValue({
      content: '[{"description":"Add button","files":["app/page.tsx"],"type":"single_file"}]',
    }),
    stream: vi.fn(),
  };
}

/** Minimal observation with a screenshot Buffer. */
function observationWithScreenshot(): Observation {
  return {
    screenshot: Buffer.from('fake-png-data'),
    transcript: 'Add a blue button',
    currentUrl: 'http://localhost:3500/',
    timestamp: Date.now(),
  };
}

/** Minimal observation without screenshot. */
function observationNoScreenshot(): Observation {
  return {
    screenshot: Buffer.alloc(0),
    transcript: 'Add a blue button',
    currentUrl: 'http://localhost:3500/',
    timestamp: Date.now(),
  };
}

/** Minimal project map for Brain.analyze(). */
function emptyProjectMap(): ProjectMap {
  return {
    stack: { framework: 'next.js', language: 'typescript', typescript: true },
    devCommand: '',
    port: 3000,
    routes: [],
    components: [],
    endpoints: [],
    models: [],
    files: new Map(),
    features: new Map(),
    dependencies: new Map(),
    fileContexts: new Map(),
    compressedContext: '',
  } as unknown as ProjectMap;
}

describe('Brain.analyze() — vision fallback via supportsVision', () => {
  let projectMap: ProjectMap;

  beforeEach(() => {
    projectMap = emptyProjectMap();
  });

  // ── supportsVision = false (e.g., DeepSeek) ─────────────────

  it('calls chat() when provider lacks vision support, even with screenshot present', async () => {
    const llm = mockLlmClient(false);
    const brain = new Brain(llm);
    const obs = observationWithScreenshot();

    await brain.analyze(obs, projectMap);

    expect(llm.chatWithVision).not.toHaveBeenCalled();
    expect(llm.chat).toHaveBeenCalledOnce();
  });

  it('still calls chat() when provider lacks vision support and no screenshot', async () => {
    const llm = mockLlmClient(false);
    const brain = new Brain(llm);
    const obs = observationNoScreenshot();

    await brain.analyze(obs, projectMap);

    expect(llm.chatWithVision).not.toHaveBeenCalled();
    expect(llm.chat).toHaveBeenCalledOnce();
  });

  it('includes responseFormat json in chat options when falling back to text-only', async () => {
    const llm = mockLlmClient(false);
    const brain = new Brain(llm);
    const obs = observationWithScreenshot();

    await brain.analyze(obs, projectMap);

    const callArgs = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const options = callArgs[1] as { responseFormat: string };
    expect(options.responseFormat).toBe('json');
  });

  // ── supportsVision = true (e.g., OpenAI, Anthropic) ─────────

  it('calls chatWithVision() when provider supports vision and screenshot is present', async () => {
    const llm = mockLlmClient(true);
    const brain = new Brain(llm);
    const obs = observationWithScreenshot();

    await brain.analyze(obs, projectMap);

    expect(llm.chatWithVision).toHaveBeenCalledOnce();
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('calls chat() when provider supports vision but no screenshot present', async () => {
    const llm = mockLlmClient(true);
    const brain = new Brain(llm);
    const obs = observationNoScreenshot();

    await brain.analyze(obs, projectMap);

    expect(llm.chat).toHaveBeenCalledOnce();
    expect(llm.chatWithVision).not.toHaveBeenCalled();
  });

  it('calls chatWithVision() with screenshot buffer and json response format', async () => {
    const llm = mockLlmClient(true);
    const brain = new Brain(llm);
    const obs = observationWithScreenshot();

    await brain.analyze(obs, projectMap);

    const callArgs = (llm.chatWithVision as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const images = callArgs[1] as Buffer[];
    const options = callArgs[2] as { responseFormat: string };
    expect(images).toEqual([obs.screenshot]);
    expect(options.responseFormat).toBe('json');
  });

  it('returns parsed TaskItems from both chat() and chatWithVision() paths', async () => {
    // Test chat path (no vision)
    const llm1 = mockLlmClient(false);
    const brain1 = new Brain(llm1);
    const tasks1 = await brain1.analyze(observationWithScreenshot(), projectMap);
    expect(tasks1).toHaveLength(1);
    expect(tasks1[0]!.description).toBe('Add button');

    // Test vision path
    const llm2 = mockLlmClient(true);
    const brain2 = new Brain(llm2);
    const tasks2 = await brain2.analyze(observationWithScreenshot(), projectMap);
    expect(tasks2).toHaveLength(1);
    expect(tasks2[0]!.description).toBe('Add button');
  });

  // ── Passes model name ────────────────────────────────────────

  it('passes model name to chat() when provided', async () => {
    const llm = mockLlmClient(false);
    const brain = new Brain(llm, undefined, 'deepseek-v4-flash');
    const obs = observationWithScreenshot();

    await brain.analyze(obs, projectMap);

    const callArgs = (llm.chat as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const options = callArgs[1] as { model: string };
    expect(options.model).toBe('deepseek-v4-flash');
  });

  it('passes model name to chatWithVision() when provided', async () => {
    const llm = mockLlmClient(true);
    const brain = new Brain(llm, undefined, 'gpt-4o');
    const obs = observationWithScreenshot();

    await brain.analyze(obs, projectMap);

    const callArgs = (llm.chatWithVision as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const options = callArgs[2] as { model: string };
    expect(options.model).toBe('gpt-4o');
  });
});

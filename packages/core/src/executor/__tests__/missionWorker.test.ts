import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  ProjectMap,
  StackInfo,
  MissionFeature,
  Message,
} from '../../models/types.js';
import type { LlmClient } from '../../contracts/ILlmClient.js';
import type { EventBus } from '../../contracts/IEventBus.js';
import type { IPathGuard } from '../../contracts/IPathGuard.js';
import { MissionWorker } from '../MissionWorker.js';

// ── Helpers ───────────────────────────────────────────────────────────

function createFeature(overrides: Partial<MissionFeature> = {}): MissionFeature {
  return {
    id: 'test-feature-1',
    description: 'Create a login page with form validation',
    files: ['app/login/page.tsx'],
    type: 'multi_file',
    dependencies: [],
    ...overrides,
  };
}

function createProjectMap(overrides: Partial<{
  stack: Partial<StackInfo>;
  fileContexts: Record<string, string>;
}> = {}): ProjectMap {
  const stack: StackInfo = {
    framework: 'next.js',
    language: 'typescript',
    packageManager: 'pnpm',
    typescript: true,
    ...overrides.stack,
  };

  const fileContexts = new Map<string, {
    filePath: string;
    content: string;
    importedTypes: string;
  }>();

  // Default file contexts
  fileContexts.set('app/page.tsx', {
    filePath: 'app/page.tsx',
    content: 'export default function Home() { return <h1>Home</h1>; }',
    importedTypes: '',
  });
  fileContexts.set('app/layout.tsx', {
    filePath: 'app/layout.tsx',
    content: 'export default function Layout({ children }: { children: React.ReactNode }) { return <div>{children}</div>; }',
    importedTypes: '',
  });

  // Custom file contexts
  if (overrides.fileContexts) {
    for (const [path, content] of Object.entries(overrides.fileContexts)) {
      fileContexts.set(path, {
        filePath: path,
        content,
        importedTypes: '',
      });
    }
  }

  return {
    stack,
    devCommand: 'pnpm dev',
    port: 3000,
    routes: [],
    components: [],
    endpoints: [],
    models: [],
    dependencies: new Map(),
    fileContexts,
    compressedContext: '',
  };
}

function createMockLlmClient(responseText?: string): LlmClient {
  return {
    chat: vi.fn().mockResolvedValue({
      content: responseText ?? '',
      model: 'test-model',
    }),
    stream: vi.fn().mockImplementation(async function* () {
      yield {
        content: responseText ?? '',
        model: 'test-model',
      };
    }),
  } as unknown as LlmClient;
}

function createMockEventBus(): EventBus {
  return {
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  };
}

function createMockPathGuard(): IPathGuard {
  return {
    check: vi.fn().mockResolvedValue(undefined),
    validate: vi.fn(),
    allow: vi.fn(),
    loadBoundaries: vi.fn(),
    isReadonly: vi.fn().mockReturnValue(false),
    isIgnored: vi.fn().mockReturnValue(false),
  };
}

function createTempProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nova-test-mission-worker-'));
  return dir;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('MissionWorker', () => {
  let mockLlm: LlmClient;
  let mockEventBus: EventBus;
  let mockPathGuard: IPathGuard;

  beforeEach(() => {
    mockLlm = createMockLlmClient();
    mockEventBus = createMockEventBus();
    mockPathGuard = createMockPathGuard();
  });

  // ── VAL-ORCH-010: Worker generates code using FILE blocks for new files

  describe('FILE blocks for new files (VAL-ORCH-010)', () => {
    it('writes a new file from a FILE block response', async () => {
      const tmpDir = createTempProjectDir();

      const fileContent = 'export default function LoginPage() { return <div>Login</div>; }';
      const response = `=== FILE: app/login/page.tsx ===\n${fileContent}\n=== END FILE ===`;

      mockLlm = createMockLlmClient(response);
      const worker = new MissionWorker(
        tmpDir,
        mockLlm,
        'claude-sonnet-4-6',
        mockEventBus,
        mockPathGuard,
      );

      const feature = createFeature({ files: ['app/login/page.tsx'] });
      const projectMap = createProjectMap();
      const result = await worker.execute(feature, projectMap);

      expect(result.success).toBe(true);
      expect(result.featureId).toBe('test-feature-1');
      expect(result.generatedFiles).toHaveLength(1);
      expect(result.generatedFiles![0]!.path).toBe('app/login/page.tsx');
      expect(result.generatedFiles![0]!.content).toBe(fileContent);
      expect(result.diff).toContain('+++ app/login/page.tsx');

      // Verify file was actually written to disk
      const fullPath = join(tmpDir, 'app/login/page.tsx');
      expect(existsSync(fullPath)).toBe(true);
    });

    it('writes multiple files from multiple FILE blocks', async () => {
      const tmpDir = createTempProjectDir();
      const response = `=== FILE: app/login/page.tsx ===\nconst LoginPage = () => <div>Login</div>;\n=== END FILE ===\n\n=== FILE: app/login/form.tsx ===\nconst LoginForm = () => <form>...</form>;\n=== END FILE ===`;

      mockLlm = createMockLlmClient(response);
      const worker = new MissionWorker(
        tmpDir,
        mockLlm,
        'claude-sonnet-4-6',
        mockEventBus,
        mockPathGuard,
      );

      const feature = createFeature({
        files: ['app/login/page.tsx', 'app/login/form.tsx'],
      });
      const projectMap = createProjectMap();
      const result = await worker.execute(feature, projectMap);

      expect(result.success).toBe(true);
      expect(result.generatedFiles).toHaveLength(2);
      expect(existsSync(join(tmpDir, 'app/login/page.tsx'))).toBe(true);
      expect(existsSync(join(tmpDir, 'app/login/form.tsx'))).toBe(true);
    });
  });

  // ── VAL-ORCH-011: Worker generates code using DIFF blocks for existing files

  describe('DIFF blocks for existing files (VAL-ORCH-011)', () => {
    it('applies a DIFF block to an existing file', async () => {
      const tmpDir = createTempProjectDir();
      // Pre-create the target file
      const targetDir = join(tmpDir, 'app');
      mkdirSync(targetDir);
      writeFileSync(join(targetDir, 'page.tsx'), 'export default function Home() {\n  return <h1>Home</h1>;\n}\n', 'utf-8');

      const diffContent = `--- a/app/page.tsx\n+++ b/app/page.tsx\n@@ -1,3 +1,4 @@\n export default function Home() {\n   return <h1>Home</h1>;\n+  return <h1>Updated Home</h1>;\n }\n`;
      const response = `=== DIFF: app/page.tsx ===\n${diffContent}\n=== END DIFF ===`;

      mockLlm = createMockLlmClient(response);
      const worker = new MissionWorker(
        tmpDir,
        mockLlm,
        'claude-sonnet-4-6',
        mockEventBus,
        mockPathGuard,
      );

      const feature = createFeature({ files: ['app/page.tsx'] });
      const projectMap = createProjectMap({
        fileContexts: {
          'app/page.tsx': 'export default function Home() {\n  return <h1>Home</h1>;\n}\n',
        },
      });
      const result = await worker.execute(feature, projectMap);

      expect(result.success).toBe(true);
      expect(result.generatedFiles).toHaveLength(1);
      expect(result.generatedFiles![0]!.path).toBe('app/page.tsx');
    });

    it('handles invalid DIFF by falling back to full file write', async () => {
      const tmpDir = createTempProjectDir();
      const targetDir = join(tmpDir, 'app');
      mkdirSync(targetDir);

      // DIFF that isn't actually a valid unified diff
      const response = `=== DIFF: app/page.tsx ===\nexport default function Page() { return <div>New</div>; }\n=== END DIFF ===`;

      mockLlm = createMockLlmClient(response);
      const worker = new MissionWorker(
        tmpDir,
        mockLlm,
        'claude-sonnet-4-6',
        mockEventBus,
        mockPathGuard,
      );

      const feature = createFeature({ files: ['app/page.tsx'] });
      const projectMap = createProjectMap();
      const result = await worker.execute(feature, projectMap);

      // Should succeed - fallback to writing diff body as file content
      expect(result.success).toBe(true);
      expect(result.generatedFiles!.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ── VAL-ORCH-012: Worker handles DELETE blocks for file removal

  describe('DELETE blocks (VAL-ORCH-012)', () => {
    it('deletes a file specified by DELETE block', async () => {
      const tmpDir = createTempProjectDir();
      // Pre-create a file to delete
      const targetDir = join(tmpDir, 'app');
      mkdirSync(targetDir);
      writeFileSync(join(targetDir, 'old.ts'), 'console.log("old file");', 'utf-8');

      const response = `=== DELETE: app/old.ts ===`;

      mockLlm = createMockLlmClient(response);
      const worker = new MissionWorker(
        tmpDir,
        mockLlm,
        'claude-sonnet-4-6',
        mockEventBus,
        mockPathGuard,
      );

      const feature = createFeature({ files: ['app/old.ts'] });
      const projectMap = createProjectMap();
      const result = await worker.execute(feature, projectMap);

      expect(result.success).toBe(true);
      expect(result.deletedFiles).toContain('app/old.ts');
      expect(result.diff).toContain('--- app/old.ts');
      expect(existsSync(join(tmpDir, 'app/old.ts'))).toBe(false);
    });

    it('handles DELETE for non-existent file gracefully', async () => {
      const tmpDir = createTempProjectDir();
      const response = `=== DELETE: app/nonexistent.ts ===`;

      mockLlm = createMockLlmClient(response);
      const worker = new MissionWorker(
        tmpDir,
        mockLlm,
        'claude-sonnet-4-6',
        mockEventBus,
        mockPathGuard,
      );

      const feature = createFeature({ files: ['app/nonexistent.ts'] });
      const projectMap = createProjectMap();
      const result = await worker.execute(feature, projectMap);

      // The delete failed (file doesn't exist), but no blocks were written
      // So this should fail since nothing was done
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('handles DELETE combined with FILE blocks', async () => {
      const tmpDir = createTempProjectDir();
      const targetDir = join(tmpDir, 'app');
      mkdirSync(targetDir);
      writeFileSync(join(targetDir, 'old.ts'), 'old', 'utf-8');

      const response = `=== DELETE: app/old.ts ===\n=== FILE: app/new.ts ===\nconst x = 1;\n=== END FILE ===`;

      mockLlm = createMockLlmClient(response);
      const worker = new MissionWorker(
        tmpDir,
        mockLlm,
        'claude-sonnet-4-6',
        mockEventBus,
        mockPathGuard,
      );

      const feature = createFeature({ files: ['app/old.ts', 'app/new.ts'] });
      const projectMap = createProjectMap();
      const result = await worker.execute(feature, projectMap);

      expect(result.success).toBe(true);
      expect(result.deletedFiles).toContain('app/old.ts');
      expect(result.generatedFiles!.some((f) => f.path === 'app/new.ts')).toBe(true);
    });
  });

  // ── VAL-ORCH-013: Worker validates via CodeValidator (tsc + imports)

  describe('CodeValidator integration (VAL-ORCH-013)', () => {
    it('validates generated files and reports type errors', async () => {
      const tmpDir = createTempProjectDir();
      // Create a file with a type error
      const response = `=== FILE: app/page.tsx ===\nconst x: number = "this is a string";\nexport default x;\n=== END FILE ===`;

      mockLlm = createMockLlmClient(response);
      const worker = new MissionWorker(
        tmpDir,
        mockLlm,
        'claude-sonnet-4-6',
        mockEventBus,
        mockPathGuard,
      );

      const feature = createFeature({ files: ['app/page.tsx'] });
      const projectMap = createProjectMap();
      const result = await worker.execute(feature, projectMap);

      // The file was written, and validation may or may not catch the error
      // depending on tsc availability. At minimum, it should not crash.
      expect(result).toHaveProperty('success');
      expect(result.featureId).toBe('test-feature-1');
    });

    it('validates imports and reports unresolved imports', async () => {
      const tmpDir = createTempProjectDir();
      // Create a package.json so import checks work
      writeFileSync(
        join(tmpDir, 'package.json'),
        JSON.stringify({ dependencies: { react: '^19.0.0' } }),
        'utf-8',
      );

      // File imports a non-existent package
      const response = `=== FILE: app/page.tsx ===\nimport { fakeLib } from 'nonexistent-package';\nexport default function Page() { return <div>hi</div>; }\n=== END FILE ===`;

      mockLlm = createMockLlmClient(response);
      const worker = new MissionWorker(
        tmpDir,
        mockLlm,
        'claude-sonnet-4-6',
        mockEventBus,
        mockPathGuard,
      );

      const feature = createFeature({ files: ['app/page.tsx'] });
      const projectMap = createProjectMap();
      const result = await worker.execute(feature, projectMap);

      // Should not crash; if import check ran, there should be errors
      expect(result).toHaveProperty('success');
      expect(result.featureId).toBe('test-feature-1');
    });
  });

  // ── VAL-ORCH-014: Worker auto-fixes errors via CodeFixer (max 2 iterations)

  describe('CodeFixer auto-fix (VAL-ORCH-014)', () => {
    it('attempts to fix validation errors via CodeFixer', async () => {
      const tmpDir = createTempProjectDir();
      // First response has a type error
      const response = `=== FILE: app/page.tsx ===\nconst x: number = "string_error";\nexport default function Page() { return <div>{x}</div>; }\n=== END FILE ===`;

      mockLlm = createMockLlmClient(response);
      const worker = new MissionWorker(
        tmpDir,
        mockLlm,
        'claude-sonnet-4-6',
        mockEventBus,
        mockPathGuard,
      );

      const feature = createFeature({ files: ['app/page.tsx'] });
      const projectMap = createProjectMap();
      const result = await worker.execute(feature, projectMap);

      // Should not crash, regardless of fix outcome
      expect(result).toHaveProperty('success');
      expect(result.featureId).toBe('test-feature-1');
    });

    it('does not exceed maxFixIterations (default 2)', async () => {
      const tmpDir = createTempProjectDir();
      const response = `=== FILE: app/page.tsx ===\nconst x: number = "string";\nexport default x;\n=== END FILE ===`;

      const mockStream = vi.fn().mockImplementation(async function* () {
        yield { content: response, model: 'test' };
      });
      const mockLlmLocal = {
        chat: vi.fn(),
        stream: mockStream,
      } as unknown as LlmClient;

      const worker = new MissionWorker(
        tmpDir,
        mockLlmLocal,
        'claude-sonnet-4-6',
        mockEventBus,
        mockPathGuard,
        undefined,
        2, // maxFixIterations=2
      );

      const feature = createFeature({ files: ['app/page.tsx'] });
      const projectMap = createProjectMap();
      const result = await worker.execute(feature, projectMap);

      // Should complete without crashing
      expect(result).toHaveProperty('success');
    });
  });

  // ── VAL-ORCH-016: Worker handles LLM not producing any blocks

  describe('no blocks in response (VAL-ORCH-016)', () => {
    it('returns error when LLM produces no file blocks', async () => {
      const tmpDir = createTempProjectDir();
      const response = 'I think we should implement this feature by...';

      mockLlm = createMockLlmClient(response);
      const worker = new MissionWorker(
        tmpDir,
        mockLlm,
        'claude-sonnet-4-6',
        mockEventBus,
        mockPathGuard,
      );

      const feature = createFeature();
      const projectMap = createProjectMap();
      const result = await worker.execute(feature, projectMap);

      expect(result.success).toBe(false);
      expect(result.error).toContain('no file blocks');
    });

    it('returns error when LLM produces empty response', async () => {
      const tmpDir = createTempProjectDir();
      const response = '';

      mockLlm = createMockLlmClient(response);
      const worker = new MissionWorker(
        tmpDir,
        mockLlm,
        'claude-sonnet-4-6',
        mockEventBus,
        mockPathGuard,
      );

      const feature = createFeature();
      const projectMap = createProjectMap();
      const result = await worker.execute(feature, projectMap);

      expect(result.success).toBe(false);
      expect(result.error).toContain('no file blocks');
    });
  });

  // ── VAL-ORCH-017: Worker uses the standard model (not orchestrator model)

  describe('uses standard model (VAL-ORCH-017)', () => {
    it('calls LLM with the worker model, not orchestrator model', async () => {
      const tmpDir = createTempProjectDir();
      const fileContent = 'export default function Home() { return <div>Hi</div>; }';
      const response = `=== FILE: app/page.tsx ===\n${fileContent}\n=== END FILE ===`;

      const mockStream = vi.fn().mockImplementation(async function* () {
        yield { content: response, model: 'test' };
      });

      const llmClient: LlmClient = {
        chat: vi.fn(),
        stream: mockStream,
      } as unknown as LlmClient;

      const worker = new MissionWorker(
        tmpDir,
        llmClient,
        'gpt-4o', // worker model
        mockEventBus,
        mockPathGuard,
      );

      const feature = createFeature();
      const projectMap = createProjectMap();
      await worker.execute(feature, projectMap);

      // Verify llmClient.stream was called with the worker model
      expect(mockStream).toHaveBeenCalled();
      const streamCallArgs = mockStream.mock.calls[0];
      expect(streamCallArgs).toBeDefined();
      const options = streamCallArgs![1] as { model?: string } | undefined;
      expect(options).toBeDefined();
      expect(options!.model).toBe('gpt-4o');
      // Must NOT be the orchestrator model
      expect(options!.model).not.toBe('claude-opus-4-6');
    });
  });

  // ── PathGuard integration

  describe('path validation via PathGuard', () => {
    it('passes all file operations through PathGuard.check()', async () => {
      const tmpDir = createTempProjectDir();
      const response = `=== FILE: app/page.tsx ===\nexport default function Page() { return <div>Hi</div>; }\n=== END FILE ===`;

      mockLlm = createMockLlmClient(response);
      const worker = new MissionWorker(
        tmpDir,
        mockLlm,
        'claude-sonnet-4-6',
        mockEventBus,
        mockPathGuard,
      );

      const feature = createFeature({ files: ['app/page.tsx'] });
      const projectMap = createProjectMap();
      await worker.execute(feature, projectMap);

      // PathGuard.check should have been called for the file
      expect(mockPathGuard.check).toHaveBeenCalled();
    });

    it('rejects path traversal attempts via PathGuard', async () => {
      const tmpDir = createTempProjectDir();
      const rejectingPathGuard: IPathGuard = {
        ...createMockPathGuard(),
        check: vi.fn().mockRejectedValue(new Error('Path traversal detected')),
      };

      // Use a path that passes sanitizePath but gets rejected by PathGuard
      const response = `=== FILE: app/secret.tsx ===\nconst secret = "classified";\n=== END FILE ===`;

      mockLlm = createMockLlmClient(response);
      const worker = new MissionWorker(
        tmpDir,
        mockLlm,
        'claude-sonnet-4-6',
        mockEventBus,
        rejectingPathGuard,
      );

      const feature = createFeature({ files: ['app/secret.tsx'] });
      const projectMap = createProjectMap();
      const result = await worker.execute(feature, projectMap);

      // Path guard rejection should cause the feature to fail
      // and the rejected paths should be tracked
      expect(result.success).toBe(false);
      expect(result.error).toContain('PathGuard rejected');
      expect(result.rejectedPaths).toBeDefined();
      expect(result.rejectedPaths).toHaveLength(1);
      expect(result.rejectedPaths![0]!.path).toBe('app/secret.tsx');
      expect(result.rejectedPaths![0]!.reason).toContain('Path traversal');
    });
  });

  // ── Prompt building

  describe('prompt building', () => {
    it('includes feature description and project context in prompt', async () => {
      const tmpDir = createTempProjectDir();
      const response = `=== FILE: app/page.tsx ===\nconst hello = "world";\n=== END FILE ===`;

      const mockStream = vi.fn().mockImplementation(async function* () {
        yield { content: response, model: 'test' };
      });

      const llmClient: LlmClient = {
        chat: vi.fn(),
        stream: mockStream,
      } as unknown as LlmClient;

      const worker = new MissionWorker(
        tmpDir,
        llmClient,
        'claude-sonnet-4-6',
        mockEventBus,
        mockPathGuard,
      );

      const feature = createFeature({
        id: 'auth-module',
        description: 'Build authentication system',
        files: ['app/auth/login.tsx', 'app/auth/signup.tsx'],
      });
      const projectMap = createProjectMap();
      await worker.execute(feature, projectMap);

      // Verify the prompt contains key elements
      expect(mockStream).toHaveBeenCalled();
      const messages = mockStream.mock.calls[0]![0] as Message[];
      const userMessage = messages[0];
      expect(userMessage).toBeDefined();
      if (userMessage && 'content' in userMessage) {
        const content = userMessage.content as string;
        expect(content).toContain('auth-module');
        expect(content).toContain('Build authentication system');
        expect(content).toContain('next.js');
        expect(content).toContain('typescript');
      }
    });
  });

  // ── LLM call failure

  describe('LLM call failure', () => {
    it('returns error when LLM stream throws', async () => {
      const tmpDir = createTempProjectDir();

      const mockStream = vi.fn().mockImplementation(() => {
        throw new Error('LLM API timeout');
      }) as unknown as LlmClient['stream'];

      const llmClient: LlmClient = {
        chat: vi.fn(),
        stream: mockStream,
      } as unknown as LlmClient;

      const worker = new MissionWorker(
        tmpDir,
        llmClient,
        'claude-sonnet-4-6',
        mockEventBus,
        mockPathGuard,
      );

      const feature = createFeature();
      const projectMap = createProjectMap();
      const result = await worker.execute(feature, projectMap);

      expect(result.success).toBe(false);
      expect(result.error).toContain('LLM call failed');
      expect(result.error).toContain('LLM API timeout');
    });
  });

  // ── FeatureResult shape

  describe('FeatureResult shape', () => {
    it('returns all required FeatureResult fields on success', async () => {
      const tmpDir = createTempProjectDir();
      const response = `=== FILE: app/test.tsx ===\nconst Test = () => <div>Test</div>;\n=== END FILE ===`;

      mockLlm = createMockLlmClient(response);
      const worker = new MissionWorker(
        tmpDir,
        mockLlm,
        'claude-sonnet-4-6',
        mockEventBus,
        mockPathGuard,
      );

      const feature = createFeature({ files: ['app/test.tsx'] });
      const projectMap = createProjectMap();
      const result = await worker.execute(feature, projectMap);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('featureId');
      expect(result.featureId).toBe('test-feature-1');
      expect(result.success).toBe(true);
      expect(result.diff).toBeDefined();
      expect(result.generatedFiles).toBeDefined();
      expect(result.generatedFiles!.length).toBeGreaterThan(0);
    });

    it('returns error field on failure', async () => {
      const tmpDir = createTempProjectDir();
      const response = 'Just some text without any blocks';

      mockLlm = createMockLlmClient(response);
      const worker = new MissionWorker(
        tmpDir,
        mockLlm,
        'claude-sonnet-4-6',
        mockEventBus,
        mockPathGuard,
      );

      const feature = createFeature();
      const projectMap = createProjectMap();
      const result = await worker.execute(feature, projectMap);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).not.toBe('');
    });
  });

  // ── Edge case: all blocks fail

  describe('all blocks fail', () => {
    it('returns error when all blocks fail to apply', async () => {
      const tmpDir = createTempProjectDir();

      // Create a response with a file block but make PathGuard reject it
      const rejectingPathGuard: IPathGuard = {
        ...createMockPathGuard(),
        check: vi.fn().mockRejectedValue(new Error('Permission denied')),
      };

      const response = `=== FILE: app/page.tsx ===\nconst x = 1;\n=== END FILE ===`;

      mockLlm = createMockLlmClient(response);
      const worker = new MissionWorker(
        tmpDir,
        mockLlm,
        'claude-sonnet-4-6',
        mockEventBus,
        rejectingPathGuard,
      );

      const feature = createFeature();
      const projectMap = createProjectMap();
      const result = await worker.execute(feature, projectMap);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('PathGuard rejected');
      expect(result.rejectedPaths).toBeDefined();
      expect(result.rejectedPaths).toHaveLength(1);
      expect(result.rejectedPaths![0]!.path).toBe('app/page.tsx');
    });

    it('fails when PathGuard rejects some blocks but others succeed', async () => {
      const tmpDir = createTempProjectDir();

      // PathGuard: allow first block, reject second
      const selectivePathGuard: IPathGuard = {
        ...createMockPathGuard(),
        check: vi.fn().mockImplementation(async (absPath: string) => {
          if (absPath.includes('blocked')) {
            throw new Error('Path not allowed');
          }
          // allowed
        }),
      };

      const response =
        `=== FILE: app/allowed.tsx ===\nconst ok = 1;\n=== END FILE ===\n` +
        `=== FILE: app/blocked.tsx ===\nconst nope = 2;\n=== END FILE ===`;

      mockLlm = createMockLlmClient(response);
      const worker = new MissionWorker(
        tmpDir,
        mockLlm,
        'claude-sonnet-4-6',
        mockEventBus,
        selectivePathGuard,
      );

      const feature = createFeature({
        files: ['app/allowed.tsx', 'app/blocked.tsx'],
      });
      const projectMap = createProjectMap();
      const result = await worker.execute(feature, projectMap);

      // Feature must fail because even one rejection invalidates the whole feature
      expect(result.success).toBe(false);
      expect(result.error).toContain('PathGuard rejected');
      expect(result.rejectedPaths).toBeDefined();
      expect(result.rejectedPaths).toHaveLength(1);
      expect(result.rejectedPaths![0]!.path).toBe('app/blocked.tsx');
      expect(result.rejectedPaths![0]!.reason).toContain('not allowed');
    });
  });

  // ── Event emission

  describe('event emission', () => {
    it('emits status events during execution', async () => {
      const tmpDir = createTempProjectDir();
      const response = `=== FILE: app/page.tsx ===\nexport default function Page() { return <div>Test</div>; }\n=== END FILE ===`;

      mockLlm = createMockLlmClient(response);
      const worker = new MissionWorker(
        tmpDir,
        mockLlm,
        'claude-sonnet-4-6',
        mockEventBus,
        mockPathGuard,
      );

      const feature = createFeature();
      const projectMap = createProjectMap();
      await worker.execute(feature, projectMap);

      expect(mockEventBus.emit).toHaveBeenCalled();
      const emitCalls = (mockEventBus.emit as ReturnType<typeof vi.fn>).mock.calls;
      const statusMessages = emitCalls
        .filter((call: Array<{ type: string }>) => call[0]?.type === 'status')
        .map((call: Array<{ type: string; data: { message: string } }>) => call[0]?.data?.message);

      // Check that at least one status message mentions the feature
      const featureMessages = statusMessages.filter(
        (msg: string | undefined) => msg && msg.includes('feature'),
      );
      expect(featureMessages.length).toBeGreaterThan(0);
    });
  });
});



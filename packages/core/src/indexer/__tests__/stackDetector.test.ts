import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { StackDetector } from '../StackDetector.js';

const fixturesDir = path.resolve(__dirname, '../../../../../tests/fixtures');

function fixturePath(name: string): string {
  return path.join(fixturesDir, name);
}

describe('StackDetector', () => {
  const detector = new StackDetector();

  // ── detectStack ─────────────────────────────────────────────

  describe('detectStack', () => {
    it('should detect Next.js app as next.js framework with typescript', async () => {
      const stack = await detector.detectStack(fixturePath('nextjs-app'));

      expect(stack.framework).toBe('next.js');
      expect(stack.language).toBe('typescript');
      expect(stack.typescript).toBe(true);
    });

    it('should detect Vite app as vite framework', async () => {
      const stack = await detector.detectStack(fixturePath('vite-app'));

      expect(stack.framework).toBe('vite');
      expect(stack.typescript).toBe(true);
    });

    it('should detect .NET app as dotnet framework with csharp language', async () => {
      const stack = await detector.detectStack(fixturePath('dotnet-app'));

      expect(stack.framework).toBe('dotnet');
      expect(stack.language).toBe('csharp');
    });

    it('should return unknown framework and language for empty project', async () => {
      const stack = await detector.detectStack(fixturePath('empty-project'));

      expect(stack.framework).toBe('unknown');
      expect(stack.language).toBe('unknown');
      expect(stack.typescript).toBe(false);
    });
  });

  // ── detectDevCommand ────────────────────────────────────────

  describe('detectDevCommand', () => {
    it('should return a dev command containing "dev" for Next.js', async () => {
      const projectPath = fixturePath('nextjs-app');
      const stack = await detector.detectStack(projectPath);
      const command = await detector.detectDevCommand(stack, projectPath);

      expect(command).toContain('dev');
    });

    it('should return "dotnet run" for .NET projects', async () => {
      const projectPath = fixturePath('dotnet-app');
      const stack = await detector.detectStack(projectPath);
      const command = await detector.detectDevCommand(stack, projectPath);

      expect(command).toBe('dotnet run');
    });

    it('should return empty string for unknown stack', async () => {
      const projectPath = fixturePath('empty-project');
      const stack = await detector.detectStack(projectPath);
      const command = await detector.detectDevCommand(stack, projectPath);

      expect(command).toBe('');
    });
  });

  // ── detectPort ──────────────────────────────────────────────

  describe('detectPort', () => {
    it('should return 3000 for Next.js (default port)', async () => {
      const projectPath = fixturePath('nextjs-app');
      const stack = await detector.detectStack(projectPath);
      const port = await detector.detectPort(stack, projectPath);

      expect(port).toBe(3000);
    });

    it('should return 5173 for Vite (default port)', async () => {
      const projectPath = fixturePath('vite-app');
      const stack = await detector.detectStack(projectPath);
      const port = await detector.detectPort(stack, projectPath);

      expect(port).toBe(5173);
    });

    it('should return 3000 for unknown stack (fallback)', async () => {
      const projectPath = fixturePath('empty-project');
      const stack = await detector.detectStack(projectPath);
      const port = await detector.detectPort(stack, projectPath);

      expect(port).toBe(3000);
    });
  });
});

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { RouteExtractor } from '../RouteExtractor.js';
import type { StackInfo, RouteInfo } from '../../models/types.js';

const fixturesDir = path.resolve(__dirname, '../../../../../tests/fixtures');

function fixturePath(name: string): string {
  return path.join(fixturesDir, name);
}

const nextjsStack: StackInfo = {
  framework: 'next.js',
  language: 'typescript',
  typescript: true,
};

const dotnetStack: StackInfo = {
  framework: 'dotnet',
  language: 'csharp',
  typescript: false,
};

const unknownStack: StackInfo = {
  framework: 'unknown',
  language: 'unknown',
  typescript: false,
};

describe('RouteExtractor', () => {
  const extractor = new RouteExtractor();

  describe('extract', () => {
    it('should find page route for app/page.tsx in Next.js app', async () => {
      const routes = await extractor.extract(fixturePath('nextjs-app'), nextjsStack);

      const homeRoute = routes.find((r: RouteInfo) => r.path === '/');
      expect(homeRoute).toBeDefined();
      expect(homeRoute!.type).toBe('page');
    });

    it('should find API route for app/api/users/route.ts in Next.js app', async () => {
      const routes = await extractor.extract(fixturePath('nextjs-app'), nextjsStack);

      const apiRoute = routes.find((r: RouteInfo) => r.path === '/api/users');
      expect(apiRoute).toBeDefined();
      expect(apiRoute!.type).toBe('api');
    });

    it('should return an empty array for empty project', async () => {
      const routes = await extractor.extract(fixturePath('empty-project'), unknownStack);

      expect(routes).toEqual([]);
    });
  });
});

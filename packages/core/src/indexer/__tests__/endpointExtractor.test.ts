import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { EndpointExtractor } from '../EndpointExtractor.js';
import type { StackInfo, EndpointInfo } from '../../models/types.js';

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

describe('EndpointExtractor', () => {
  const extractor = new EndpointExtractor();

  describe('extract', () => {
    it('should find GET endpoint from app/api/users/route.ts in Next.js app', async () => {
      const endpoints = await extractor.extract(fixturePath('nextjs-app'), nextjsStack);

      const getEndpoint = endpoints.find(
        (e: EndpointInfo) => e.method === 'GET' && e.path === '/api/users',
      );
      expect(getEndpoint).toBeDefined();
    });

    it('should find POST endpoint from app/api/users/route.ts in Next.js app', async () => {
      const endpoints = await extractor.extract(fixturePath('nextjs-app'), nextjsStack);

      const postEndpoint = endpoints.find(
        (e: EndpointInfo) => e.method === 'POST' && e.path === '/api/users',
      );
      expect(postEndpoint).toBeDefined();
    });

    it('should find endpoint from UsersController.cs in dotnet app', async () => {
      const endpoints = await extractor.extract(fixturePath('dotnet-app'), dotnetStack);

      expect(endpoints.length).toBeGreaterThan(0);

      const usersEndpoint = endpoints.find((e: EndpointInfo) =>
        e.path.toLowerCase().includes('users'),
      );
      expect(usersEndpoint).toBeDefined();
    });

    it('should return an empty array for empty project', async () => {
      const endpoints = await extractor.extract(fixturePath('empty-project'), unknownStack);

      expect(endpoints).toEqual([]);
    });
  });
});

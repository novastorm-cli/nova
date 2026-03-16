import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { ComponentExtractor } from '../ComponentExtractor.js';
import type { StackInfo, ComponentInfo } from '../../models/types.js';

const fixturesDir = path.resolve(__dirname, '../../../../../tests/fixtures');

function fixturePath(name: string): string {
  return path.join(fixturesDir, name);
}

const viteStack: StackInfo = {
  framework: 'vite',
  language: 'typescript',
  typescript: true,
};

const unknownStack: StackInfo = {
  framework: 'unknown',
  language: 'unknown',
  typescript: false,
};

describe('ComponentExtractor', () => {
  const extractor = new ComponentExtractor();

  describe('extract', () => {
    it('should find Button.tsx as a component in vite-app', async () => {
      const components = await extractor.extract(fixturePath('vite-app'), viteStack);

      const button = components.find((c: ComponentInfo) => c.name === 'Button');
      expect(button).toBeDefined();
      expect(button!.type).toBe('component');
    });

    it('should find App.tsx as a ComponentInfo in vite-app', async () => {
      const components = await extractor.extract(fixturePath('vite-app'), viteStack);

      const app = components.find((c: ComponentInfo) => c.name === 'App');
      expect(app).toBeDefined();
      expect(app!.filePath).toBeDefined();
      expect(app!.type).toBeDefined();
      expect(app!.exports).toBeDefined();
    });

    it('should return an empty array for empty project', async () => {
      const components = await extractor.extract(fixturePath('empty-project'), unknownStack);

      expect(components).toEqual([]);
    });
  });
});

import { defineConfig } from 'tsup';
import { builtinModules } from 'node:module';

const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
];

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'bin/nova': 'bin/nova.ts',
  },
  format: 'esm',
  dts: { entry: 'src/index.ts' },
  outDir: 'dist',
  splitting: true,
  clean: true,
  platform: 'node',
  target: 'node22',
  noExternal: [
    '@novastorm-ai/core',
    '@novastorm-ai/licensing',
    '@novastorm-ai/overlay',
    '@novastorm-ai/proxy',
  ],
  external: [
    ...nodeBuiltins,
    // npm-installed runtime deps (not bundled)
    '@iarna/toml',
    '@inquirer/prompts',
    'chalk',
    'commander',
    'inquirer',
    'ora',
    // AI SDKs and their transitive CJS deps
    '@anthropic-ai/sdk',
    'openai',
    'node-fetch',
    'whatwg-url',
    'ws',
    'http-proxy',
    'picomatch',
    'zod',
    'html2canvas',
  ],
  banner({ format }) {
    if (format === 'esm') {
      return {
        js: `import { createRequire as __cr } from 'node:module';
const require = __cr(import.meta.url);
`,
      };
    }
    return {};
  },
  onSuccess:
    'node -e "const fs=require(\'fs\');const f=\'dist/bin/nova.js\';let c=fs.readFileSync(f,\'utf8\');if(!c.startsWith(\'#!/\'))fs.writeFileSync(f,\'#!/usr/bin/env node\\n\'+c);fs.chmodSync(f,0o755)"',
});

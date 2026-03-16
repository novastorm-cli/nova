import { defineConfig } from 'tsup';

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
  banner({ format }) {
    // Add shebang only to the bin entry
    if (format === 'esm') {
      return { js: '' };
    }
    return {};
  },
  // tsup doesn't support per-entry banners, so we use onSuccess to add the shebang
  onSuccess:
    'node -e "const fs=require(\'fs\');const f=\'dist/bin/nova.js\';let c=fs.readFileSync(f,\'utf8\');if(!c.startsWith(\'#!/\'))fs.writeFileSync(f,\'#!/usr/bin/env node\\n\'+c);fs.chmodSync(f,0o755)"',
});

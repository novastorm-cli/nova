import { defineConfig } from 'tsup';

export default defineConfig([
  // ESM library build (existing)
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
  },
  // IIFE browser bundle
  {
    entry: { 'nova-overlay': 'src/index.ts' },
    format: ['iife'],
    target: 'es2020',
    minify: true,
    noExternal: [/.*/],
    outDir: 'dist',
    platform: 'browser',
  },
]);

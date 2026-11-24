import { defineConfig } from 'tsup';

// Bundles the CLI (and zod) into ONE file runnable with plain `node dist/cli.mjs`.
export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
  noExternal: [/.*/],
  splitting: false,
  sourcemap: false,
  minify: false,
  clean: true,
  dts: false,
});

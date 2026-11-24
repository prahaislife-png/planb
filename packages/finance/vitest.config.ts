import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // builds dist/cli.mjs so that test/cli.test.ts runs the real bundled CLI
    globalSetup: ['./test/global-setup.ts'],
  },
});

import { build } from 'tsup';

/** Build dist/cli.mjs once before the test run so the CLI test exercises the real bundle. */
export default async function setup(): Promise<void> {
  await build({ silent: true });
}

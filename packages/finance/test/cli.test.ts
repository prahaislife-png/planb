import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES,
  DEFAULT_SCENARIOS,
  DEFAULT_STRESS_TESTS,
  ENGINE_VERSION,
  hashModelInput,
  runModel,
  runScenarios,
  sensitivity,
} from '../src/index';
import { ALL_SYNTHETIC, SYNTHETIC_CAFE, SYNTHETIC_MANUFACTURING } from './fixtures';

/**
 * Runs the REAL bundled CLI (`node dist/cli.mjs`, built by test/global-setup.ts) as a
 * child process, exactly as the Python worker does, and compares with the in-process API.
 */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = resolve(packageRoot, 'dist/cli.mjs');

function cli(stdin: string): { status: number | null; stdout: string; stderr: string } {
  const child = spawnSync(process.execPath, [cliPath], { input: stdin, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

const request = (body: unknown): ReturnType<typeof cli> => cli(JSON.stringify(body));

describe('CLI (dist/cli.mjs)', () => {
  it('the bundle exists, is a single self-contained ESM file', () => {
    expect(existsSync(cliPath)).toBe(true);
    const source = readFileSync(cliPath, 'utf8');
    // zod is bundled: no bare-module imports other than node: builtins
    const imports = [...source.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((match) => match[1]!);
    expect(imports.filter((specifier) => !specifier.startsWith('node:'))).toEqual([]);
    expect(source).not.toMatch(/\brequire\(['"]zod['"]\)/);
  });

  it('op "version"', () => {
    const out = request({ op: 'version' });
    expect(out.status).toBe(0);
    expect(out.stderr).toBe('');
    expect(JSON.parse(out.stdout)).toEqual({ name: '@planb/finance', engineVersion: ENGINE_VERSION });
  });

  it('op "run" returns exactly the in-process ModelResult, byte for byte, for every fixture', () => {
    for (const [name, input] of Object.entries(ALL_SYNTHETIC)) {
      const out = request({ op: 'run', input });
      expect(out.status, name).toBe(0);
      expect(out.stderr, name).toBe('');
      expect(out.stdout, name).toBe(`${JSON.stringify(runModel(input))}\n`);
    }
  });

  it('output is stable: two invocations give identical bytes, regardless of input key order', () => {
    const first = request({ op: 'run', input: SYNTHETIC_MANUFACTURING });
    const second = request({ op: 'run', input: SYNTHETIC_MANUFACTURING });
    expect(second.stdout).toBe(first.stdout);
    const reversed = Object.fromEntries(Object.entries(SYNTHETIC_MANUFACTURING).reverse());
    const third = request({ input: reversed, op: 'run' });
    expect(third.stdout).toBe(first.stdout);
    // one JSON document, one trailing newline, nothing else
    expect(first.stdout.endsWith('\n')).toBe(true);
    expect(first.stdout.trim().split('\n')).toHaveLength(1);
  });

  it('op "scenarios" with explicit specs, presets and the default', () => {
    const explicit = request({ op: 'scenarios', input: SYNTHETIC_CAFE, scenarios: DEFAULT_STRESS_TESTS });
    expect(explicit.status).toBe(0);
    expect(explicit.stdout).toBe(
      `${JSON.stringify({
        engineVersion: ENGINE_VERSION,
        baseInputHash: hashModelInput(SYNTHETIC_CAFE),
        scenarios: runScenarios(SYNTHETIC_CAFE, DEFAULT_STRESS_TESTS),
      })}\n`,
    );
    const byDefault = JSON.parse(request({ op: 'scenarios', input: SYNTHETIC_CAFE }).stdout);
    expect(byDefault.scenarios.map((run: { key: string }) => run.key)).toEqual(DEFAULT_SCENARIOS.map((spec) => spec.key));
    const all = JSON.parse(request({ op: 'scenarios', input: SYNTHETIC_CAFE, scenarios: 'all' }).stdout);
    expect(all.scenarios).toHaveLength(DEFAULT_SCENARIOS.length + DEFAULT_STRESS_TESTS.length);
    const stress = JSON.parse(request({ op: 'scenarios', input: SYNTHETIC_CAFE, scenarios: 'stress' }).stdout);
    expect(stress.scenarios.map((run: { kind: string }) => run.kind)).toEqual(DEFAULT_STRESS_TESTS.map((spec) => spec.kind));
  });

  it('op "sensitivity"', () => {
    const out = request({ op: 'sensitivity', input: SYNTHETIC_CAFE, params: ['price', 'volume'], deltas: [-10, 10], metric: 'peakFundingNeed' });
    expect(out.status).toBe(0);
    expect(out.stdout).toBe(`${JSON.stringify(sensitivity(SYNTHETIC_CAFE, ['price', 'volume'], [-10, 10], 'peakFundingNeed'))}\n`);
    const defaults = request({ op: 'sensitivity', input: SYNTHETIC_CAFE });
    expect(defaults.stdout).toBe(`${JSON.stringify(sensitivity(SYNTHETIC_CAFE))}\n`);
  });

  it('ops "validate", "hash", "defaults", "archetypes"', () => {
    expect(JSON.parse(request({ op: 'validate', input: SYNTHETIC_CAFE }).stdout)).toEqual({
      ok: true,
      inputHash: hashModelInput(SYNTHETIC_CAFE),
      issues: [],
    });
    const invalid = request({ op: 'validate', input: { ...SYNTHETIC_CAFE, horizonMonths: 3 } });
    expect(invalid.status).toBe(0); // validation is the requested answer, not a failure
    expect(JSON.parse(invalid.stdout)).toEqual({
      ok: false,
      inputHash: null,
      issues: [{ path: 'horizonMonths', message: 'horizonMonths must be between 12 and 120' }],
    });
    expect(JSON.parse(request({ op: 'hash', input: SYNTHETIC_CAFE }).stdout)).toEqual({
      engineVersion: ENGINE_VERSION,
      inputHash: hashModelInput(SYNTHETIC_CAFE),
    });
    const defaults = JSON.parse(request({ op: 'defaults' }).stdout);
    expect(defaults.scenarios).toEqual(JSON.parse(JSON.stringify(DEFAULT_SCENARIOS)));
    expect(defaults.stressTests).toEqual(JSON.parse(JSON.stringify(DEFAULT_STRESS_TESTS)));
    expect(defaults.sensitivity.deltas).toEqual([-20, -10, 10, 20]);
    expect(JSON.parse(request({ op: 'archetypes' }).stdout).archetypes).toEqual(JSON.parse(JSON.stringify(ARCHETYPES)));
  });

  it('invalid model input: exit code 2, JSON {error} on stderr, nothing on stdout', () => {
    const out = request({ op: 'run', input: { ...SYNTHETIC_CAFE, contingencyPct: -5 } });
    expect(out.status).toBe(2);
    expect(out.stdout).toBe('');
    expect(JSON.parse(out.stderr)).toEqual({
      error: {
        code: 'INVALID_INPUT',
        message: 'Invalid model input: contingencyPct: contingencyPct must be between 0 and 100 (percent)',
        issues: [{ path: 'contingencyPct', message: 'contingencyPct must be between 0 and 100 (percent)' }],
      },
    });
    const missing = request({ op: 'run' });
    expect(missing.status).toBe(2);
    expect(JSON.parse(missing.stderr).error.code).toBe('INVALID_INPUT');
  });

  it('malformed requests: exit code 2 with a machine-readable error code', () => {
    const notJson = cli('this is not json');
    expect(notJson.status).toBe(2);
    expect(notJson.stdout).toBe('');
    expect(JSON.parse(notJson.stderr).error.code).toBe('INVALID_JSON');

    const empty = cli('');
    expect(empty.status).toBe(2);
    expect(JSON.parse(empty.stderr).error.code).toBe('INVALID_JSON');

    const unknownOp = request({ op: 'predict', input: SYNTHETIC_CAFE });
    expect(unknownOp.status).toBe(2);
    expect(JSON.parse(unknownOp.stderr).error).toMatchObject({ code: 'UNKNOWN_OP' });

    const notObject = cli('[1,2,3]');
    expect(notObject.status).toBe(2);
    expect(JSON.parse(notObject.stderr).error.code).toBe('INVALID_REQUEST');

    const badScenarios = request({ op: 'scenarios', input: SYNTHETIC_CAFE, scenarios: 'everything' });
    expect(badScenarios.status).toBe(2);
    expect(JSON.parse(badScenarios.stderr).error.code).toBe('INVALID_REQUEST');

    const badSpec = request({ op: 'scenarios', input: SYNTHETIC_CAFE, scenarios: [{ key: 'x' }] });
    expect(badSpec.status).toBe(2);
    expect(JSON.parse(badSpec.stderr).error.code).toBe('INVALID_INPUT');

    const badSensitivity = request({ op: 'sensitivity', input: SYNTHETIC_CAFE, params: ['weather'] });
    expect(badSensitivity.status).toBe(2);
    expect(JSON.parse(badSensitivity.stderr).error.issues[0].path).toBe('params[0]');
  });
});

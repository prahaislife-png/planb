/**
 * Command-line bridge for non-JS callers (e.g. the Python worker).
 *
 *   echo '{"op":"run","input":{...}}' | node dist/cli.mjs
 *
 * Reads ONE JSON request from stdin, writes ONE JSON document + "\n" to stdout.
 * On failure nothing is written to stdout; a JSON `{"error":{code,message,issues?}}`
 * goes to stderr and the exit code is 2 (bad request / invalid input) or 1 (internal error).
 *
 * This file is the only place in the package that performs I/O.
 */
import { ARCHETYPES } from './archetypes';
import { hashModelInput, runModel } from './engine';
import { DEFAULT_SCENARIOS, DEFAULT_STRESS_TESTS, runScenarios, type ScenarioSpec } from './scenarios';
import { ModelValidationError, validateModelInput, type ModelInput } from './schema';
import {
  DEFAULT_SENSITIVITY_DELTAS,
  DEFAULT_SENSITIVITY_PARAMS,
  SENSITIVITY_METRICS,
  SENSITIVITY_PARAMS,
  sensitivity,
  type SensitivityMetric,
  type SensitivityParam,
} from './sensitivity';
import { ENGINE_NAME, ENGINE_VERSION } from './version';

class RequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const OPS = ['run', 'scenarios', 'sensitivity', 'validate', 'hash', 'defaults', 'archetypes', 'version'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveScenarios(value: unknown): readonly ScenarioSpec[] {
  if (value === undefined || value === 'default') return DEFAULT_SCENARIOS;
  if (value === 'stress') return DEFAULT_STRESS_TESTS;
  if (value === 'all') return [...DEFAULT_SCENARIOS, ...DEFAULT_STRESS_TESTS];
  if (Array.isArray(value)) return value as ScenarioSpec[];
  throw new RequestError(
    'INVALID_REQUEST',
    '"scenarios" must be an array of ScenarioSpec, or one of "default", "stress", "all"',
  );
}

export function handleRequest(request: unknown): unknown {
  if (!isRecord(request)) {
    throw new RequestError('INVALID_REQUEST', 'the request must be a JSON object with an "op" field');
  }
  const op = request.op;
  const input = request.input as ModelInput;

  switch (op) {
    case 'run':
      return runModel(input);
    case 'scenarios': {
      const scenarios = runScenarios(input, resolveScenarios(request.scenarios));
      return { engineVersion: ENGINE_VERSION, baseInputHash: hashModelInput(input), scenarios };
    }
    case 'sensitivity':
      return sensitivity(
        input,
        (request.params ?? DEFAULT_SENSITIVITY_PARAMS) as SensitivityParam[],
        (request.deltas ?? DEFAULT_SENSITIVITY_DELTAS) as number[],
        (request.metric ?? 'steadyStateEbitda') as SensitivityMetric,
      );
    case 'validate': {
      const outcome = validateModelInput(input);
      return outcome.ok
        ? { ok: true, inputHash: hashModelInput(outcome.input), issues: [] }
        : { ok: false, inputHash: null, issues: outcome.issues };
    }
    case 'hash':
      return { engineVersion: ENGINE_VERSION, inputHash: hashModelInput(input) };
    case 'defaults':
      return {
        engineVersion: ENGINE_VERSION,
        scenarios: DEFAULT_SCENARIOS,
        stressTests: DEFAULT_STRESS_TESTS,
        sensitivity: {
          params: DEFAULT_SENSITIVITY_PARAMS,
          deltas: DEFAULT_SENSITIVITY_DELTAS,
          allParams: SENSITIVITY_PARAMS,
          metrics: SENSITIVITY_METRICS,
        },
      };
    case 'archetypes':
      return { engineVersion: ENGINE_VERSION, archetypes: ARCHETYPES };
    case 'version':
      return { name: ENGINE_NAME, engineVersion: ENGINE_VERSION };
    default:
      throw new RequestError(
        'UNKNOWN_OP',
        `unknown op ${JSON.stringify(op)}; expected one of ${OPS.map((o) => `"${o}"`).join(', ')}`,
      );
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function fail(exitCode: number, error: { code: string; message: string; issues?: unknown }): void {
  process.stderr.write(`${JSON.stringify({ error })}\n`);
  process.exitCode = exitCode;
}

async function main(): Promise<void> {
  let request: unknown;
  try {
    const text = await readStdin();
    if (text.trim() === '') throw new RequestError('INVALID_JSON', 'empty request: expected a JSON object on stdin');
    try {
      request = JSON.parse(text);
    } catch (error) {
      throw new RequestError('INVALID_JSON', `request is not valid JSON: ${(error as Error).message}`);
    }
    const response = handleRequest(request);
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    if (error instanceof ModelValidationError) {
      fail(2, { code: error.code, message: error.message, issues: error.issues });
    } else if (error instanceof RequestError) {
      fail(2, { code: error.code, message: error.message });
    } else {
      fail(1, { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) });
    }
  }
}

void main();

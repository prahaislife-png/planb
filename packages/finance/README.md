# @planb/finance

Deterministic financial modelling engine for PlanB: a monthly model of a small business
(investment, revenue drivers, costs, loan, subsidy, tax, working capital, closure) built from
pure functions. No LLM, no I/O in the core, no randomness, no clock.

**The full specification — every metric's exact definition, the calculation order and the
limitations — is in [`docs/FINANCE_ENGINE.md`](./docs/FINANCE_ENGINE.md). Read it before changing
or presenting any number.**

## Use from TypeScript

```ts
import { runModel, runScenarios, sensitivity, DEFAULT_SCENARIOS, DEFAULT_STRESS_TESTS } from '@planb/finance';

const result = runModel(input);                        // throws ModelValidationError on bad input
const scenarios = runScenarios(input, [...DEFAULT_SCENARIOS, ...DEFAULT_STRESS_TESTS]);
const tornado = sensitivity(input, ['price', 'volume', 'fixed_costs'], [-20, -10, 10, 20], 'steadyStateEbitda');
```

The package exports TypeScript source (`exports` → `./src/index.ts`); in Next.js add it to
`transpilePackages`. The core has no Node dependencies and runs in the browser.

Main exports: `runModel`, `computeModel`, `parseModelInput`, `validateModelInput`, `hashModelInput`,
`ModelInputSchema`, `ModelValidationError`, `applyOverrides`, `applyAdjustments`, `runScenarios`,
`DEFAULT_SCENARIOS`, `DEFAULT_STRESS_TESTS`, `sensitivity`, `ARCHETYPES`, `ENGINE_VERSION`, and the
`ModelInput` / `ModelResult` types.

## Use from other languages (CLI)

```sh
pnpm --filter @planb/finance build          # -> dist/cli.mjs (single file, zod bundled)
echo '{"op":"run","input":{...}}' | node dist/cli.mjs
```

One JSON request on stdin, one JSON document on stdout; on error exit code 2 (invalid request/input)
or 1 (internal) with `{"error":{...}}` on stderr. Ops: `run`, `scenarios`, `sensitivity`, `validate`,
`hash`, `defaults`, `archetypes`, `version` — see §18 of the specification.

## Scripts

| Script | What it does |
|---|---|
| `pnpm test` | vitest (builds `dist/cli.mjs` first so the CLI test runs the real bundle) |
| `pnpm typecheck` | `tsc --noEmit` over `src` and `test` |
| `pnpm build` | tsup → `dist/cli.mjs` |

## Tests

`test/golden.*.test.ts` are hand-computed examples with the arithmetic written out in comments
(café, manufacturing with loan/moratorium/subsidy/tax, seasonal farm, equipment rental with
replacement). All fixtures are named `SYNTHETIC_*`: round, made-up numbers for testing the
arithmetic — they are not data about any real business and must never be shown as such.

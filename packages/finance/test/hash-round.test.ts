import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ENGINE_VERSION,
  canonicalJson,
  hashCanonical,
  hashModelInput,
  parseModelInput,
  round2,
  roundTo,
  runModel,
  sha256Hex,
  type ModelInput,
} from '../src/index';
import { utf8Encode } from '../src/sha256';
import { ALL_SYNTHETIC, SYNTHETIC_CAFE, SYNTHETIC_MANUFACTURING } from './fixtures';
import { clone } from './helpers';

const nodeSha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

describe('sha256 (pure TypeScript, synchronous)', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('matches node:crypto for many lengths (block-boundary cases) and for non-ASCII text', () => {
    for (let length = 0; length <= 200; length++) {
      const text = 'x'.repeat(length);
      expect(sha256Hex(text), `length ${length}`).toBe(nodeSha256(text));
    }
    for (const text of ['₹1,00,000 — कैफ़े', 'ünïcödé', '😀 emoji', 'a'.repeat(10_000), JSON.stringify(SYNTHETIC_MANUFACTURING)]) {
      expect(sha256Hex(text)).toBe(nodeSha256(text));
    }
  });

  it('encodes UTF-8 like TextEncoder', () => {
    for (const text of ['', 'plain', '₹', 'कैफ़े', '😀', '\ud800 lone surrogate']) {
      expect(Array.from(utf8Encode(text))).toEqual(Array.from(new TextEncoder().encode(text)));
    }
  });
});

describe('canonical JSON', () => {
  it('sorts keys, keeps array order, drops undefined, normalises -0', () => {
    expect(canonicalJson({ b: 1, a: [3, { z: 1, y: 2 }], c: undefined, d: null, e: -0 })).toBe('{"a":[3,{"y":2,"z":1}],"b":1,"d":null,"e":0}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson('₹ "quoted"')).toBe('"₹ \\"quoted\\""');
    expect(canonicalJson(0.1 + 0.2)).toBe('0.30000000000000004');
    expect(canonicalJson(1e21)).toBe('1e+21');
  });

  it('rejects values that have no canonical form', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => canonicalJson(new Date(0))).toThrow();
    expect(() => canonicalJson(() => 1)).toThrow();
    expect(() => canonicalJson(10n)).toThrow();
  });

  it('hashCanonical is sha256 of the canonical JSON', () => {
    expect(hashCanonical({ b: 1, a: 2 })).toBe(nodeSha256('{"a":2,"b":1}'));
  });
});

/** Rebuild an object with its keys in reverse order, recursively (arrays keep their order). */
function reverseKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => reverseKeys(item) as unknown) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).reverse()) {
      out[key] = reverseKeys((value as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return value;
}

describe('inputHash', () => {
  it('is a sha256 hex digest of the canonical validated input', () => {
    const result = runModel(SYNTHETIC_CAFE);
    expect(result.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.inputHash).toBe(nodeSha256(canonicalJson(parseModelInput(SYNTHETIC_CAFE))));
    expect(result.inputHash).toBe(hashModelInput(SYNTHETIC_CAFE));
    expect(result.engineVersion).toBe(ENGINE_VERSION);
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('does not depend on the key order of the input', () => {
    for (const input of Object.values(ALL_SYNTHETIC)) {
      const reversed = reverseKeys(input);
      expect(Object.keys(reversed)).not.toEqual(Object.keys(input));
      expect(hashModelInput(reversed)).toBe(hashModelInput(input));
      expect(JSON.stringify(runModel(reversed))).toBe(JSON.stringify(runModel(input)));
    }
  });

  it('is the same whether defaults are omitted or written out', () => {
    const explicit: ModelInput = {
      ...clone(SYNTHETIC_CAFE),
      tax: { kind: 'none' },
      priceEscalationPctAnnual: 0,
      costInflationPctAnnual: 0,
    };
    explicit.capex![0] = { ...explicit.capex![0]!, salvagePct: 0, depreciable: true, replaceAtEndOfLife: true };
    explicit.owner = { ...explicit.owner, annualEscalationPct: 0 };
    expect(hashModelInput(explicit)).toBe(hashModelInput(SYNTHETIC_CAFE));
  });

  it('changes when any number changes, and when array order changes', () => {
    const base = hashModelInput(SYNTHETIC_MANUFACTURING);
    const changed = clone(SYNTHETIC_MANUFACTURING);
    changed.capex![0]!.amount += 0.01;
    expect(hashModelInput(changed)).not.toBe(base);
    const reordered = clone(SYNTHETIC_MANUFACTURING);
    reordered.capex!.reverse();
    expect(hashModelInput(reordered)).not.toBe(base);
    const hashes = Object.values(ALL_SYNTHETIC).map((input) => hashModelInput(input));
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('is stable across engine runs (pinned value guards against accidental canonicalisation changes)', () => {
    const minimal: ModelInput = {
      revenueStreams: [{ key: 's', label: 'SYNTHETIC', driver: { kind: 'engagements', engagementsPerMonth: 1, realizedFee: 1 } }],
      owner: { monthlyCompensation: 0, treatment: 'drawings' },
    };
    const canonical =
      '{"capex":[],"contingencyPct":0,"costInflationPctAnnual":0,"deposits":[],"fixedCosts":[],"horizonMonths":60,' +
      '"owner":{"annualEscalationPct":0,"monthlyCompensation":0,"treatment":"drawings"},"preOperatingMonths":0,' +
      '"preOperativeExpenses":[],"priceEscalationPctAnnual":0,"rampUp":{"applyToAreaYield":false,"monthsToSteadyState":0,"startPct":100},' +
      '"revenueStreams":[{"driver":{"engagementsPerMonth":1,"kind":"engagements","realizedFee":1},"key":"s","label":"SYNTHETIC","variableCosts":[]}],' +
      '"staff":[],"startCalendarMonth":1,"tax":{"kind":"none"},"workingCapital":{"inventoryDays":0,"payableDays":0,"receivableDays":0}}';
    expect(canonicalJson(parseModelInput(minimal))).toBe(canonical);
    expect(hashModelInput(minimal)).toBe(nodeSha256(canonical));
  });
});

describe('round2', () => {
  it('rounds half away from zero on the decimal value', () => {
    expect(round2(1.005)).toBe(1.01); // plain Math.round(1.005 * 100) / 100 gives 1
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(1.004999)).toBe(1);
    expect(round2(0.125)).toBe(0.13);
    expect(round2(-0.125)).toBe(-0.13);
    expect(round2(1234.5649)).toBe(1234.56);
    expect(round2(1e9 + 0.005)).toBe(1e9 + 0.01);
    expect(round2(293_103.448275862)).toBe(293_103.45);
  });

  it('never returns -0 and keeps integers intact', () => {
    expect(Object.is(round2(-0.0001), 0)).toBe(true);
    expect(Object.is(round2(-0), 0)).toBe(true);
    expect(round2(100)).toBe(100);
    expect(round2(-250_000)).toBe(-250_000);
    expect(JSON.stringify({ value: round2(-1e-9) })).toBe('{"value":0}');
  });

  it('refuses non-finite numbers and supports other precisions', () => {
    expect(() => round2(Number.NaN)).toThrow();
    expect(() => round2(Number.POSITIVE_INFINITY)).toThrow();
    expect(roundTo(0.8333333333, 6)).toBe(0.833333);
    expect(roundTo(1234.5, 0)).toBe(1235);
  });
});

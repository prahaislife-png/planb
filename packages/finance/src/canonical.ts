import { sha256Hex } from './sha256';

/**
 * Canonical JSON: a deterministic serialisation used for hashing inputs.
 *
 *  - object keys are sorted by UTF-16 code unit order (plain `Array.prototype.sort`);
 *  - keys whose value is `undefined` are omitted;
 *  - array order is preserved (it is meaningful);
 *  - numbers use the ECMAScript shortest round-trip form (`JSON.stringify`), `-0` becomes `0`;
 *  - non-finite numbers, functions, symbols, bigints and non-plain objects are rejected.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error('canonicalJson: non-finite numbers cannot be serialised');
      }
      return Object.is(value, -0) ? '0' : JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
      }
      const proto = Object.getPrototypeOf(value) as unknown;
      if (proto !== Object.prototype && proto !== null) {
        throw new Error('canonicalJson: only plain objects and arrays are supported');
      }
      const record = value as Record<string, unknown>;
      const parts: string[] = [];
      for (const key of Object.keys(record).sort()) {
        const item = record[key];
        if (item === undefined) continue;
        parts.push(`${JSON.stringify(key)}:${canonicalJson(item)}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported value of type ${typeof value}`);
  }
}

/** sha256 (hex) of the canonical JSON of `value`. */
export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

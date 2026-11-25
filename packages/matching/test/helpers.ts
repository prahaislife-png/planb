import type { FeasibilityCheck, FeasibilityCheckKey, FitDimension, FitDimensionKey, MatchResult, PersonProfile } from '../src/index';
import { SYNTHETIC_PROFILE } from './fixtures';

export function check(result: MatchResult, key: FeasibilityCheckKey): FeasibilityCheck {
  const c = result.feasibility.find((x) => x.key === key);
  if (!c) throw new Error(`no check ${key}`);
  return c;
}

export function dim(result: MatchResult, key: FitDimensionKey): FitDimension {
  const d = result.fit.find((x) => x.key === key);
  if (!d) throw new Error(`no dimension ${key}`);
  return d;
}

/** SYNTHETIC_PROFILE with some fields replaced. */
export function person(overrides: Partial<PersonProfile> = {}): PersonProfile {
  return { ...SYNTHETIC_PROFILE(), ...overrides };
}

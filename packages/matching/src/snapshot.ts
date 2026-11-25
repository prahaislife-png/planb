/**
 * The business side of a match: exactly the fields of the `intel.build_business_snapshot` JSON that the engine
 * reads, and nothing else. Every field is optional and nullable — a record under research has gaps, and the
 * engine's job is to report a gap as `unknown`, never to fill it.
 *
 * Field names are the snapshot's own (snake_case from SQL, camelCase inside the finance engine's summary).
 */

export interface SnapshotScenarioSummary {
  /** Not emitted by the pipeline today; read if a later snapshot carries it. */
  preOperatingMonths?: number | null;
  initialInvestment?: { total?: number | null } | null;
  funding?: { loan?: number | null; ownerEquityUpfront?: number | null } | null;
  /** The finance engine's `Summary` (packages/finance/src/types.ts). */
  summary?: {
    breakEven?: { firstOperatingMonthNetCashPositive?: number | null } | null;
    capitalRecovery?: { paybackOperatingMonth?: number | null } | null;
    peakFundingNeed?: number | null;
    totalOwnerCashRequired?: number | null;
    minDscr?: number | null;
    ownerIncome?: { year1AvgMonthly?: number | null; year2AvgMonthly?: number | null; year3AvgMonthly?: number | null } | null;
  } | null;
  /** The finance engine's `ClosureResult`; present on failure scenarios. */
  closure?: { atOperatingMonth?: number | null; ownerCapitalLost?: number | null } | null;
  /** Present only on a scenario built with local evidence for one location. */
  locationCoverage?: {
    local_inputs?: number | null;
    inherited_national_inputs?: number | null;
    by_level?: Record<string, number> | null;
  } | null;
}

export interface SnapshotScenario {
  scenario_key?: string | null;
  label?: string | null;
  kind?: string | null;
  summary?: SnapshotScenarioSummary | null;
  warnings?: Array<{ code?: string | null }> | null;
  grade_profile?: { A?: number | null; B?: number | null; C?: number | null; D?: number | null; observed?: number | null; derived?: number | null; assumptions?: number | null } | null;
  assumption_count?: number | null;
  weakest_grade?: string | null;
}

export interface SnapshotLifestyle {
  owner_involvement?: string | null;
  owner_hours_per_week_low?: number | null;
  owner_hours_per_week_high?: number | null;
  weekend_work?: string | null;
  physical_demand?: number | null;
  operational_complexity?: number | null;
  basis?: string | null;
  evidence_grade?: string | null;
}

export interface SnapshotVariant {
  name?: string | null;
  slug?: string | null;
  is_reference?: boolean | null;
  /** Only the observation fields used to describe where the cost figures come from. */
  cost_items?: Array<{ observations?: Array<{ observed_on?: string | null; evidence_type?: string | null; source?: string | null }> | null }> | null;
  /** Only `pre_operating_months` is read. */
  parameters?: Array<{ key?: string | null; value?: number | null; basis?: string | null; is_resolved?: boolean | null }> | null;
  operating_requirements?: Array<{ type?: string | null; name?: string | null; value?: number | null; unit?: string | null; text?: string | null; is_critical?: boolean | null }> | null;
  lifestyle?: SnapshotLifestyle | null;
  /**
   * Asset requirements (rows of intel.business_assets). NOT emitted by the snapshot builder today — until it is,
   * this is undefined and the asset check reports `unknown`.
   */
  assets?: Array<{ asset_type_slug?: string | null; name?: string | null; requirement_level?: string | null }> | null;
  scenarios?: SnapshotScenario[] | null;
}

export interface SnapshotFounderRequirements {
  mandatory_qualifications?: string | null;
  certifications?: string | null;
  training_duration_weeks?: number | null;
  learning_difficulty?: number | null;
  basis?: string | null;
  evidence_grade?: string | null;
}

export interface SnapshotEvidenceQuality {
  grade_a?: number | null;
  grade_b?: number | null;
  grade_c?: number | null;
  grade_d?: number | null;
  observation_count?: number | null;
  verified_count?: number | null;
  stale_count?: number | null;
  open_conflicts?: number | null;
  assumption_count?: number | null;
  parameter_count?: number | null;
  claims_pending_review?: number | null;
  distinct_sources?: number | null;
}

export interface SnapshotCompleteness {
  completeness_pct?: number | null;
  critical_missing?: number | null;
  critical_missing_checks?: string[] | null;
  missing_checks?: string[] | null;
  checks_total?: number | null;
  checks_passed?: number | null;
}

export interface BusinessSnapshot {
  model?: {
    slug?: string | null;
    name?: string | null;
    family?: string | null;
    industry?: { slug?: string | null; name?: string | null } | null;
    description?: string | null;
    operating_model?: string | null;
    target_customers?: string | null;
    classifications?: Array<{ title?: string | null }> | null;
  } | null;
  variants?: SnapshotVariant[] | null;
  skills?: Array<{ slug?: string | null; name?: string | null; importance?: number | null; acquisition?: string | null }> | null;
  founder_requirements?: SnapshotFounderRequirements | null;
  regulations?: Array<{ name?: string | null; applicability?: string | null; stage?: string | null }> | null;
  risks?: Array<{ type?: string | null; title?: string | null; severity?: string | null }> | null;
  quality?: { completeness?: SnapshotCompleteness | null; evidence?: SnapshotEvidenceQuality | null } | null;
}

// ── tolerant readers ─────────────────────────────────────────────────────────

/** A finite number, or null for anything else (missing, null, NaN, a string…). */
export function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A non-blank string (trimmed), or null. */
export function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function listOf<T>(value: ReadonlyArray<T> | null | undefined): ReadonlyArray<T> {
  return Array.isArray(value) ? value : [];
}

// ── narrowing ────────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);
const arr = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);

/** Copies the named keys that are present (keeping `null` as `null` and leaving absent keys absent). */
function pick(source: unknown, keys: readonly string[]): Raw | null | undefined {
  if (source === undefined) return undefined;
  const o = obj(source);
  if (!o) return null;
  const out: Raw = {};
  for (const k of keys) if (k in o && o[k] !== undefined) out[k] = o[k];
  return out;
}

function mapArr(source: unknown, fn: (item: unknown) => unknown): unknown[] | null | undefined {
  if (source === undefined) return undefined;
  const a = arr(source);
  return a ? a.map(fn) : null;
}

function put(target: Raw, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

function narrowScenario(raw: unknown): unknown {
  const out = pick(raw, ['scenario_key', 'label', 'kind', 'assumption_count', 'weakest_grade']) ?? {};
  const o = obj(raw) ?? {};
  put(out, 'warnings', mapArr(o.warnings, (w) => pick(w, ['code']) ?? {}));
  put(out, 'grade_profile', pick(o.grade_profile, ['A', 'B', 'C', 'D', 'observed', 'derived', 'assumptions']));
  if (o.summary !== undefined) {
    const s = obj(o.summary);
    if (!s) out.summary = null;
    else {
      const summary = pick(s, ['preOperatingMonths']) ?? {};
      put(summary, 'initialInvestment', pick(s.initialInvestment, ['total']));
      put(summary, 'funding', pick(s.funding, ['loan', 'ownerEquityUpfront']));
      put(summary, 'closure', pick(s.closure, ['atOperatingMonth', 'ownerCapitalLost']));
      put(summary, 'locationCoverage', pick(s.locationCoverage, ['local_inputs', 'inherited_national_inputs', 'by_level']));
      if (s.summary !== undefined) {
        const m = obj(s.summary);
        if (!m) summary.summary = null;
        else {
          const inner = pick(m, ['peakFundingNeed', 'totalOwnerCashRequired', 'minDscr']) ?? {};
          put(inner, 'breakEven', pick(m.breakEven, ['firstOperatingMonthNetCashPositive']));
          put(inner, 'capitalRecovery', pick(m.capitalRecovery, ['paybackOperatingMonth']));
          put(inner, 'ownerIncome', pick(m.ownerIncome, ['year1AvgMonthly', 'year2AvgMonthly', 'year3AvgMonthly']));
          summary.summary = inner;
        }
      }
      out.summary = summary;
    }
  }
  return out;
}

function narrowVariant(raw: unknown): unknown {
  const out = pick(raw, ['name', 'slug', 'is_reference']) ?? {};
  const o = obj(raw) ?? {};
  put(out, 'cost_items', mapArr(o.cost_items, (c) => {
    const item: Raw = {};
    put(item, 'observations', mapArr(obj(c)?.observations, (ob) => pick(ob, ['observed_on', 'evidence_type', 'source']) ?? {}));
    return item;
  }));
  const params = mapArr(o.parameters, (p) => pick(p, ['key', 'value', 'basis', 'is_resolved']) ?? {});
  put(out, 'parameters', params ? params.filter((p) => (p as Raw).key === 'pre_operating_months') : params);
  put(out, 'operating_requirements', mapArr(o.operating_requirements, (r) => pick(r, ['type', 'name', 'value', 'unit', 'text', 'is_critical']) ?? {}));
  put(out, 'lifestyle', pick(o.lifestyle, ['owner_involvement', 'owner_hours_per_week_low', 'owner_hours_per_week_high', 'weekend_work', 'physical_demand', 'operational_complexity', 'basis', 'evidence_grade']));
  put(out, 'assets', mapArr(o.assets, (a) => pick(a, ['asset_type_slug', 'name', 'requirement_level']) ?? {}));
  put(out, 'scenarios', mapArr(o.scenarios, narrowScenario));
  return out;
}

/**
 * Reduce a full snapshot (which also carries every observation, source and launch task) to the fields the engine
 * reads. Pure and lossless for matching: `matchBusiness(p, narrowSnapshot(s))` equals `matchBusiness(p, s)`.
 * Use it before sending snapshots to a browser.
 */
export function narrowSnapshot(raw: unknown): BusinessSnapshot {
  const o = obj(raw) ?? {};
  const out: Raw = {};
  if (o.model !== undefined) {
    const model = pick(o.model, ['slug', 'name', 'family', 'description', 'operating_model', 'target_customers']);
    if (model) {
      const m = obj(o.model) ?? {};
      put(model, 'industry', pick(m.industry, ['slug', 'name']));
      put(model, 'classifications', mapArr(m.classifications, (c) => pick(c, ['title']) ?? {}));
    }
    out.model = model;
  }
  put(out, 'variants', mapArr(o.variants, narrowVariant));
  put(out, 'skills', mapArr(o.skills, (s) => pick(s, ['slug', 'name', 'importance', 'acquisition']) ?? {}));
  put(out, 'founder_requirements', pick(o.founder_requirements, ['mandatory_qualifications', 'certifications', 'training_duration_weeks', 'learning_difficulty', 'basis', 'evidence_grade']));
  put(out, 'regulations', mapArr(o.regulations, (r) => pick(r, ['name', 'applicability', 'stage']) ?? {}));
  put(out, 'risks', mapArr(o.risks, (r) => pick(r, ['type', 'title', 'severity']) ?? {}));
  if (o.quality !== undefined) {
    const q = obj(o.quality);
    if (!q) out.quality = null;
    else {
      const quality: Raw = {};
      put(quality, 'completeness', pick(q.completeness, ['completeness_pct', 'critical_missing', 'critical_missing_checks', 'missing_checks', 'checks_total', 'checks_passed']));
      put(quality, 'evidence', pick(q.evidence, ['grade_a', 'grade_b', 'grade_c', 'grade_d', 'observation_count', 'verified_count', 'stale_count', 'open_conflicts', 'assumption_count', 'parameter_count', 'claims_pending_review', 'distinct_sources']));
      out.quality = quality;
    }
  }
  return out as BusinessSnapshot;
}

// ── scenario selection ───────────────────────────────────────────────────────

export interface LocalScenario {
  scenario: SnapshotScenario;
  /** The location name carried by the scenario's label (the snapshot has no location id or slug). */
  locationName: string;
}

export interface SelectedScenarios {
  /** The variant flagged `is_reference`, or null. The engine never falls back to another variant. */
  variant: SnapshotVariant | null;
  /** kind = 'base' with no `locationCoverage`. */
  nationalBase: SnapshotScenario | null;
  /** Every kind = 'base' scenario that has `locationCoverage`. */
  localScenarios: LocalScenario[];
  /** The local scenario for the person's preferred location, if one exists. */
  localBase: LocalScenario | null;
  /** kind = 'failure' scenarios that carry a closure result. */
  closures: SnapshotScenario[];
  /** kind = 'stress', scenario_key = 'stress_revenue_minus_20'. */
  stressRevenueMinus20: SnapshotScenario | null;
  /** From the reference variant's resolved `pre_operating_months` parameter (or the summary, if it carries it). */
  preOperatingMonths: number | null;
  /** True when that parameter is recorded as an assumption rather than evidence. */
  preOperatingMonthsIsAssumption: boolean;
}

const LOCAL_LABEL_PREFIX = /^base case\s*[—–-]\s*/i;

const normaliseName = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function selectScenarios(
  snapshot: BusinessSnapshot,
  location: { slug: string | null; name: string | null },
  stressKey: string,
): SelectedScenarios {
  const variant = listOf(snapshot.variants).find((v) => v?.is_reference === true) ?? null;
  const scenarios = listOf(variant?.scenarios).filter((s): s is SnapshotScenario => s != null);
  const bases = scenarios.filter((s) => s.kind === 'base');
  const nationals = bases.filter((s) => s.summary?.locationCoverage == null);
  const nationalBase = nationals.find((s) => s.scenario_key === 'base') ?? nationals[0] ?? null;

  const localScenarios: LocalScenario[] = bases
    .filter((s) => s.summary?.locationCoverage != null)
    .map((s) => ({ scenario: s, locationName: (textOrNull(s.label) ?? 'unnamed location').replace(LOCAL_LABEL_PREFIX, '').trim() }));
  let localBase: LocalScenario | null = null;
  if (location.slug !== null) {
    const wanted = [location.name, location.slug].filter((x): x is string => x != null).map(normaliseName);
    localBase = localScenarios.find((l) => wanted.includes(normaliseName(l.locationName))) ?? null;
  }

  const closures = scenarios.filter((s) => s.kind === 'failure' && s.summary?.closure != null);
  const stressRevenueMinus20 = scenarios.find((s) => s.kind === 'stress' && s.scenario_key === stressKey) ?? null;

  let preOperatingMonths = numberOrNull(nationalBase?.summary?.preOperatingMonths);
  let preOperatingMonthsIsAssumption = false;
  if (preOperatingMonths === null) {
    const param = listOf(variant?.parameters).find((p) => p?.key === 'pre_operating_months' && p.is_resolved !== false);
    preOperatingMonths = numberOrNull(param?.value);
    preOperatingMonthsIsAssumption = param?.basis === 'assumption';
  }
  if (preOperatingMonths !== null && preOperatingMonths < 0) preOperatingMonths = null;

  return { variant, nationalBase, localScenarios, localBase, closures, stressRevenueMinus20, preOperatingMonths, preOperatingMonthsIsAssumption };
}

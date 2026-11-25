'use client';

import { useMemo, useState } from 'react';
import {
  explainChange,
  matchBusinesses,
  validateProfile,
  CAPABILITY_HELD_MIN_PROFICIENCY,
  INVOLVEMENT_LEVELS,
  RISK_TOLERANCES,
  type BusinessSnapshot,
  type CheckStatus,
  type ConfidenceLevel,
  type Feasible,
  type FitLevel,
  type MatchResult,
  type PersonProfile,
  type UnknownCause,
} from '@planb/matching';
import { humanize } from '@/lib/format';
import { Badge, GradeBar, Panel } from '@/components/ui';

/**
 * Profile form + live results. The engine (packages/matching) runs here in the browser on every change; nothing
 * is sent to a server and nothing is saved. The form starts empty: it describes no one until someone types.
 */

export interface LabRecord {
  versionId: string;
  versionNo: number;
  status: string;
  submittedAt: string;
  isLive: boolean;
  slug: string;
  snapshot: BusinessSnapshot;
}
interface Option { slug: string; name: string }

interface Form {
  capital: string; reserve: string; goal: string; income: string; hours: string; timeline: string;
  risk: string; involvement: string; weekend: string; physical: string; loan: string; location: string;
  interests: string; qualifications: string;
  capabilities: Record<string, number>;
  assets: string[];
}

const EMPTY_FORM: Form = {
  capital: '', reserve: '', goal: '', income: '', hours: '', timeline: '',
  risk: '', involvement: '', weekend: '', physical: '', loan: '', location: '',
  interests: '', qualifications: '', capabilities: {}, assets: [],
};

const numberOrNull = (s: string): number | null => (s.trim() === '' ? null : Number(s));
const yesNoOrNull = (s: string): boolean | null => (s === 'yes' ? true : s === 'no' ? false : null);
const splitList = (s: string, separators: RegExp): string[] => s.split(separators).map((x) => x.trim()).filter((x) => x !== '');

function toProfile(f: Form, locations: Option[]): unknown {
  return {
    investableCapitalInr: numberOrNull(f.capital),
    reserveRequirementInr: numberOrNull(f.reserve),
    monthlyIncomeGoalInr: numberOrNull(f.goal),
    currentMonthlyIncomeInr: numberOrNull(f.income),
    riskTolerance: f.risk || null,
    desiredInvolvement: f.involvement || null,
    maxHoursPerWeek: numberOrNull(f.hours),
    weekendWorkOk: yesNoOrNull(f.weekend),
    physicalWorkTolerance: numberOrNull(f.physical),
    transitionTimelineMonths: numberOrNull(f.timeline),
    preferredLocationSlug: f.location || null,
    preferredLocationName: locations.find((l) => l.slug === f.location)?.name ?? null,
    interests: splitList(f.interests, /[,\n]+/),
    capabilities: Object.entries(f.capabilities).map(([skillSlug, proficiency]) => ({ skillSlug, proficiency })),
    assets: f.assets.map((assetTypeSlug) => ({ assetTypeSlug })),
    qualificationsHeld: splitList(f.qualifications, /[;\n]+/),
    willingToTakeLoan: yesNoOrNull(f.loan),
  };
}

const STATUS_TONE: Record<CheckStatus, 'good' | 'bad' | undefined> = { pass: 'good', fail: 'bad', unknown: undefined };
const LEVEL_TONE: Record<FitLevel, 'good' | 'warn' | 'bad' | undefined> = { strong: 'good', moderate: 'warn', weak: 'bad', unknown: undefined };
const FEASIBLE_TONE: Record<Feasible, 'good' | 'warn' | 'bad'> = { yes: 'good', cannot_assess: 'warn', no: 'bad' };
const FEASIBLE_LABEL: Record<Feasible, string> = {
  yes: 'passes every mandatory check',
  cannot_assess: 'feasibility cannot be assessed',
  no: 'fails a mandatory check',
};
const CONFIDENCE_TONE: Record<ConfidenceLevel, 'good' | 'warn' | 'bad'> = { well_evidenced: 'good', partly_evidenced: 'warn', thinly_evidenced: 'bad' };
const UNKNOWN_LABEL: Record<UnknownCause, string> = {
  not_researched: 'unknown — not researched',
  not_stated_by_person: 'unknown — not in the profile',
};
const outcomeLabel = (value: string, cause?: UnknownCause): string => (value === 'unknown' ? UNKNOWN_LABEL[cause ?? 'not_researched'] : value);
const count = (n: number | null): string => (n === null ? '—' : String(n));

function ResultCard({ result, record, changes }: { result: MatchResult; record: LabRecord | undefined; changes: string[] }) {
  const c = result.researchConfidence;
  return (
    <Panel
      title={<span data-testid="business-name">{result.business.name}</span>}
      right={<>
        <span data-testid="feasible"><Badge value={FEASIBLE_LABEL[result.feasible]} tone={FEASIBLE_TONE[result.feasible]} /></span>
        {record ? <span className="muted">version {record.versionNo} · {humanize(record.status)} · {record.submittedAt}</span> : null}
        {record ? (record.isLive ? <Badge value="published" tone="good" /> : <Badge value="unpublished research version" tone="warn" title="Customers are never matched against this version." />) : null}
      </>}>
      <div className="grid" data-testid={`result-${result.business.slug ?? 'unnamed'}`}>
        <div className="muted small">
          {[result.business.industry, result.business.family].filter(Boolean).join(' · ') || 'industry not recorded'}
          {' — compared on '}
          {result.basis.variantName
            ? <>the reference variant “{result.basis.variantName}”, {result.basis.nationalScenarioLabel ? <>national scenario “{result.basis.nationalScenarioLabel}”</> : 'which has no base scenario'}
              {result.basis.localScenario ? <> and the local scenario for {result.basis.localScenario.locationName} ({count(result.basis.localScenario.localInputs)} local inputs, {count(result.basis.localScenario.inheritedNationalInputs)} inherited)</> : '; no local scenario'}.</>
            : 'no costed case: the record marks no reference variant.'}
        </div>

        {changes.length ? (
          <div className="notice" data-testid="changes">
            <b>Changed by your last edit</b>
            <ul>{changes.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
        ) : null}

        <div>
          <h3>Feasibility — mandatory checks</h3>
          <table>
            <thead><tr><th style={{ width: 210 }}>Check</th><th style={{ width: 200 }}>Outcome</th><th>Reason</th></tr></thead>
            <tbody>
              {result.feasibility.map((check) => (
                <tr key={check.key} data-testid={`check-${check.key}`}>
                  <td>{check.label}</td>
                  <td><Badge value={outcomeLabel(check.status, check.unknownCause)} tone={STATUS_TONE[check.status]} /></td>
                  <td>{check.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h3>Fit — by dimension</h3>
          <table>
            <thead><tr><th style={{ width: 210 }}>Dimension</th><th style={{ width: 200 }}>Level</th><th>Reason</th></tr></thead>
            <tbody>
              {result.fit.map((d) => (
                <tr key={d.key} data-testid={`dimension-${d.key}`}>
                  <td>{d.label}</td>
                  <td><Badge value={outcomeLabel(d.level, d.unknownCause)} tone={LEVEL_TONE[d.level]} /></td>
                  <td>{d.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid g2">
          <div>
            <h3>Trade-offs</h3>
            {result.tradeOffs.length
              ? <ul style={{ margin: 0, paddingLeft: 18 }}>{result.tradeOffs.map((t, i) => <li key={i}>{t}</li>)}</ul>
              : <div className="faint">None can be stated from what is recorded and what the profile says.</div>}
            {result.whyNotSuitable ? (
              <div style={{ marginTop: 12 }}>
                <h3>Why this may not suit this person</h3>
                <ul style={{ margin: 0, paddingLeft: 18 }}>{result.whyNotSuitable.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            ) : null}
          </div>
          <div>
            <h3>Missing prerequisites</h3>
            {result.missingPrerequisites.length
              ? <ul style={{ margin: 0, paddingLeft: 18 }}>{result.missingPrerequisites.map((m, i) => <li key={i}><Badge value={m.kind} /> {m.description}</li>)}</ul>
              : <div className="faint">None identified — which, where a section is unresearched, only means none could be checked.</div>}
            {result.notResearched.length ? (
              <div style={{ marginTop: 12 }}>
                <h3>Not researched in this record</h3>
                <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>{result.notResearched.map((t, i) => <li key={i}>{t}</li>)}</ul>
              </div>
            ) : null}
          </div>
        </div>

        <div style={{ borderTop: '2px solid var(--line)', paddingTop: 12 }} data-testid="research-confidence">
          <Panel title="Research confidence" right={<Badge value={c.level} tone={CONFIDENCE_TONE[c.level]} />}>
            <div className="muted small" style={{ marginBottom: 8 }}>
              About the evidence behind this record — not about the person. It is never combined with feasibility or fit, takes no part in the
              ordering, and does not change when the profile changes.
            </div>
            <div className="grid g2">
              <dl className="kv" style={{ margin: 0 }}>
                <dt>Evidence grades A/B/C/D</dt>
                <dd>{c.gradeProfile ? <GradeBar a={c.gradeProfile.A} b={c.gradeProfile.B} c={c.gradeProfile.C} d={c.gradeProfile.D} /> : <span className="faint">not recorded</span>}</dd>
                <dt>Assumptions among inputs</dt><dd className="mono">{count(c.assumptionsAmongInputs)} of {count(c.inputsTotal)}</dd>
                <dt>Verified observations</dt><dd className="mono">{count(c.verifiedObservations)}</dd>
                <dt>Stale observations</dt><dd className="mono">{count(c.staleObservations)}</dd>
                <dt>Open conflicts</dt><dd className="mono">{count(c.openConflicts)}</dd>
                <dt>Claims awaiting review</dt><dd className="mono">{count(c.claimsPendingReview)}</dd>
                <dt>Record completeness</dt><dd className="mono">{c.completenessPct === null ? '—' : `${c.completenessPct}% by weight`}</dd>
                <dt>Critical sections missing</dt><dd className="mono">{count(c.criticalMissing)}{c.criticalMissingSections.length ? ` (${c.criticalMissingSections.join(', ')})` : ''}</dd>
              </dl>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{c.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          </Panel>
        </div>
      </div>
    </Panel>
  );
}

export function MatchingLab({ records, locations, skills, assetTypes }: { records: LabRecord[]; locations: Option[]; skills: Option[]; assetTypes: Option[] }) {
  // `previous` is the last valid profile before the current one, kept only to say what the last edit changed.
  const [state, setState] = useState<{ form: Form; previous: PersonProfile | null }>({ form: EMPTY_FORM, previous: null });
  const { form } = state;
  const snapshots = useMemo(() => records.map((r) => r.snapshot), [records]);
  const bySlug = useMemo(() => new Map(records.map((r) => [r.slug, r])), [records]);

  const validation = useMemo(() => validateProfile(toProfile(form, locations)), [form, locations]);
  const results = useMemo(() => (validation.ok ? matchBusinesses(validation.profile, snapshots) : null), [validation, snapshots]);
  const previousResults = useMemo(() => (state.previous ? matchBusinesses(state.previous, snapshots) : null), [state.previous, snapshots]);

  const update = (patch: Partial<Form>) => setState((s) => {
    const before = validateProfile(toProfile(s.form, locations));
    return { form: { ...s.form, ...patch }, previous: before.ok ? before.profile : s.previous };
  });
  const text = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => update({ [key]: e.target.value } as Partial<Form>);

  const changesFor = (result: MatchResult): string[] => {
    const before = previousResults?.find((p) => p.business.slug === result.business.slug && p.business.name === result.business.name);
    return before ? explainChange(before, result).summary : [];
  };

  const numberField = (label: string, key: 'capital' | 'reserve' | 'goal' | 'income' | 'hours' | 'timeline', placeholder: string, step: number) => (
    <div>
      <label htmlFor={`f-${key}`}>{label}</label>
      <input id={`f-${key}`} name={key} type="number" min={0} step={step} inputMode="numeric" placeholder={placeholder} value={form[key]} onChange={text(key)} />
    </div>
  );
  const selectField = (label: string, key: 'risk' | 'involvement' | 'weekend' | 'physical' | 'loan' | 'location', options: Array<[string, string]>) => (
    <div>
      <label htmlFor={`f-${key}`}>{label}</label>
      <select id={`f-${key}`} name={key} value={form[key]} onChange={text(key)}>
        <option value="">— not said —</option>
        {options.map(([value, shown]) => <option key={value} value={value}>{shown}</option>)}
      </select>
    </div>
  );
  const yesNo: Array<[string, string]> = [['yes', 'yes'], ['no', 'no']];
  const filled = JSON.stringify(form) !== JSON.stringify(EMPTY_FORM);

  return (
    <div className="grid">
      <Panel title="Person profile" right={<>
        <span className="muted">Starts empty. Nothing is saved or sent anywhere; an empty field means “not said”, never zero.</span>
        <button type="button" onClick={() => setState({ form: EMPTY_FORM, previous: null })} disabled={!filled}>Clear profile</button>
      </>}>
        <div className="form-grid">
          {numberField('Investable capital (₹)', 'capital', 'e.g. 1500000', 50000)}
          {numberField('Reserve to keep untouched (₹, 0 if none)', 'reserve', 'e.g. 300000', 50000)}
          {numberField('Monthly income goal (₹)', 'goal', 'e.g. 60000', 5000)}
          {numberField('Current monthly income (₹)', 'income', 'e.g. 90000', 5000)}
          {selectField('Would take a business loan', 'loan', yesNo)}
          {selectField('Risk tolerance', 'risk', RISK_TOLERANCES.map((r) => [r, r]))}
          {numberField('Transition timeline (months from first spend)', 'timeline', 'e.g. 12', 1)}
          {selectField('Desired involvement', 'involvement', INVOLVEMENT_LEVELS.map((i) => [i, humanize(i)]))}
          {numberField('Maximum hours per week', 'hours', 'e.g. 50', 1)}
          {selectField('Weekend work acceptable', 'weekend', yesNo)}
          {selectField('Physical work tolerance (1 desk only – 5 heavy)', 'physical', ['1', '2', '3', '4', '5'].map((n) => [n, n]))}
          {selectField('Preferred location', 'location', locations.map((l) => [l.slug, l.name]))}
          <div>
            <label htmlFor="f-interests">Interests (comma-separated)</label>
            <input id="f-interests" name="interests" placeholder="e.g. food processing, bakery" value={form.interests} onChange={text('interests')} />
          </div>
          <div>
            <label htmlFor="f-qualifications">Qualifications held (separate with ;)</label>
            <input id="f-qualifications" name="qualifications" placeholder="e.g. B.Sc. Chemistry; FSSAI food safety supervisor" value={form.qualifications} onChange={text('qualifications')} />
          </div>
        </div>
        <details style={{ marginTop: 10 }}>
          <summary>Capabilities ({Object.keys(form.capabilities).length} listed) — proficiency 1–5; {CAPABILITY_HELD_MIN_PROFICIENCY} or above counts as held</summary>
          <div className="form-grid">
            {skills.map((s) => (
              <div key={s.slug}>
                <label htmlFor={`cap-${s.slug}`}>{s.name}</label>
                <select id={`cap-${s.slug}`} value={form.capabilities[s.slug] ?? ''} onChange={(e) => {
                  const next = { ...form.capabilities };
                  if (e.target.value === '') delete next[s.slug]; else next[s.slug] = Number(e.target.value);
                  update({ capabilities: next });
                }}>
                  <option value="">— not listed —</option>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            ))}
          </div>
        </details>
        <details style={{ marginTop: 6 }}>
          <summary>Assets available to a business ({form.assets.length} listed)</summary>
          <div className="row">
            {assetTypes.map((a) => (
              <label key={a.slug} className="row" style={{ margin: 0 }}>
                <input type="checkbox" checked={form.assets.includes(a.slug)} onChange={(e) => update({ assets: e.target.checked ? [...form.assets, a.slug] : form.assets.filter((x) => x !== a.slug) })} />
                {a.name}
              </label>
            ))}
          </div>
        </details>
        {!validation.ok ? (
          <div className="notice bad" style={{ marginTop: 10 }} data-testid="profile-issues">
            <b>This profile is not valid, so nothing is matched:</b>
            <ul>{validation.issues.map((i, n) => <li key={n}><span className="mono">{i.path}</span>: {i.message}</li>)}</ul>
          </div>
        ) : null}
      </Panel>

      <div className="muted small" data-testid="ordering-rule">
        <b>Order of the {records.length} records below:</b> those that pass every mandatory check first, then those whose feasibility cannot be assessed, then those that fail
        a check; within a group, fewer weak dimensions first, then more strong ones, then name. This is a stated rule, not a score — none is computed —
        and research confidence takes no part in it.
      </div>

      {records.length === 0 ? <div className="notice">No business version has been submitted yet, so there is nothing to match against.</div> : null}
      {results?.map((r) => <ResultCard key={r.business.slug ?? r.business.name} result={r} record={bySlug.get(r.business.slug ?? '')} changes={changesFor(r)} />)}
    </div>
  );
}

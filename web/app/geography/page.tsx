import Link from 'next/link';
import { can, requireStaff } from '@/lib/auth';
import { asUser, type Row } from '@/lib/db';
import { date, humanize, MISSING, valueWithUnit } from '@/lib/format';
import { Badge, Empty, Flash, Grade, OriginBadge, PageHead, Panel } from '@/components/ui';
import { addLocation, addLocationMetric, addMarketObservation } from '@/app/actions/geography';

type Search = { location?: string; ok?: string; error?: string };

const LEVELS = ['country', 'state', 'division', 'district', 'city', 'locality'];
const EVIDENCE_TYPES: [string, string][] = [
  ['government_tariff_or_notification', 'Government tariff / notification'], ['regulatory_fee_schedule', 'Regulatory fee schedule'],
  ['government_project_report', 'Government project report'], ['market_report', 'Market report'], ['listing_observation', 'Listing observation'],
  ['owner_documented', 'Owner documented'], ['owner_reported', 'Owner reported'], ['supplier_quote', 'Supplier quotation'],
  ['manufacturer_catalogue', 'Manufacturer catalogue'], ['analyst_estimate', 'Analyst estimate (grade D)'],
];
const LEVEL_LABEL: Record<string, string> = { country: 'national', state: 'state', division: 'division', district: 'district', city: 'city', locality: 'locality' };

function notVerified(value: string | null) {
  return value ? <span className="mono small">{value}</span> : <span className="faint small">not verified</span>;
}

export default async function Geography({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const d = await asUser(user.id, async (sql) => {
    const locations = await sql`
      select l.*, (select count(*) from intel.location_metrics m where m.location_id = l.id) as metric_count
      from intel.locations l order by l.name`;
    const selected: Row | undefined = locations.find((l) => l.slug === sp.location)
      ?? locations.filter((l) => l.is_pilot && l.location_type === 'city')[0] ?? locations[0];
    const selectedId: string | null = selected?.id ?? null;
    return {
      locations, selected,
      metrics: selectedId ? await sql`
        select m.*, d.name as metric_name, s.name as source_name,
               exists (select 1 from intel.location_metrics n where n.supersedes_id = m.id) as is_superseded
        from intel.location_metrics m
        join intel.metric_definitions d on d.key = m.metric_key
        join intel.sources s on s.id = m.source_id
        where m.location_id = ${selectedId}
        order by d.name, m.segment nulls first, m.observed_on desc, m.created_at desc` : [],
      resolved: selectedId ? await sql`
        select d.key, d.name, d.description, r.location_metric_id, r.value, r.unit_code, r.period, r.observed_on, r.evidence_grade,
               r.resolved_level, r.fallback_depth, r.is_fallback, rl.name as resolved_location_name, m.segment, m.verification_status, s.name as source_name
        from intel.metric_definitions d
        left join lateral intel.resolve_location_metric(${selectedId}, d.key) r on true
        left join intel.locations rl on rl.id = r.resolved_location_id
        left join intel.location_metrics m on m.id = r.location_metric_id
        left join intel.sources s on s.id = m.source_id
        where d.applies_to = 'location'
        order by d.name` : [],
      market: await sql`
        select o.*, d.name as metric_name, s.name as source_name, l.name as location_name, bm.name as model_name, bm.slug as model_slug
        from intel.market_observations o
        join intel.metric_definitions d on d.key = o.metric_key
        join intel.sources s on s.id = o.source_id
        left join intel.locations l on l.id = o.location_id
        left join intel.business_models bm on bm.id = o.business_model_id
        order by o.observed_on desc, o.created_at desc
        limit 300`,
      locationDefs: await sql`select key, name, unit_code, period from intel.metric_definitions where applies_to = 'location' order by name`,
      marketDefs: await sql`select key, name, unit_code, period from intel.metric_definitions where applies_to = 'market' order by name`,
      sources: await sql`select id, name from intel.sources where reuse_status <> 'prohibited' order by name`,
      models: await sql`select id, name, is_pilot from intel.business_models order by is_pilot desc, name`,
    };
  });
  const editor = can(user, 'admin', 'researcher', 'reviewer');
  const today = new Date().toISOString().slice(0, 10);
  const back = d.selected ? `/geography?location=${d.selected.slug}` : '/geography';

  // Flatten the tree depth-first so children sit under their parent.
  const byParent = new Map<string | null, Row[]>();
  for (const l of d.locations) byParent.set(l.parent_id, [...(byParent.get(l.parent_id) ?? []), l]);
  const tree: { row: Row; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const row of byParent.get(parent) ?? []) {
      tree.push({ row, depth });
      walk(row.id, depth + 1);
    }
  };
  walk(null, 0);
  const found = d.resolved.filter((r) => r.location_metric_id).length;
  const own = d.resolved.filter((r) => r.location_metric_id && !r.is_fallback).length;

  return (
    <>
      <PageHead title="Geography"
        sub="Location-specific overlays (rents, wages, tariffs, population) live on exactly one node of the tree. A city without its own figure inherits the nearest ancestor's — and every screen must say so." />
      <Flash params={sp} />

      <div className="grid">
        <Panel title="Location tree" right={<span className="muted">{d.locations.length} locations · select one to see its metrics</span>} flush>
          <table>
            <thead><tr><th>Location</th><th>Type</th><th>Tier</th><th>Pilot</th><th>ISO code</th><th>LGD code</th><th>Census 2011 code</th><th className="num">Metrics on this node</th></tr></thead>
            <tbody>
              {tree.length === 0 ? <Empty cols={8}>No location has been defined yet.</Empty> : null}
              {tree.map(({ row: l, depth }) => (
                <tr key={l.id} style={d.selected?.id === l.id ? { background: 'var(--panel-2)' } : undefined}>
                  <td style={{ paddingLeft: 10 + depth * 18 }}>
                    <Link href={`/geography?location=${l.slug}`}>{l.name}</Link> <span className="mono small faint">{l.slug}</span>
                    {d.selected?.id === l.id ? <> <span className="badge info">selected</span></> : null}
                  </td>
                  <td className="small">{humanize(l.location_type)}</td>
                  <td className="small">{l.tier ? humanize(l.tier) : <span className="faint">{MISSING}</span>}</td>
                  <td>{l.is_pilot ? <span className="badge info">pilot</span> : <span className="faint">{MISSING}</span>}</td>
                  <td>{notVerified(l.iso_code)}</td>
                  <td>{notVerified(l.lgd_code)}</td>
                  <td>{notVerified(l.census_2011_code)}</td>
                  <td className="num">{l.metric_count ? l.metric_count : <span className="faint">none</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="body muted small">Official codes are left empty on purpose until each has been checked against the Local Government Directory and Census tables; “not verified” is not an error.</div>
        </Panel>

        <Panel title="Add a location">
          <form action={addLocation}>
            <input type="hidden" name="back" value={back} />
            <div className="form-grid">
              <div><label>Name</label><input name="name" required minLength={2} maxLength={160} /></div>
              <div><label>Slug</label><input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} className="mono" placeholder="lower-case-with-hyphens" /></div>
              <div><label>Type</label><select name="location_type" defaultValue="city">{LEVELS.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select></div>
              <div><label>Parent (a coarser level)</label><select name="parent_id" defaultValue="">
                <option value="">— none (country only) —</option>
                {tree.map(({ row: l, depth }) => <option key={l.id} value={l.id}>{'  '.repeat(depth)}{l.name} ({l.location_type})</option>)}</select></div>
              <div><label>Tier</label><select name="tier" defaultValue=""><option value="">— not classified —</option>
                <option value="metro">Metro</option><option value="tier1">Tier 1</option><option value="tier2">Tier 2</option><option value="tier3">Tier 3</option><option value="rural">Rural</option></select></div>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button type="submit" disabled={!editor}>Add location</button>
              <span className="faint small">Codes (ISO, LGD, Census) are not entered here: they are filled only after verification.</span>
            </div>
          </form>
        </Panel>

        {d.selected ? (
          <>
            <Panel title={`Fallback resolver — ${d.selected.name}`}
              right={<span className="muted">{found} of {d.resolved.length} metrics have evidence · {own} recorded for this {d.selected.location_type} itself</span>} flush>
              <table>
                <thead><tr><th>Metric</th><th className="num">Resolved value</th><th>Where the figure comes from</th><th>Resolved at</th><th>Segment</th><th>Observed</th><th>Source</th><th>Status</th><th>Grade</th></tr></thead>
                <tbody>
                  {d.resolved.length === 0 ? <Empty cols={9}>No location metric is defined in the vocabulary.</Empty> : null}
                  {d.resolved.map((r) => (
                    <tr key={r.key}>
                      <td title={r.description ?? undefined}>{r.name}<div className="mono small faint">{r.key}</div></td>
                      {r.location_metric_id ? (
                        <>
                          <td className="num"><b>{valueWithUnit(r.value, r.unit_code, r.period)}</b></td>
                          <td>{r.is_fallback
                            ? <Badge value={`inherited · ${LEVEL_LABEL[r.resolved_level] ?? r.resolved_level} level`} tone="warn" title={`Not specific to ${d.selected!.name}: taken from an ancestor ${r.fallback_depth} level(s) up`} />
                            : <Badge value={`${d.selected!.location_type}-specific`} tone="good" title="Recorded for this exact location" />}</td>
                          <td className="small">{r.resolved_location_name}</td>
                          <td className="small">{r.segment ?? <span className="faint">{MISSING}</span>}</td>
                          <td className="mono small">{date(r.observed_on)}</td>
                          <td className="small">{r.source_name}</td>
                          <td><Badge value={r.verification_status} /></td>
                          <td><Grade grade={r.evidence_grade} /></td>
                        </>
                      ) : (
                        <>
                          <td className="num"><span className="faint">{MISSING}</span></td>
                          <td><Badge value="no evidence at any level" tone="bad" title="Nothing recorded for this location or any ancestor" /></td>
                          <td colSpan={6} className="faint small">not researched — missing stays missing; nothing is assumed</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="body muted small">
                Resolution order: this location, then each ancestor up to the country; rejected and superseded values are skipped; within a level the best grade, then the
                most recent, wins. The resolver is shown here without a segment filter — where a metric has several segments, check the full list below.
              </div>
            </Panel>

            <Panel title={`Location metrics recorded on ${d.selected.name}`} right={<span className="muted">{d.metrics.length} on this node (ancestors not included)</span>} flush>
              <table>
                <thead><tr><th>Metric</th><th>Segment</th><th className="num">Value</th><th>Observed on</th><th>Scope</th><th>Source</th><th>Evidence type</th><th>Status</th><th>Grade</th><th>Revalidate by</th></tr></thead>
                <tbody>
                  {d.metrics.length === 0 ? <Empty cols={10}>No metric has been recorded for {d.selected.name} itself. Local rent, wage and tariff research for this location has not been done yet.</Empty> : null}
                  {d.metrics.map((m) => (
                    <tr key={m.id} style={m.verification_status === 'rejected' || m.is_superseded ? { opacity: 0.5 } : undefined}>
                      <td>{m.metric_name} <OriginBadge origin={m.data_origin} />{m.analyst_notes ? <div className="faint small">{m.analyst_notes}</div> : null}</td>
                      <td className="small">{m.segment ?? <span className="faint">{MISSING}</span>}</td>
                      <td className="num">{valueWithUnit(m.value, m.unit_code, m.period)}</td>
                      <td className="mono small">{date(m.observed_on)}</td>
                      <td className="small">{humanize(m.geographic_scope)}</td>
                      <td className="small">{m.source_name}{m.page_ref ? ` · ${m.page_ref}` : ''}</td>
                      <td className="small">{humanize(m.evidence_type)}</td>
                      <td><Badge value={m.is_superseded ? 'superseded' : m.verification_status} /></td>
                      <td><Grade grade={m.evidence_grade} title={m.grade_basis ?? undefined} /></td>
                      <td className="mono small">{m.revalidate_by ? date(m.revalidate_by) : <span className="faint">not set</span>} {m.revalidate_by && m.revalidate_by < today ? <Badge value="OVERDUE" tone="bad" /> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>

            <Panel title="Record a location metric">
              <form action={addLocationMetric}>
                <input type="hidden" name="back" value={back} />
                <div className="form-grid">
                  <div><label>Location (exact node)</label><select name="location_id" defaultValue={d.selected.id} required>
                    {tree.map(({ row: l, depth }) => <option key={l.id} value={l.id}>{'  '.repeat(depth)}{l.name} ({l.location_type})</option>)}</select></div>
                  <div><label>Metric</label><select name="metric_key" required defaultValue="">
                    <option value="" disabled>— select —</option>
                    {d.locationDefs.map((m) => <option key={m.key} value={m.key}>{m.name} [{m.unit_code ?? 'no unit'}{m.period && m.period !== 'point_in_time' && m.period !== 'one_time' ? ` ${m.period.replace('_', ' ')}` : ''}]</option>)}</select></div>
                  <div><label>Value (in the metric&apos;s unit; rupees, never lakh)</label><input name="value" type="number" step="any" min="0" required /></div>
                  <div><label>Segment (micro-market, role, slab…)</label><input name="segment" maxLength={160} /></div>
                  <div><label>Observed on</label><input name="observed_on" type="date" max={today} required /></div>
                  <div><label>Source (registry)</label><select name="source_id" required defaultValue="">
                    <option value="" disabled>— select —</option>{d.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
                  <div><label>Evidence type</label><select name="evidence_type" required defaultValue="">
                    <option value="" disabled>— select —</option>{EVIDENCE_TYPES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></div>
                  <div style={{ gridColumn: 'span 2' }}><label>Analyst notes (who, how obtained, what exactly was measured)</label><input name="notes" /></div>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button type="submit" disabled={!editor}>Add location metric</button>
                  <span className="faint small">Stored at grade C, unverified (an analyst estimate is always grade D); scope follows the location type; revalidation is due 365 days after the observation date.</span>
                </div>
              </form>
            </Panel>
          </>
        ) : null}

        <Panel title="Market observations" right={<span className="muted">{d.market.length} recorded · all locations</span>} flush>
          <table>
            <thead><tr><th>Metric</th><th>Subject</th><th>Business</th><th>Location</th><th className="num">Value</th><th>Observed on</th><th>Source</th><th>Evidence type</th><th>Status</th><th>Grade</th></tr></thead>
            <tbody>
              {d.market.length === 0 ? <Empty cols={10}>No market observation has been recorded yet. No local price check or competitor count has been carried out.</Empty> : null}
              {d.market.map((o) => (
                <tr key={o.id} style={o.verification_status === 'rejected' ? { opacity: 0.5 } : undefined}>
                  <td>{o.metric_name} <OriginBadge origin={o.data_origin} />{o.analyst_notes ? <div className="faint small">{o.analyst_notes}</div> : null}</td>
                  <td className="small">{o.subject ?? <span className="faint">{MISSING}</span>}</td>
                  <td className="small">{o.model_slug ? <Link href={`/business/${o.model_slug}`}>{o.model_name}</Link> : <span className="faint">{MISSING}</span>}</td>
                  <td className="small">{o.location_name ?? <span className="faint">{MISSING}</span>}<div className="faint">{humanize(o.geographic_scope)}</div></td>
                  <td className="num">{o.value === null ? <span className="faint">{MISSING}</span> : valueWithUnit(o.value, o.unit_code, o.period)}{o.value_text ? <div className="small muted" style={{ whiteSpace: 'normal', textAlign: 'left' }}>{o.value_text}</div> : null}</td>
                  <td className="mono small">{date(o.observed_on)}</td>
                  <td className="small">{o.source_name}</td>
                  <td className="small">{humanize(o.evidence_type)}</td>
                  <td><Badge value={o.verification_status} /></td>
                  <td><Grade grade={o.evidence_grade} title={o.grade_basis ?? undefined} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="body muted small"><b>Standing note:</b> a competitor count or a population figure is an indicator, never a demand estimate. Record what was counted and where; do not convert it into customers or revenue.</div>
        </Panel>

        <Panel title="Record a market observation">
          <form action={addMarketObservation}>
            <input type="hidden" name="back" value={back} />
            <div className="form-grid">
              <div><label>Business model (optional)</label><select name="business_model_id" defaultValue="">
                <option value="">— not specific to one business —</option>{d.models.map((m) => <option key={m.id} value={m.id}>{m.name}{m.is_pilot ? ' (pilot)' : ''}</option>)}</select></div>
              <div><label>Location</label><select name="location_id" defaultValue={d.selected?.id ?? ''} required>
                {tree.map(({ row: l, depth }) => <option key={l.id} value={l.id}>{'  '.repeat(depth)}{l.name} ({l.location_type})</option>)}</select></div>
              <div><label>Metric</label><select name="metric_key" required defaultValue="">
                <option value="" disabled>— select —</option>
                {d.marketDefs.map((m) => <option key={m.key} value={m.key}>{m.name} [{m.unit_code ?? 'text defines the measure'}]</option>)}</select></div>
              <div><label>Subject (what exactly, where)</label><input name="subject" maxLength={300} /></div>
              <div><label>Numeric value</label><input name="value" type="number" step="any" /></div>
              <div style={{ gridColumn: 'span 2' }}><label>Text value (required when the metric has no unit)</label><input name="value_text" maxLength={1000} /></div>
              <div><label>Observed on</label><input name="observed_on" type="date" max={today} required /></div>
              <div><label>Source (registry)</label><select name="source_id" required defaultValue="">
                <option value="" disabled>— select —</option>{d.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label>Evidence type</label><select name="evidence_type" required defaultValue="">
                <option value="" disabled>— select —</option>{EVIDENCE_TYPES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></div>
              <div style={{ gridColumn: 'span 2' }}><label>Analyst notes (method, area covered, date and time of count)</label><input name="notes" /></div>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button type="submit" disabled={!editor}>Add market observation</button>
              <span className="faint small">An indicator, never a demand estimate. Stored at grade C, unverified (estimates: grade D).</span>
            </div>
          </form>
        </Panel>
      </div>
    </>
  );
}

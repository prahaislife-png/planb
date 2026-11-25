import Link from 'next/link';
import { can, type StaffUser } from '@/lib/auth';
import { asUser, type Row } from '@/lib/db';
import { date, humanize, inr, num, pct, valueWithUnit } from '@/lib/format';
import { Badge, Empty, Grade, Panel } from '@/components/ui';
import { addCostObservation, resolveConflict, setLocationMapping, setObservationStatus } from '@/app/actions/research';

const CLASS_ORDER = ['capex', 'pre_operative', 'deposit', 'working_capital', 'staff', 'fixed_opex', 'variable', 'financing'];

export async function CostsTab({ user, model, back }: { user: StaffUser; model: Row; back: string }) {
  const d = await asUser(user.id, async (sql) => ({
    items: await sql`
      select ci.*, bv.name as variant_name, bv.slug as variant_slug, cc.name as category_name, cc.cost_class, cc.sort_order,
             fp.value as resolved_value, fp.unit_code as resolved_unit, fp.basis, fp.method, fp.evidence_grade as resolved_grade, fp.rationale
      from intel.cost_items ci
      join intel.business_variants bv on bv.id = ci.business_variant_id
      join intel.cost_categories cc on cc.id = ci.cost_category_id
      left join intel.financial_parameters fp on fp.cost_item_id = ci.id and fp.is_current and fp.scenario = 'base' and fp.location_id is null
      where bv.business_model_id = ${model.id}
      order by bv.is_reference desc, bv.slug, cc.sort_order, ci.name`,
    observations: await sql`
      select o.*, s.name as source_name, s.reuse_status, d.title as doc_title, l.name as location_name,
             exists (select 1 from intel.cost_observations n where n.supersedes_id = o.id) as is_superseded,
             (select c.quote from intel.evidence_links k join intel.evidence_claims c on c.id = k.claim_id
               where k.target_table = 'cost_observations' and k.target_id = o.id limit 1) as quote
      from intel.cost_observations o
      join intel.cost_items ci on ci.id = o.cost_item_id
      join intel.business_variants bv on bv.id = ci.business_variant_id
      join intel.sources s on s.id = o.source_id
      left join intel.source_documents d on d.id = o.source_document_id
      left join intel.locations l on l.id = o.location_id
      where bv.business_model_id = ${model.id}
      order by o.observed_on desc, o.created_at`,
    conflicts: await sql`
      select c.*, ci.name as item_name from intel.observation_conflicts c
      join intel.business_variants bv on bv.id = c.business_variant_id
      join intel.cost_items ci on ci.id = c.cost_item_id
      where bv.business_model_id = ${model.id} order by (c.status = 'open') desc, c.detected_at desc`,
    sources: await sql`select id, name from intel.sources where reuse_status <> 'prohibited' order by (source_type = 'primary_research') desc, name`,
    locations: await sql`select id, name, location_type from intel.locations order by location_type, name`,
    metrics: await sql`select key, name from intel.metric_definitions where applies_to = 'location' and period in ('per_month', 'per_year') order by name`,
  }));
  const obsByItem = new Map<string, Row[]>();
  for (const o of d.observations) obsByItem.set(o.cost_item_id, [...(obsByItem.get(o.cost_item_id) ?? []), o]);
  const reviewer = can(user, 'admin', 'reviewer');
  const editor = can(user, 'admin', 'researcher');
  const variants = [...new Map(d.items.map((i) => [i.business_variant_id, i.variant_name])).entries()];

  return (
    <div className="grid">
      {d.conflicts.length ? (
        <Panel title="Conflicting observations" flush>
          <table>
            <thead><tr><th>Cost item</th><th className="num">Observations</th><th className="num">Lowest</th><th className="num">Highest</th><th className="num">Spread</th><th>Status</th><th>Resolution</th></tr></thead>
            <tbody>
              {d.conflicts.map((c) => (
                <tr key={c.id}>
                  <td>{c.item_name}</td><td className="num">{c.observation_count}</td><td className="num">{inr(c.min_value)}</td>
                  <td className="num">{inr(c.max_value)}</td><td className="num">{pct(c.spread_pct, 0)}</td><td><Badge value={c.status} /></td>
                  <td>{c.status === 'open' ? (
                    <form action={resolveConflict} className="inline">
                      <input type="hidden" name="conflict_id" value={c.id} /><input type="hidden" name="back" value={back} />
                      <input name="note" placeholder="Why — e.g. different capacity, GST basis" required minLength={5} style={{ width: 280 }} />
                      <select name="status" style={{ width: 150 }}><option value="resolved">Resolved</option><option value="accepted_as_range">Accept as range</option></select>
                      <button type="submit" disabled={!can(user, 'admin', 'reviewer', 'researcher')}>Close</button>
                    </form>) : <span className="muted small">{c.resolution_note}</span>}</td>
                </tr>))}
            </tbody>
          </table>
          <div className="body muted small">Conflicting observations are kept side by side. Verify or reject individual observations below, or accept the range; the model uses the median until then.</div>
        </Panel>) : null}

      {d.items.length === 0 ? <div className="notice warn">No cost structure yet. Ingest a source document from the Record tab; missing costs stay missing until evidence exists.</div> : null}

      {variants.map(([variantId, variantName]) => (
        <Panel key={variantId} title={`Cost structure — ${variantName}`} flush>
          <table>
            <thead><tr>
              <th>Item / observation</th><th className="num">Qty</th><th className="num">Value</th><th>Basis</th><th>Observed</th><th>Scope</th>
              <th>Source · page</th><th>Evidence type</th><th>Tax</th><th>Install.</th><th>Status</th><th>Grade</th><th>Review</th>
            </tr></thead>
            <tbody>
              {CLASS_ORDER.flatMap((cls) => {
                const items = d.items.filter((i) => i.business_variant_id === variantId && i.cost_class === cls);
                if (items.length === 0) return [];
                return [
                  <tr key={`h-${cls}`} className="total"><td colSpan={13} className="muted">{humanize(cls)}</td></tr>,
                  ...items.flatMap((item) => {
                    const obs = obsByItem.get(item.id) ?? [];
                    return [
                      <tr key={item.id}>
                        <td><b>{item.name}</b><div className="faint small">{item.category_name} · {humanize(item.recurrence)}</div></td>
                        <td className="num">{num(item.quantity, 2)}</td>
                        <td className="num">{item.resolved_value === null ? <Badge value="missing" tone="bad" title="No usable observation: this input is unresolved" /> : <b>{valueWithUnit(item.resolved_value, item.resolved_unit)}</b>}</td>
                        <td colSpan={8}>{item.basis ? <><Badge value={item.basis} /> <span className="muted small">{humanize(item.method)}{item.rationale ? ` — ${item.rationale}` : ''}</span></> : <span className="faint small">model input not resolved</span>}</td>
                        <td><Grade grade={item.resolved_grade} /></td>
                        <td className="muted small">{obs.length} obs.</td>
                      </tr>,
                      ...(['fixed_opex', 'staff'].includes(item.cost_class) ? [
                        <tr key={`${item.id}-loc`} className="sub">
                          <td colSpan={13} style={{ paddingLeft: 22 }}>
                            <details open={Boolean(item.location_metric_key)}>
                              <summary>{item.location_metric_key
                                ? `Derived locally: ${item.location_metric_key}${item.location_metric_segment ? ` [${item.location_metric_segment}]` : ''} × ${num(item.location_metric_multiplier, 2)} — ${item.location_metric_basis}`
                                : 'Derive this cost locally (rent = local rate × area; wage = local wage × 1)'}</summary>
                              <form action={setLocationMapping} className="inline">
                                <input type="hidden" name="cost_item_id" value={item.id} /><input type="hidden" name="back" value={back} />
                                <select name="metric_key" defaultValue={item.location_metric_key ?? ''} style={{ width: 280 }}>
                                  <option value="">— not derived locally (national value everywhere) —</option>
                                  {d.metrics.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                                </select>
                                <input name="segment" placeholder="segment (optional)" defaultValue={item.location_metric_segment ?? ''} style={{ width: 170 }} />
                                <input name="multiplier" type="number" step="any" min="0" placeholder="× multiplier" defaultValue={item.location_metric_multiplier ?? ''} style={{ width: 110 }} />
                                <input name="basis" placeholder="Where the multiplier comes from (e.g. 2,500 sq ft — source p. 10)" defaultValue={item.location_metric_basis ?? ''} style={{ width: 380 }} />
                                <button type="submit" disabled={!editor}>Save</button>
                              </form>
                            </details>
                          </td>
                        </tr>] : []),
                      ...obs.map((o) => (
                        <tr key={o.id} className="sub" style={o.verification_status === 'rejected' || o.is_superseded ? { opacity: 0.5 } : undefined}>
                          <td style={{ paddingLeft: 22 }}>{o.quote ? <div className="quote" title="Verbatim text from the source page">{o.quote}</div> : <span className="faint small">{o.analyst_notes ?? 'no quote (manual entry)'}</span>}</td>
                          <td className="num">{o.is_line_total ? `×${num(o.quantity_covered)}` : ''}</td>
                          <td className="num">{valueWithUnit(o.value, o.unit_code, o.period)}{o.projection_year ? <div className="faint small">year {o.projection_year}</div> : null}</td>
                          <td className="small">{o.is_line_total ? 'line total' : 'per unit'}</td>
                          <td className="mono small">{date(o.observed_on)}<div className="faint">{o.observed_on_precision}{o.revalidate_by && o.revalidate_by < new Date().toISOString().slice(0, 10) ? ' · STALE' : ''}</div></td>
                          <td className="small">{o.location_name ?? humanize(o.geographic_scope)}</td>
                          <td className="small">{o.source_document_id ? <Link href={`/documents/${o.source_document_id}?page=${(o.page_ref ?? '').replace(/\D/g, '') || 1}`}>{o.source_name}</Link> : o.source_name}{o.page_ref ? ` · ${o.page_ref}` : ''}
                            {['permitted', 'permitted_with_attribution'].includes(o.reuse_status) ? null : <div><Badge value={o.reuse_status} title="Source reuse terms" /></div>}</td>
                          <td className="small">{humanize(o.evidence_type)}</td>
                          <td className="small">{humanize(o.tax_treatment)}</td><td className="small">{humanize(o.installation)}</td>
                          <td><Badge value={o.is_superseded ? 'superseded' : o.verification_status} /></td>
                          <td><Grade grade={o.evidence_grade} title={o.grade_basis ?? undefined} /></td>
                          <td>
                            <form action={setObservationStatus} className="inline">
                              <input type="hidden" name="kind" value="cost" /><input type="hidden" name="id" value={o.id} /><input type="hidden" name="back" value={back} />
                              <select name="status" defaultValue={o.verification_status} style={{ width: 104 }}>
                                <option value="unverified">Unverified</option><option value="verified" disabled={!reviewer}>Verified</option>
                                <option value="disputed">Disputed</option><option value="rejected">Rejected</option>
                              </select>
                              <input name="note" placeholder="note" style={{ width: 110 }} />
                              <button type="submit" disabled={!editor && !reviewer}>Set</button>
                            </form>
                          </td>
                        </tr>)),
                    ];
                  }),
                ];
              })}
            </tbody>
          </table>
        </Panel>))}

      {d.items.length ? (
        <Panel title="Record another observation for an existing cost item">
          <form action={addCostObservation}>
            <input type="hidden" name="back" value={back} />
            <div className="form-grid">
              <div><label>Cost item</label><select name="cost_item_id" required>{d.items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.variant_slug})</option>)}</select></div>
              <div><label>Value (₹, one unit)</label><input name="value" type="number" step="0.01" min="0" required /></div>
              <div><label>Period</label><select name="period"><option value="one_time">One time</option><option value="per_month">Per month</option><option value="per_year">Per year</option></select></div>
              <div><label>Observed on</label><input name="observed_on" type="date" required /></div>
              <div><label>Source (registry)</label><select name="source_id" required>{d.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div><label>Evidence type</label><select name="evidence_type">
                <option value="supplier_quote">Supplier quotation</option><option value="manufacturer_catalogue">Manufacturer catalogue</option>
                <option value="owner_reported">Owner reported</option><option value="market_report">Market report</option>
                <option value="listing_observation">Listing observation</option><option value="analyst_estimate">Analyst estimate (grade D)</option></select></div>
              <div><label>Tax treatment</label><select name="tax_treatment"><option value="unknown">Unknown</option><option value="exclusive">Excl. GST</option><option value="inclusive">Incl. GST</option><option value="not_applicable">n/a</option></select></div>
              <div><label>Installation</label><select name="installation"><option value="unknown">Unknown</option><option value="included">Included</option><option value="excluded">Excluded</option><option value="not_applicable">n/a</option></select></div>
              <div><label>Geographic scope</label><select name="geographic_scope"><option value="unspecified">Unspecified</option><option value="city">City</option><option value="district">District</option><option value="state">State</option><option value="national">National</option></select></div>
              <div><label>Location</label><select name="location_id"><option value="">—</option>{d.locations.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.location_type})</option>)}</select></div>
              <div style={{ gridColumn: 'span 2' }}><label>Analyst notes (who, how obtained, capacity)</label><input name="notes" /></div>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button type="submit" disabled={!editor}>Add observation</button>
              <span className="faint small">Existing observations are never overwritten: a new figure is stored beside them, and disagreement is flagged for resolution.</span>
            </div>
          </form>
        </Panel>) : null}
    </div>
  );
}

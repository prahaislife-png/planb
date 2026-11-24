import Link from 'next/link';
import { can, type StaffUser } from '@/lib/auth';
import { asUser, type Row } from '@/lib/db';
import { date, humanize, valueWithUnit } from '@/lib/format';
import { Badge, Empty, Grade, Panel } from '@/components/ui';
import { setAssumption, setObservationStatus } from '@/app/actions/research';

export async function RevenueTab({ user, model, back }: { user: StaffUser; model: Row; back: string }) {
  const d = await asUser(user.id, async (sql) => ({
    streams: await sql`
      select rs.*, bv.name as variant_name from intel.revenue_streams rs join intel.business_variants bv on bv.id = rs.business_variant_id
      where bv.business_model_id = ${model.id} order by bv.is_reference desc, rs.key`,
    params: await sql`
      select s.*, bv.name as variant_name, fp.rationale, pd.default_value, pd.sort_order
      from intel.v_variant_parameter_status s
      join intel.business_variants bv on bv.id = s.business_variant_id
      join intel.financial_parameter_definitions pd on pd.key = s.parameter_key
      left join intel.financial_parameters fp on fp.id = s.financial_parameter_id
      where s.business_model_id = ${model.id}
        and (s.is_required or s.is_resolved or s.observation_count > 0)
      order by bv.is_reference desc, (s.revenue_stream_id is null), pd.sort_order`,
    observations: await sql`
      select o.*, pd.name as parameter_name, s.name as source_name, rs.name as stream_name,
             (select c.quote from intel.evidence_links k join intel.evidence_claims c on c.id = k.claim_id
               where k.target_table = 'parameter_observations' and k.target_id = o.id limit 1) as quote
      from intel.parameter_observations o
      join intel.business_variants bv on bv.id = o.business_variant_id
      join intel.financial_parameter_definitions pd on pd.key = o.parameter_key
      join intel.sources s on s.id = o.source_id
      left join intel.revenue_streams rs on rs.id = o.revenue_stream_id
      where bv.business_model_id = ${model.id} order by pd.sort_order, o.projection_year nulls first`,
    requirements: await sql`
      select r.* from intel.operating_requirements r join intel.business_variants bv on bv.id = r.business_variant_id
      where bv.business_model_id = ${model.id} order by r.requirement_type`,
  }));
  const editor = can(user, 'admin', 'researcher');
  const reviewer = can(user, 'admin', 'reviewer');

  return (
    <div className="grid">
      <Panel title="Revenue streams" flush>
        <table>
          <thead><tr><th>Stream</th><th>Variant</th><th>Volume driver</th><th>Pricing unit</th><th>Customer segment</th><th>Payment terms</th><th>Seasonality</th></tr></thead>
          <tbody>
            {d.streams.length === 0 ? <Empty cols={7}>No revenue stream defined. Revenue mechanics are a critical gap.</Empty> : null}
            {d.streams.map((s) => (
              <tr key={s.id}><td><b>{s.name}</b><div className="faint mono small">{s.key}</div></td><td className="small">{s.variant_name}</td>
                <td>{humanize(s.driver_kind)}</td><td>{s.pricing_unit_text ?? s.pricing_unit_code ?? <Badge value="missing" tone="warn" />}</td>
                <td>{s.customer_segment ?? <span className="faint">not researched</span>}</td>
                <td>{s.payment_terms_days === null ? <span className="faint">not researched</span> : `${s.payment_terms_days} days`}</td>
                <td>{s.seasonality_profile ? <Badge value={s.seasonality_basis ?? 'unverified'} /> : <span className="faint">not researched</span>}</td></tr>))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Model inputs — resolved value, basis and evidence" flush>
        <table>
          <thead><tr><th>Parameter</th><th>Stream</th><th className="num">Value in model</th><th>Basis</th><th>Method / rationale</th><th>Grade</th><th className="num">Obs.</th><th>Override with explicit assumption</th></tr></thead>
          <tbody>
            {d.params.length === 0 ? <Empty cols={8}>No parameters yet.</Empty> : null}
            {d.params.map((p) => (
              <tr key={`${p.business_variant_id}-${p.parameter_key}-${p.revenue_stream_id}`}>
                <td>{p.parameter_name} {p.is_required ? <span className="badge">required</span> : null}<div className="faint mono small">{p.parameter_key}</div></td>
                <td className="small">{p.revenue_stream_name ?? <span className="faint">variant</span>}</td>
                <td className="num">{p.is_resolved ? <b>{valueWithUnit(p.value, p.unit_code)}</b> : <Badge value="missing" tone={p.is_required ? 'bad' : 'warn'} title="Unresolved — not filled with a guess" />}</td>
                <td><Badge value={p.basis} /></td>
                <td className="muted small" style={{ maxWidth: 380 }}>{p.method ? humanize(p.method) : ''}{p.rationale ? ` — ${p.rationale}` : ''}</td>
                <td><Grade grade={p.evidence_grade} /></td><td className="num">{p.observation_count}</td>
                <td>
                  <details><summary>set</summary>
                    <form action={setAssumption} className="inline">
                      <input type="hidden" name="variant_id" value={p.business_variant_id} /><input type="hidden" name="parameter_key" value={p.parameter_key} />
                      <input type="hidden" name="stream_id" value={p.revenue_stream_id ?? ''} /><input type="hidden" name="back" value={back} />
                      <input name="value" type="number" step="any" placeholder="value" required style={{ width: 90 }} />
                      <input name="rationale" placeholder="Rationale (required, min 10 chars)" required minLength={10} style={{ width: 260 }} />
                      <button type="submit" disabled={!editor}>Record as assumption (D)</button>
                    </form>
                  </details>
                </td>
              </tr>))}
          </tbody>
        </table>
        <div className="body muted small">An unresolved required input blocks scenario computation. Defaults and overrides are stored as explicit assumptions — grade D, with a rationale — and counted on every scenario.</div>
      </Panel>

      <Panel title="Parameter observations (what the sources said)" flush>
        <table>
          <thead><tr><th>Parameter</th><th>Stream</th><th className="num">Value</th><th>Year</th><th>Observed</th><th>Source · page</th><th>Quote</th><th>Status</th><th>Grade</th><th>Review</th></tr></thead>
          <tbody>
            {d.observations.length === 0 ? <Empty cols={10}>No parameter observations.</Empty> : null}
            {d.observations.map((o) => (
              <tr key={o.id} style={o.verification_status === 'rejected' ? { opacity: 0.5 } : undefined}>
                <td>{o.parameter_name}</td><td className="small">{o.stream_name ?? ''}</td>
                <td className="num">{valueWithUnit(o.value, o.unit_code, o.period)}</td><td className="num">{o.projection_year ?? ''}</td>
                <td className="mono small">{date(o.observed_on)}</td>
                <td className="small">{o.source_document_id ? <Link href={`/documents/${o.source_document_id}?page=${(o.page_ref ?? '').replace(/\D/g, '') || 1}`}>{o.source_name}</Link> : o.source_name} · {o.page_ref}</td>
                <td style={{ maxWidth: 360 }}>{o.quote ? <div className="quote">{o.quote}</div> : null}{o.analyst_notes ? <div className="faint small">{o.analyst_notes}</div> : null}</td>
                <td><Badge value={o.verification_status} /></td><td><Grade grade={o.evidence_grade} title={o.grade_basis ?? undefined} /></td>
                <td>
                  <form action={setObservationStatus} className="inline">
                    <input type="hidden" name="kind" value="parameter" /><input type="hidden" name="id" value={o.id} /><input type="hidden" name="back" value={back} />
                    <select name="status" defaultValue={o.verification_status} style={{ width: 104 }}>
                      <option value="unverified">Unverified</option><option value="verified" disabled={!reviewer}>Verified</option>
                      <option value="disputed">Disputed</option><option value="rejected">Rejected</option></select>
                    <button type="submit" disabled={!editor && !reviewer}>Set</button>
                  </form>
                </td>
              </tr>))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Operating requirements" flush>
        <table>
          <thead><tr><th>Type</th><th>Requirement</th><th className="num">Value</th><th>Basis</th><th>Status</th><th>Grade</th></tr></thead>
          <tbody>
            {d.requirements.length === 0 ? <Empty cols={6}>No infrastructure requirements recorded.</Empty> : null}
            {d.requirements.map((r) => (
              <tr key={r.id}><td>{humanize(r.requirement_type)}</td><td>{r.name}</td>
                <td className="num">{r.value_text ?? valueWithUnit(r.value_numeric, r.unit_code)}</td>
                <td><Badge value={r.basis} /></td><td><Badge value={r.verification_status} /></td><td><Grade grade={r.evidence_grade} /></td></tr>))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

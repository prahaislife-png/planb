import Link from 'next/link';
import { can, type StaffUser } from '@/lib/auth';
import { asUser, type Row } from '@/lib/db';
import { date, humanize, num } from '@/lib/format';
import { Badge, Empty, GradeBar, Panel } from '@/components/ui';
import { updateBusinessIdentity, uploadDocument } from '@/app/actions/research';

export async function OverviewTab({ user, model, back }: { user: StaffUser; model: Row; back: string }) {
  const d = await asUser(user.id, async (sql) => ({
    checks: await sql`select * from intel.v_completeness_items where business_model_id = ${model.id} order by section, check_key`,
    quality: (await sql`select section_profiles from intel.v_business_evidence_quality where business_model_id = ${model.id}`)[0],
    variants: await sql`
      select v.*, (select count(*) from intel.cost_items ci where ci.business_variant_id = v.id) as cost_items,
             (select count(*) from intel.revenue_streams rs where rs.business_variant_id = v.id) as streams
      from intel.business_variants v where v.business_model_id = ${model.id} order by v.is_reference desc, v.slug`,
    classifications: await sql`
      select cc.system_code, cc.code, cc.title, cc.is_verified, x.is_primary
      from intel.business_model_classifications x join intel.classification_codes cc on cc.id = x.classification_code_id
      where x.business_model_id = ${model.id}`,
    siblings: await sql`
      select o.slug, o.name, r.relationship_type from intel.business_relationships r
      join intel.business_models o on o.id = case when r.from_business_model_id = ${model.id} then r.to_business_model_id else r.from_business_model_id end
      where ${model.id} in (r.from_business_model_id, r.to_business_model_id) order by o.name`,
    documents: await sql`
      select distinct d.id, d.title, d.document_date, d.document_date_precision, d.page_count, d.retrieved_at, s.name as source_name, s.reuse_status
      from intel.source_documents d join intel.sources s on s.id = d.source_id
      where d.id in (select source_document_id from intel.evidence_claims where business_model_id = ${model.id})
         or d.id in (select source_document_id from ops.research_runs where business_model_id = ${model.id})
      order by d.retrieved_at desc`,
    sources: await sql`select id, name, reuse_status from intel.sources where recommended_ingestion <> 'do_not_ingest' and reuse_status <> 'prohibited' order by name`,
  }));
  const editable = can(user, 'admin', 'researcher');
  const sections = [...new Set(d.checks.map((c) => c.section as string))];
  const profiles = (d.quality?.section_profiles ?? {}) as Record<string, { A: number; B: number; C: number; D: number }>;

  return (
    <div className="grid g2">
      <div className="grid">
        <Panel title="Identity">
          <form action={updateBusinessIdentity}>
            <input type="hidden" name="model_id" value={model.id} />
            <input type="hidden" name="back" value={back} />
            <div className="grid" style={{ gap: 8 }}>
              <div><label>Name</label><input name="name" defaultValue={model.name} disabled={!editable} /></div>
              <div><label>Description</label><textarea name="description" defaultValue={model.description ?? ''} disabled={!editable} placeholder="Missing — write from ingested evidence only" /></div>
              <div><label>Operating model</label><textarea name="operating_model" defaultValue={model.operating_model ?? ''} disabled={!editable} /></div>
              <div><label>Target customers</label><textarea name="target_customers" defaultValue={model.target_customers ?? ''} disabled={!editable} /></div>
              <div className="row"><button type="submit" disabled={!editable}>Save</button>
                <span className="faint small">Backlog triage: priority {model.research_priority} · capital tier hypothesis {model.capital_tier_hypothesis ?? '—'} (unverified, never shown to customers)</span></div>
            </div>
          </form>
        </Panel>
        <Panel title="Classification & relationships">
          <dl className="kv">
            <dt>Industry codes</dt>
            <dd>{d.classifications.length === 0 ? <span className="faint">none assigned</span> : d.classifications.map((c) => (
              <div key={c.code}><span className="mono">{c.system_code} {c.code}</span> {c.title} <Badge value={c.is_verified ? 'verified' : 'unverified'} /></div>))}</dd>
            <dt>Revenue archetype</dt><dd>{humanize(model.revenue_archetype)}</dd>
            <dt>Geography fit</dt><dd>{(model.geography_fit ?? []).join(', ') || '—'}</dd>
            <dt>Distinct siblings</dt>
            <dd>{d.siblings.length === 0 ? <span className="faint">none recorded</span> : d.siblings.map((s) => <div key={s.slug}><Link href={`/business/${s.slug}`}>{s.name}</Link></div>)}</dd>
          </dl>
          {model.backlog_notes ? <details style={{ marginTop: 8 }}><summary>Backlog research leads (unverified)</summary><div className="wrap muted small">{model.backlog_notes}</div></details> : null}
        </Panel>
        <Panel title="Variants (costed configurations)" flush>
          <table>
            <thead><tr><th>Variant</th><th>Scale</th><th>Template</th><th className="num">Cost items</th><th className="num">Streams</th></tr></thead>
            <tbody>
              {d.variants.length === 0 ? <Empty cols={5}>No variant yet. One is created when a source document is structured.</Empty> : null}
              {d.variants.map((v) => (
                <tr key={v.id}>
                  <td>{v.name} {v.is_reference ? <span className="badge info">reference</span> : null}<div className="faint mono small">{v.slug}</div></td>
                  <td className="small">{v.scale_description ?? '—'}</td><td className="small">{humanize(v.financial_template_key)}</td>
                  <td className="num">{v.cost_items}</td><td className="num">{v.streams}</td>
                </tr>))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Source documents" flush>
          <table>
            <thead><tr><th>Document</th><th>Source</th><th>Reuse terms</th><th>Dated</th><th className="num">Pages</th></tr></thead>
            <tbody>
              {d.documents.length === 0 ? <Empty cols={5}>No document ingested for this business yet.</Empty> : null}
              {d.documents.map((doc) => (
                <tr key={doc.id}>
                  <td><Link href={`/documents/${doc.id}`}>{doc.title}</Link></td><td className="small">{doc.source_name}</td>
                  <td><Badge value={doc.reuse_status} /></td>
                  <td className="mono small">{doc.document_date ? `${date(doc.document_date)} (${doc.document_date_precision})` : 'undated'}</td>
                  <td className="num">{num(doc.page_count)}</td>
                </tr>))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Add a source document">
          <form action={uploadDocument}>
            <input type="hidden" name="model_id" value={model.id} />
            <input type="hidden" name="back" value={back} />
            <div className="form-grid">
              <div><label>Source (registry)</label>
                <select name="source_id" required defaultValue="">
                  <option value="" disabled>Select…</option>
                  {d.sources.map((s) => <option key={s.id} value={s.id}>{s.name} — {humanize(s.reuse_status)}</option>)}
                </select></div>
              <div><label>Document title as printed</label><input name="title" required minLength={5} /></div>
              <div><label>Original URL (if any)</label><input name="url" type="url" /></div>
              <div><label>PDF file (max 40 MB)</label><input name="file" type="file" accept="application/pdf" required /></div>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button type="submit" className="primary" disabled={!editable}>Upload and queue research run</button>
              <span className="faint small">Only upload documents you obtained legitimately. The file is hashed, stored privately, and processed by the research worker.</span>
            </div>
          </form>
        </Panel>
      </div>

      <div className="grid">
        <Panel title="Completeness checklist — what exists" flush>
          <table>
            <thead><tr><th>Section</th><th>Check</th><th>State</th></tr></thead>
            <tbody>
              {sections.flatMap((section) => d.checks.filter((c) => c.section === section).map((c, ix) => (
                <tr key={c.check_key}>
                  <td className="muted">{ix === 0 ? humanize(section) : ''}</td>
                  <td>{c.label} {c.is_critical ? <span className="badge">critical</span> : null}</td>
                  <td>{c.is_satisfied ? <Badge value="present" tone="good" /> : <Badge value="missing" tone={c.is_critical ? 'bad' : 'warn'} />}</td>
                </tr>)))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Evidence quality by section — how good it is">
          {Object.keys(profiles).length === 0 ? <span className="faint">No observations yet.</span> : (
            <div className="grid" style={{ gap: 8 }}>
              {Object.entries(profiles).map(([section, p]) => (
                <div key={section} className="grid" style={{ gridTemplateColumns: '170px 1fr', alignItems: 'center' }}>
                  <span className="muted">{humanize(section)}</span><GradeBar a={p.A} b={p.B} c={p.C} d={p.D} />
                </div>))}
            </div>)}
          <p className="faint small" style={{ marginTop: 8 }}>Sections are graded independently: capital costs can be well evidenced while revenue evidence is weak.</p>
        </Panel>
      </div>
    </div>
  );
}

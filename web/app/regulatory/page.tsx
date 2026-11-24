import Link from 'next/link';
import { can, requireStaff } from '@/lib/auth';
import { asUser } from '@/lib/db';
import { date, humanize, MISSING, num } from '@/lib/format';
import { Badge, Empty, Flash, Grade, OriginBadge, PageHead, Panel, Stat } from '@/components/ui';
import { addRegulation, addScheme, mapRegulation, mapScheme, verifyRegulation } from '@/app/actions/regulatory';

type Search = { ok?: string; error?: string };

const LEAD_PREFIX = 'Regulatory leads (unverified):';
const REGULATION_TYPES = ['registration', 'licence', 'approval', 'certification', 'inspection', 'ongoing_compliance'];
const SCHEME_TYPES = ['capital_subsidy', 'interest_subvention', 'credit_guarantee', 'collateral_free_loan', 'training', 'marketing_support', 'tax_incentive', 'other'];
const APPLICABILITY_TONE: Record<string, 'good' | 'warn' | 'bad' | 'info'> = { mandatory: 'bad', conditional: 'info', optional: 'info', to_be_determined: 'warn' };
const ELIGIBILITY_TONE: Record<string, 'good' | 'warn' | 'bad' | 'info'> = { eligible: 'good', conditional: 'info', not_eligible: 'bad', to_be_determined: 'warn' };

function ExternalLink({ url }: { url: string | null }) {
  if (!url) return <span className="faint">{MISSING}</span>;
  // Only http(s) URLs are rendered as links; anything else is shown as plain text.
  return /^https?:\/\//i.test(url) ? <a href={url} target="_blank" rel="noreferrer noopener">portal</a> : <span className="small">{url}</span>;
}

export default async function Regulatory({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const d = await asUser(user.id, async (sql) => ({
    regulations: await sql`
      select r.*, l.name as location_name, s.name as source_name,
             (select count(*) from intel.business_regulations b where b.regulation_id = r.id) as mapped_count
      from intel.regulations r
      left join intel.locations l on l.id = r.jurisdiction_location_id
      left join intel.sources s on s.id = r.source_id
      order by r.jurisdiction_level, r.name`,
    mappings: await sql`
      select b.*, m.name as model_name, m.slug as model_slug, r.name as regulation_name, r.verification_status as regulation_status
      from intel.business_regulations b
      join intel.business_models m on m.id = b.business_model_id
      join intel.regulations r on r.id = b.regulation_id
      order by m.name, r.name`,
    schemes: await sql`
      select g.*, l.name as location_name, s.name as source_name
      from intel.government_schemes g
      left join intel.locations l on l.id = g.jurisdiction_location_id
      left join intel.sources s on s.id = g.source_id
      order by g.name`,
    eligibility: await sql`
      select e.*, m.name as model_name, m.slug as model_slug, g.name as scheme_name
      from intel.business_scheme_eligibility e
      join intel.business_models m on m.id = e.business_model_id
      join intel.government_schemes g on g.id = e.scheme_id
      order by m.name, g.name`,
    pilots: await sql`select slug, name, backlog_notes from intel.business_models where is_pilot order by name`,
    tasks: await sql`
      select t.id, t.title, t.description, t.status, t.priority, m.slug as model_slug, m.name as model_name
      from intel.research_tasks t left join intel.business_models m on m.id = t.business_model_id
      where t.task_type = 'verify_licence' and t.status in ('open', 'in_progress')
      order by t.priority, m.name nulls last, t.title`,
    sources: await sql`
      select id, name, source_type from intel.sources where reuse_status <> 'prohibited'
      order by (source_type in ('regulatory_portal', 'scheme_portal')) desc, name`,
    locations: await sql`select id, name, location_type from intel.locations order by location_type, name`,
    models: await sql`select id, name, is_pilot from intel.business_models order by is_pilot desc, name`,
  }));
  const editor = can(user, 'admin', 'researcher', 'reviewer');
  const reviewer = can(user, 'admin', 'reviewer');
  const today = new Date().toISOString().slice(0, 10);
  const leads = d.pilots.map((p) => ({
    slug: p.slug as string, name: p.name as string,
    lines: String(p.backlog_notes ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith(LEAD_PREFIX)).map((l) => l.slice(LEAD_PREFIX.length).trim()),
  }));
  const verified = d.regulations.filter((r) => r.verification_status === 'verified').length;
  const overdue = d.regulations.filter((r) => r.revalidate_by && r.revalidate_by < today).length;
  const modelOptions = d.models.map((m) => <option key={m.id} value={m.id}>{m.name}{m.is_pilot ? ' (pilot)' : ''}</option>);
  const locationOptions = d.locations.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.location_type})</option>);
  const sourceOptions = d.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>);

  return (
    <>
      <PageHead title="Regulatory database"
        sub="Licences, registrations, approvals and schemes, each tied to its issuing authority and jurisdiction. Regulatory facts go stale: an unverified entry is a lead, not a fact, and a verified one carries a revalidation date." />
      <Flash params={sp} />
      <div className="grid g4" style={{ marginBottom: 12 }}>
        <Stat label="Regulations on file" value={d.regulations.length} note={d.regulations.length ? `${verified} verified against a source` : 'none researched yet'} />
        <Stat label="Revalidation overdue" value={d.regulations.length ? overdue : MISSING} tone={overdue ? 'bad' : undefined} note="verified more than 180 days ago" />
        <Stat label="Business mappings" value={d.mappings.length} note={d.mappings.length ? `${d.mappings.filter((b) => b.applicability === 'to_be_determined').length} still “to be determined”` : 'no business has a mapped regulation'} />
        <Stat label="Open licence tasks" value={d.tasks.length} tone={d.tasks.length ? 'warn' : undefined} note="verify_licence research tasks" />
      </div>

      <div className="grid">
        <Panel title="Regulations" right={<span className="muted">{d.regulations.length} on file</span>} flush>
          <table>
            <thead><tr>
              <th>Regulation</th><th>Type</th><th>Issuing authority</th><th>Jurisdiction</th><th>Verification</th><th>Last verified</th><th>Revalidate by</th><th>Grade</th><th>Portal</th>
              <th className="num">Mapped</th><th>Verify (reviewer)</th>
            </tr></thead>
            <tbody>
              {d.regulations.length === 0 ? <Empty cols={11}>No regulation has been researched yet. The unverified leads from the backlog are listed at the bottom of this page; none has been checked against its authority.</Empty> : null}
              {d.regulations.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.name}</b> <OriginBadge origin={r.data_origin} /><div className="mono small faint">{r.slug}</div>
                    {r.legal_basis ? <div className="faint small">Basis: {r.legal_basis}</div> : null}
                    {r.fee_notes ? <div className="faint small">Fees: {r.fee_notes}</div> : null}
                    {r.validity_notes ? <div className="faint small">Validity: {r.validity_notes}</div> : null}
                    {r.typical_timeline_days !== null ? <div className="faint small">Typical timeline: {num(r.typical_timeline_days)} days</div> : null}
                    {r.notes ? <div className="faint small">{r.notes}</div> : null}</td>
                  <td className="small">{humanize(r.regulation_type)}</td>
                  <td className="small">{r.issuing_authority}</td>
                  <td className="small">{humanize(r.jurisdiction_level)}<div className="faint">{r.location_name ?? 'location not recorded'}</div></td>
                  <td><Badge value={r.verification_status} tone={r.verification_status === 'outdated' ? 'bad' : undefined} />{r.source_name ? <div className="faint small">{r.source_name}</div> : <div className="faint small">no source</div>}</td>
                  <td className="mono small">{r.last_verified_on ? date(r.last_verified_on) : <span className="faint">not verified</span>}</td>
                  <td className="mono small">{r.revalidate_by ? date(r.revalidate_by) : <span className="faint">{MISSING}</span>} {r.revalidate_by && r.revalidate_by < today ? <Badge value="OVERDUE" tone="bad" title="Verification is older than its revalidation date" /> : null}</td>
                  <td><Grade grade={r.evidence_grade} /></td>
                  <td><ExternalLink url={r.application_portal_url} /></td>
                  <td className="num">{r.mapped_count}</td>
                  <td>
                    <form action={verifyRegulation} className="inline">
                      <input type="hidden" name="regulation_id" value={r.id} /><input type="hidden" name="back" value="/regulatory" />
                      <select name="source_id" defaultValue={r.source_id ?? ''} required style={{ width: 170 }} aria-label="Source checked">
                        <option value="" disabled>— source checked —</option>{sourceOptions}</select>
                      <select name="evidence_grade" defaultValue="" style={{ width: 96 }} aria-label="Grade">
                        <option value="">keep {r.evidence_grade}</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option></select>
                      <button type="submit" className="good" disabled={!reviewer} title={reviewer ? 'Sets verified today, revalidate in 180 days' : 'Reviewer or admin only'}>{r.verification_status === 'verified' ? 'Re-verify' : 'Verify'}</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="body muted small">
            Verifying requires the registry source that was checked; it stamps today as the verification date and sets revalidation 180 days out.
            The grade is not changed unless the reviewer picks one — the database allows grade A only on a verified regulation.
          </div>
        </Panel>

        <Panel title="Add a regulation">
          <form action={addRegulation}>
            <input type="hidden" name="back" value="/regulatory" />
            <div className="form-grid">
              <div style={{ gridColumn: 'span 2' }}><label>Name</label><input name="name" required minLength={3} maxLength={240} /></div>
              <div><label>Slug</label><input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={100} className="mono" placeholder="lower-case-with-hyphens" /></div>
              <div><label>Type</label><select name="regulation_type" required>{REGULATION_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select></div>
              <div><label>Issuing authority</label><input name="issuing_authority" required minLength={2} maxLength={240} /></div>
              <div><label>Jurisdiction level</label><select name="jurisdiction_level" required><option value="central">Central</option><option value="state">State</option><option value="local_body">Local body</option></select></div>
              <div><label>Jurisdiction location</label><select name="jurisdiction_location_id" defaultValue=""><option value="">— not recorded —</option>{locationOptions}</select></div>
              <div><label>Legal basis (act / rule)</label><input name="legal_basis" maxLength={500} /></div>
              <div><label>Application portal URL</label><input name="application_portal_url" type="url" placeholder="https://" maxLength={500} /></div>
              <div><label>Typical timeline (days)</label><input name="typical_timeline_days" type="number" step="any" min="0" /></div>
              <div><label>Fee notes (as published)</label><input name="fee_notes" maxLength={1000} /></div>
              <div><label>Validity notes</label><input name="validity_notes" maxLength={1000} /></div>
              <div><label>Source (registry, optional until verified)</label><select name="source_id" defaultValue=""><option value="">— none yet —</option>{sourceOptions}</select></div>
              <div style={{ gridColumn: 'span 2' }}><label>Description</label><input name="description" /></div>
              <div style={{ gridColumn: 'span 2' }}><label>Notes</label><input name="notes" /></div>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button type="submit" disabled={!editor}>Add regulation</button>
              <span className="faint small">Stored unverified at grade D. Leave fees, validity and timelines blank unless read from the authority&apos;s own publication.</span>
            </div>
          </form>
        </Panel>

        <Panel title="Business ↔ regulation mapping" right={<span className="muted">{d.mappings.length} mappings</span>} flush>
          <table>
            <thead><tr><th>Business</th><th>Regulation</th><th>Applicability</th><th>Condition</th><th>Stage</th><th>Verification</th><th>Notes</th></tr></thead>
            <tbody>
              {d.mappings.length === 0 ? <Empty cols={7}>No regulation has been mapped to a business model yet. Applicability has not been researched for any business.</Empty> : null}
              {d.mappings.map((b) => (
                <tr key={b.id}>
                  <td><Link href={`/business/${b.model_slug}`}>{b.model_name}</Link> <OriginBadge origin={b.data_origin} /></td>
                  <td>{b.regulation_name}{b.regulation_status !== 'verified' ? <div className="faint small">regulation itself is {humanize(b.regulation_status).toLowerCase()}</div> : null}</td>
                  <td><Badge value={b.applicability} tone={APPLICABILITY_TONE[b.applicability]} title={b.applicability === 'to_be_determined' ? 'Research lead — not a requirement' : undefined} /></td>
                  <td className="small">{b.condition_text ?? <span className="faint">{MISSING}</span>}</td>
                  <td className="small">{humanize(b.stage)}</td>
                  <td><Badge value={b.verification_status} /></td>
                  <td className="small muted">{b.notes ?? MISSING}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="body muted small">“To be determined” means <b>research lead, not a requirement</b>: it must never be presented to a customer as something they need.</div>
        </Panel>

        <Panel title="Map a regulation to a business model">
          {d.regulations.length === 0 ? <div className="notice warn">Add the regulation first: a mapping links a business model to a regulation on file.</div> : null}
          <form action={mapRegulation}>
            <input type="hidden" name="back" value="/regulatory" />
            <div className="form-grid">
              <div><label>Business model</label><select name="business_model_id" required defaultValue=""><option value="" disabled>— select —</option>{modelOptions}</select></div>
              <div><label>Regulation</label><select name="regulation_id" required defaultValue=""><option value="" disabled>— select —</option>
                {d.regulations.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
              <div><label>Applicability</label><select name="applicability" defaultValue="to_be_determined">
                <option value="to_be_determined">To be determined (research lead)</option><option value="mandatory">Mandatory</option>
                <option value="conditional">Conditional (state the condition)</option><option value="optional">Optional</option></select></div>
              <div><label>Stage</label><select name="stage" defaultValue="pre_launch"><option value="pre_launch">Pre-launch</option><option value="at_launch">At launch</option><option value="ongoing">Ongoing</option></select></div>
              <div style={{ gridColumn: 'span 2' }}><label>Condition (required when conditional)</label><input name="condition_text" maxLength={1000} /></div>
              <div style={{ gridColumn: 'span 2' }}><label>Notes</label><input name="notes" /></div>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button type="submit" disabled={!editor || d.regulations.length === 0}>Add mapping</button>
              <span className="faint small">The default is a research lead. Choose “mandatory” only when the authority&apos;s own text says so.</span>
            </div>
          </form>
        </Panel>

        <Panel title="Government schemes" right={<span className="muted">{d.schemes.length} on file</span>} flush>
          <table>
            <thead><tr><th>Scheme</th><th>Type</th><th>Administering body</th><th>Jurisdiction</th><th>Benefit</th><th>Eligibility</th><th>Scheme status</th><th>Verification</th><th>Last verified</th><th>Grade</th><th>Link</th></tr></thead>
            <tbody>
              {d.schemes.length === 0 ? <Empty cols={11}>No government scheme has been researched yet. Subsidies assumed by source documents stay excluded from every model until a scheme is verified here.</Empty> : null}
              {d.schemes.map((g) => (
                <tr key={g.id}>
                  <td><b>{g.name}</b> <OriginBadge origin={g.data_origin} /><div className="mono small faint">{g.slug}</div>{g.notes ? <div className="faint small">{g.notes}</div> : null}</td>
                  <td className="small">{humanize(g.scheme_type)}</td>
                  <td className="small">{g.administering_body}</td>
                  <td className="small">{g.location_name ?? <span className="faint">not recorded</span>}</td>
                  <td className="small">{g.benefit_summary ?? <span className="faint">not researched</span>}</td>
                  <td className="small">{g.eligibility_summary ?? <span className="faint">not researched</span>}</td>
                  <td><Badge value={g.status} tone={g.status === 'unknown' ? 'warn' : g.status === 'closed' ? 'bad' : undefined} /></td>
                  <td><Badge value={g.verification_status} tone={g.verification_status === 'outdated' ? 'bad' : undefined} />{g.source_name ? <div className="faint small">{g.source_name}</div> : <div className="faint small">no source</div>}</td>
                  <td className="mono small">{g.last_verified_on ? date(g.last_verified_on) : <span className="faint">not verified</span>} {g.revalidate_by && g.revalidate_by < today ? <Badge value="OVERDUE" tone="bad" /> : null}</td>
                  <td><Grade grade={g.evidence_grade} /></td>
                  <td><ExternalLink url={g.application_url} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <div className="grid g2">
          <Panel title="Add a government scheme">
            <form action={addScheme}>
              <input type="hidden" name="back" value="/regulatory" />
              <div className="form-grid">
                <div><label>Name</label><input name="name" required minLength={3} maxLength={240} /></div>
                <div><label>Slug</label><input name="slug" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={100} className="mono" /></div>
                <div><label>Administering body</label><input name="administering_body" required minLength={2} maxLength={240} /></div>
                <div><label>Type</label><select name="scheme_type" required>{SCHEME_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select></div>
                <div><label>Jurisdiction location</label><select name="jurisdiction_location_id" defaultValue=""><option value="">— not recorded —</option>{locationOptions}</select></div>
                <div><label>Scheme status</label><select name="status" defaultValue="unknown"><option value="unknown">Unknown</option><option value="active">Active</option><option value="closed">Closed</option></select></div>
                <div><label>Application URL</label><input name="application_url" type="url" placeholder="https://" maxLength={500} /></div>
                <div><label>Source (registry)</label><select name="source_id" defaultValue=""><option value="">— none yet —</option>{sourceOptions}</select></div>
                <div style={{ gridColumn: 'span 2' }}><label>Benefit summary (as published)</label><input name="benefit_summary" /></div>
                <div style={{ gridColumn: 'span 2' }}><label>Eligibility summary (as published)</label><input name="eligibility_summary" /></div>
                <div style={{ gridColumn: 'span 2' }}><label>Notes</label><input name="notes" /></div>
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <button type="submit" disabled={!editor}>Add scheme</button>
                <span className="faint small">Stored unverified at grade D.</span>
              </div>
            </form>
          </Panel>

          <Panel title="Business eligibility for schemes" flush>
            <table>
              <thead><tr><th>Business</th><th>Scheme</th><th>Eligibility</th><th>Condition</th><th>Verification</th></tr></thead>
              <tbody>
                {d.eligibility.length === 0 ? <Empty cols={5}>No scheme eligibility has been assessed for any business model yet.</Empty> : null}
                {d.eligibility.map((e) => (
                  <tr key={`${e.business_model_id}-${e.scheme_id}`}>
                    <td><Link href={`/business/${e.model_slug}`}>{e.model_name}</Link></td>
                    <td>{e.scheme_name}</td>
                    <td><Badge value={e.eligibility} tone={ELIGIBILITY_TONE[e.eligibility]} /></td>
                    <td className="small">{e.condition_text ?? <span className="faint">{MISSING}</span>}{e.notes ? <div className="faint">{e.notes}</div> : null}</td>
                    <td><Badge value={e.verification_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="body">
              <form action={mapScheme}>
                <input type="hidden" name="back" value="/regulatory" />
                <div className="form-grid">
                  <div><label>Business model</label><select name="business_model_id" required defaultValue=""><option value="" disabled>— select —</option>{modelOptions}</select></div>
                  <div><label>Scheme</label><select name="scheme_id" required defaultValue=""><option value="" disabled>— select —</option>
                    {d.schemes.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
                  <div><label>Eligibility</label><select name="eligibility" defaultValue="to_be_determined">
                    <option value="to_be_determined">To be determined</option><option value="eligible">Eligible</option>
                    <option value="conditional">Conditional</option><option value="not_eligible">Not eligible</option></select></div>
                  <div><label>Condition (required when conditional)</label><input name="condition_text" maxLength={1000} /></div>
                  <div style={{ gridColumn: 'span 2' }}><label>Notes</label><input name="notes" /></div>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button type="submit" disabled={!editor || d.schemes.length === 0}>Record eligibility</button>
                  <span className="faint small">{d.schemes.length === 0 ? 'Add a scheme first.' : 'Default: to be determined.'}</span>
                </div>
              </form>
            </div>
          </Panel>
        </div>

        <Panel title="Regulatory leads from the research backlog — unverified, to be checked" right={<Badge value="leads, not requirements" tone="warn" />} flush>
          <table>
            <thead><tr><th style={{ width: 280 }}>Pilot business</th><th>Leads noted in the backlog (plain text, nobody has verified these)</th></tr></thead>
            <tbody>
              {leads.length === 0 ? <Empty cols={2}>No pilot business model is defined.</Empty> : null}
              {leads.map((p) => (
                <tr key={p.slug}>
                  <td><Link href={`/business/${p.slug}`}>{p.name}</Link></td>
                  <td className="small">{p.lines.length ? p.lines.map((line, n) => <div key={n} className="wrap">{line}</div>) : <span className="faint">no regulatory lead noted in the backlog</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="body muted small">
            These are names of licences and rules an analyst thought might apply. None has been confirmed with its authority, and none says whether it is mandatory,
            conditional or irrelevant for the business. Turn a lead into a regulation above, verify it, then map it.
          </div>
        </Panel>

        <Panel title="Open licence-verification tasks" right={<Link href="/tasks">all research tasks</Link>} flush>
          <table>
            <thead><tr><th>Task</th><th>Business</th><th>Why</th><th className="num">Pri</th><th>Status</th></tr></thead>
            <tbody>
              {d.tasks.length === 0 ? <Empty cols={5}>No open licence-verification task.</Empty> : null}
              {d.tasks.map((t) => (
                <tr key={t.id}>
                  <td>{t.title}</td>
                  <td>{t.model_slug ? <Link href={`/business/${t.model_slug}`}>{t.model_name}</Link> : <span className="faint">{MISSING}</span>}</td>
                  <td className="muted small">{t.description ?? MISSING}</td>
                  <td className="num">{t.priority}</td>
                  <td><Badge value={t.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="body muted small">Checklist for these tasks: <span className="mono">research/templates/regulatory_checklist.md</span>.</div>
        </Panel>
      </div>
    </>
  );
}

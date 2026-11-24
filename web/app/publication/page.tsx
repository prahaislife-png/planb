import Link from 'next/link';
import { can, requireStaff } from '@/lib/auth';
import { asUser, type Row } from '@/lib/db';
import { dateTime, num, pct } from '@/lib/format';
import { Badge, Empty, Flash, OriginBadge, PageHead, Panel, Stat } from '@/components/ui';
import { publishVersion, updatePolicy, withdrawPublication } from '@/app/actions/research';

const POLICY_FIELDS: { key: string; label: string; help: string; step: string; max?: number }[] = [
  { key: 'min_completeness_pct', label: 'Min completeness %', help: 'Share of record checks that must be satisfied', step: '0.1', max: 100 },
  { key: 'max_critical_missing', label: 'Max critical sections missing', help: 'Critical completeness checks allowed to fail', step: '1' },
  { key: 'max_open_conflicts', label: 'Max open conflicts', help: 'Unresolved conflicts between observations', step: '1' },
  { key: 'max_pending_claims', label: 'Max pending claims', help: 'Extracted claims still awaiting review', step: '1' },
  { key: 'max_stale_observations', label: 'Max stale observations', help: 'Observations past their revalidation date', step: '1' },
  { key: 'min_parameters_c_or_better_pct', label: 'Min model inputs grade C or better %', help: 'Share of model inputs not resting on grade D', step: '0.1', max: 100 },
];

/** Evidence grade counts frozen at submission. A grade absent from the profile is shown as missing, not as zero. */
function Profile({ profile }: { profile: Row | null }) {
  const cell = (k: string) => (profile && profile[k] !== null && profile[k] !== undefined ? num(Number(profile[k])) : '—');
  return (
    <span className="mono small">
      A {cell('A')} · B {cell('B')} · C {cell('C')} · D {cell('D')}
      <span className="faint"> · {cell('assumptions')} assumptions</span>
    </span>
  );
}

export default async function Publication({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const back = '/publication';

  const d = await asUser(user.id, async (sql) => {
    const [policy] = await sql`
      select p.*, (select s.display_name from ops.staff_members s where s.user_id = p.updated_by) as updated_by_name
      from ops.publication_policy p`;
    const approved = await sql`
      select v.id, v.version_no, v.completeness_pct, v.critical_missing, v.evidence_profile, v.decided_at, v.decision_comments, v.data_origin,
             m.slug, m.name, pub.publication_blockers(v.id) as blockers,
             (select s.display_name from ops.staff_members s where s.user_id = v.decided_by) as decided_by_name
      from intel.business_versions v
      join intel.business_models m on m.id = v.business_model_id
      where v.status = 'approved'
        and not exists (select 1 from pub.publication_versions p where p.business_version_id = v.id)
      order by v.decided_at`;
    const publications = await sql`
      select p.id, p.business_model_id, p.publication_no, p.slug, p.name, p.completeness_pct, p.evidence_profile, p.status,
             p.published_at, p.withdrawn_at, p.withdrawn_reason, v.version_no, m.slug as model_slug,
             (select s.display_name from ops.staff_members s where s.user_id = p.published_by) as published_by_name
      from pub.publication_versions p
      join intel.business_versions v on v.id = p.business_version_id
      join intel.business_models m on m.id = p.business_model_id
      order by p.published_at desc`;
    const [counts] = await sql`select count(*) filter (where status = 'submitted') as submitted from intel.business_versions`;
    return { policy, approved, publications, submitted: Number(counts.submitted) };
  });

  const admin = can(user, 'admin');
  const live = d.publications.filter((p) => p.status === 'live');
  const history = d.publications.filter((p) => p.status !== 'live');
  const publishable = d.approved.filter((v) => (v.blockers as string[]).length === 0).length;

  return (
    <>
      <PageHead title="Publication management"
        sub="Publishing copies a frozen, approved business version into the customer-facing store. It is an administrator action and the database re-checks every condition at the moment of publishing." />
      <div className="notice warn">
        <b>Nothing can be published unless</b> it has been approved by a reviewer, meets the publication policy below, contains no demo or test data,
        and contains no observations from sources without reuse rights. These conditions are enforced by the database for every write path; this page only reports them.
      </div>
      <Flash params={sp} />

      <div className="grid g4" style={{ marginBottom: 12 }}>
        <Stat label="Live publications" value={num(live.length)} tone={live.length ? 'good' : undefined} />
        <Stat label="Approved, not yet published" value={num(d.approved.length)} note={`${num(publishable)} without blockers`} />
        <Stat label="Submitted, awaiting review" value={num(d.submitted)} note={<Link href="/review">review inbox →</Link>} />
        <Stat label="Superseded / withdrawn" value={num(history.length)} />
      </div>

      <div className="grid">
        <Panel title="Publication policy"
          right={<span className="muted">last changed {dateTime(d.policy?.updated_at)} by {d.policy?.updated_by_name ?? (d.policy?.updated_by ? 'unknown' : 'nobody (initial defaults)')}</span>}>
          {d.policy ? (
            <form action={updatePolicy}>
              <input type="hidden" name="back" value={back} />
              <div className="form-grid">
                {POLICY_FIELDS.map((f) => (
                  <div key={f.key}>
                    <label htmlFor={f.key}>{f.label}</label>
                    <input id={f.key} name={f.key} type="number" min={0} max={f.max} step={f.step} defaultValue={d.policy[f.key]} required disabled={!admin} />
                    <div className="faint small" style={{ marginTop: 2 }}>{f.help}</div>
                  </div>))}
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button type="submit" className="primary" disabled={!admin}>Save policy</button>
                <span className="faint small">
                  {admin ? 'Applies to every later publish attempt. Versions already published are not re-evaluated. Changes are audited.'
                         : 'Only an administrator can change the policy.'}
                </span>
              </div>
            </form>) : <div className="notice bad" style={{ marginBottom: 0 }}>The publication policy row is missing or not visible to your role, so nothing can be published.</div>}
        </Panel>

        <Panel title="Approved versions not yet published" right={<span className="mono">{d.approved.length}</span>} flush>
          <table>
            <thead><tr>
              <th>Business model</th><th className="num">Version</th><th>Approved</th><th className="num">Completeness</th><th>Evidence at submission</th>
              <th>Blockers (as reported by the database)</th><th>Publish</th>
            </tr></thead>
            <tbody>
              {d.approved.length === 0 ? (
                <Empty cols={7}>No approved version is waiting to be published.{d.submitted ? ` ${d.submitted} submitted version${d.submitted === 1 ? ' is' : 's are'} still awaiting a reviewer's decision in the review inbox.` : ''}</Empty>) : null}
              {d.approved.map((v) => {
                const blockers = v.blockers as string[];
                return (
                  <tr key={v.id}>
                    <td><Link href={`/business/${v.slug}?tab=versions`}>{v.name}</Link> <OriginBadge origin={v.data_origin} /></td>
                    <td className="num">v{v.version_no}</td>
                    <td className="small">{v.decided_by_name ?? 'unknown'}<div className="mono faint">{dateTime(v.decided_at)}</div>
                      {v.decision_comments ? <div className="muted">{v.decision_comments}</div> : null}</td>
                    <td className="num">{pct(v.completeness_pct)}
                      <div className="small" style={{ color: v.critical_missing ? 'var(--bad)' : 'var(--faint)' }}>{v.critical_missing} critical missing</div></td>
                    <td><Profile profile={v.evidence_profile} /></td>
                    <td style={{ maxWidth: 460 }}>
                      {blockers.length === 0 ? <Badge value="none — meets the policy" tone="good" /> : (
                        <ul className="small" style={{ margin: 0, paddingLeft: 16, color: 'var(--warn)' }}>{blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>)}
                    </td>
                    <td>
                      <form action={publishVersion} className="inline">
                        <input type="hidden" name="version_id" value={v.id} /><input type="hidden" name="back" value={back} />
                        <button type="submit" className="primary" disabled={!admin || blockers.length > 0}
                          title={blockers.length ? 'Blocked — see the list' : admin ? 'Publish this version' : 'Administrator action'}>Publish</button>
                      </form>
                      {!admin ? <div className="faint small" style={{ marginTop: 3 }}>administrator only</div> : null}
                    </td>
                  </tr>);
              })}
            </tbody>
          </table>
        </Panel>

        <Panel title="Live publications" right={<span className="mono">{live.length}</span>} flush>
          <table>
            <thead><tr>
              <th>Name</th><th className="num">Publication</th><th>Published</th><th className="num">Completeness</th><th>Evidence profile</th><th>Withdraw</th>
            </tr></thead>
            <tbody>
              {live.length === 0 ? <Empty cols={6}>Nothing is published. A publication appears here once an administrator publishes an approved version that has no blockers.</Empty> : null}
              {live.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/business/${p.model_slug}?tab=versions`}>{p.name}</Link><div className="mono faint small">{p.slug} · from version {p.version_no}</div></td>
                  <td className="num">#{p.publication_no}</td>
                  <td className="small">{p.published_by_name ?? 'unknown'}<div className="mono faint">{dateTime(p.published_at)}</div></td>
                  <td className="num">{pct(p.completeness_pct)}</td>
                  <td><Profile profile={p.evidence_profile} /></td>
                  <td>
                    <form action={withdrawPublication} className="inline">
                      <input type="hidden" name="publication_id" value={p.id} /><input type="hidden" name="back" value={back} />
                      <input name="reason" placeholder="Reason for withdrawal (required, min 10 characters)" required minLength={10} style={{ width: 320 }} disabled={!admin} />
                      <button type="submit" className="bad" disabled={!admin}>Withdraw</button>
                    </form>
                    {!admin ? <div className="faint small" style={{ marginTop: 3 }}>administrator only</div> : null}
                  </td>
                </tr>))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Publication history — superseded and withdrawn" right={<span className="mono">{history.length}</span>} flush>
          <table>
            <thead><tr>
              <th>Name</th><th className="num">Publication</th><th>Status</th><th>Published</th><th className="num">Completeness</th><th>Evidence profile</th><th>Withdrawn</th><th>Reason</th>
            </tr></thead>
            <tbody>
              {history.length === 0 ? <Empty cols={8}>No publication has been superseded or withdrawn.</Empty> : null}
              {history.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/business/${p.model_slug}?tab=versions`}>{p.name}</Link><div className="mono faint small">from version {p.version_no}</div></td>
                  <td className="num">#{p.publication_no}</td>
                  <td><Badge value={p.status} /></td>
                  <td className="small">{p.published_by_name ?? 'unknown'}<div className="mono faint">{dateTime(p.published_at)}</div></td>
                  <td className="num">{pct(p.completeness_pct)}</td>
                  <td><Profile profile={p.evidence_profile} /></td>
                  <td className="mono small">{dateTime(p.withdrawn_at)}</td>
                  <td className="small" style={{ maxWidth: 360 }}>{p.withdrawn_reason ?? <span className="faint">—</span>}</td>
                </tr>))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}

import { can, type StaffUser } from '@/lib/auth';
import { asUser, type Row } from '@/lib/db';
import { dateTime, humanize, pct, valueWithUnit } from '@/lib/format';
import { Badge, Empty, Panel } from '@/components/ui';
import { decideVersion, publishVersion, submitVersion } from '@/app/actions/research';

interface Change { where: string; field: string; before: string; after: string }

function diffSnapshots(prev: Row | undefined, next: Row): Change[] {
  if (!prev) return [];
  const out: Change[] = [];
  const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  for (const f of ['name', 'description', 'operating_model', 'target_customers'] as const) {
    if (show(prev.model?.[f]) !== show(next.model?.[f])) out.push({ where: 'Identity', field: humanize(f), before: show(prev.model?.[f]).slice(0, 120), after: show(next.model?.[f]).slice(0, 120) });
  }
  const index = (snap: Row, list: 'cost_items' | 'parameters') => {
    const m = new Map<string, Row>();
    for (const v of snap.variants ?? []) for (const item of v[list] ?? []) m.set(`${v.slug}/${item.key}${item.revenue_stream ? `/${item.revenue_stream}` : ''}`, item);
    return m;
  };
  for (const [list, label] of [['cost_items', 'Cost item'], ['parameters', 'Parameter']] as const) {
    const a = index(prev, list), b = index(next, list);
    for (const [key, item] of b) {
      const old = a.get(key);
      const val = (x: Row | undefined) => (list === 'cost_items' ? x?.resolved : x?.is_resolved ? x : null);
      const before = val(old), after = val(item);
      const fmt = (x: Row | null | undefined) => (x ? `${valueWithUnit(x.value, x.unit)} [${x.basis}, ${x.evidence_grade}]` : 'unresolved');
      if (!old) out.push({ where: label, field: item.name, before: 'not present', after: fmt(after) });
      else if (fmt(before) !== fmt(after)) out.push({ where: label, field: item.name, before: fmt(before), after: fmt(after) });
      if (list === 'cost_items' && old && (old.observations?.length ?? 0) !== (item.observations?.length ?? 0)) {
        out.push({ where: label, field: `${item.name} — usable observations`, before: String(old.observations?.length ?? 0), after: String(item.observations?.length ?? 0) });
      }
    }
    for (const [key, item] of a) if (!b.has(key)) out.push({ where: label, field: item.name, before: 'present', after: 'removed' });
  }
  const cp = prev.quality?.completeness?.completeness_pct, cn = next.quality?.completeness?.completeness_pct;
  if (cp !== cn) out.push({ where: 'Quality', field: 'Completeness', before: pct(cp), after: pct(cn) });
  return out;
}

export async function VersionsTab({ user, model, back }: { user: StaffUser; model: Row; back: string }) {
  const { versions, publications } = await asUser(user.id, async (sql) => ({
    versions: await sql`
      select v.*, pub.publication_blockers(v.id) as blockers,
             (select display_name from ops.staff_members s where s.user_id = v.submitted_by) as submitted_by_name,
             (select display_name from ops.staff_members s where s.user_id = v.decided_by) as decided_by_name
      from intel.business_versions v where v.business_model_id = ${model.id} order by v.version_no desc`,
    publications: await sql`select * from pub.publication_versions where business_model_id = ${model.id} order by publication_no desc`,
  }));
  const hasPending = versions.some((v) => v.status === 'submitted');

  return (
    <div className="grid">
      <Panel title="Submit the current record for review">
        <form action={submitVersion} className="inline" style={{ width: '100%' }}>
          <input type="hidden" name="model_id" value={model.id} /><input type="hidden" name="back" value={back} />
          <input name="change_summary" placeholder="What changed since the last version" required minLength={5} style={{ flex: 1, minWidth: 320 }} />
          <button type="submit" className="primary" disabled={!can(user, 'admin', 'researcher') || hasPending}>Submit version</button>
        </form>
        <p className="faint small" style={{ marginTop: 6 }}>
          Submitting freezes a snapshot of the record with its quality metrics. A different person must review it (four-eyes). {hasPending ? 'A version is already awaiting review.' : ''}
        </p>
      </Panel>

      {versions.length === 0 ? <div className="notice warn">No version has been submitted yet.</div> : null}
      {versions.map((v, ix) => {
        const changes = diffSnapshots(versions[ix + 1]?.snapshot, v.snapshot);
        const published = publications.find((p) => p.business_version_id === v.id);
        return (
          <Panel key={v.id} title={`Version ${v.version_no}`} right={<><Badge value={v.status} />{published ? <Badge value={`publication ${published.publication_no}: ${published.status}`} tone={published.status === 'live' ? 'good' : undefined} /> : null}</>}>
            <div className="grid g2">
              <dl className="kv">
                <dt>Submitted</dt><dd>{dateTime(v.submitted_at)} by {v.submitted_by_name ?? (v.submitted_by_run ? 'research pipeline' : 'unknown')}</dd>
                <dt>Change summary</dt><dd>{v.change_summary ?? '—'}</dd>
                <dt>Decision</dt><dd>{v.decided_at ? `${dateTime(v.decided_at)} by ${v.decided_by_name ?? 'unknown'}${v.decision_comments ? ` — ${v.decision_comments}` : ''}` : <span className="faint">awaiting review</span>}</dd>
                <dt>Snapshot hash</dt><dd className="mono small">{String(v.snapshot_hash).slice(0, 24)}…</dd>
              </dl>
              <dl className="kv">
                <dt>Completeness</dt><dd>{pct(v.completeness_pct)} · {v.critical_missing} critical missing</dd>
                <dt>Evidence at submission</dt><dd className="mono">A {v.evidence_profile.A} · B {v.evidence_profile.B} · C {v.evidence_profile.C} · D {v.evidence_profile.D} · {v.evidence_profile.assumptions} assumptions</dd>
                <dt>Open issues</dt><dd>{v.pending_claims} claims unreviewed · {v.open_conflicts} conflicts · {v.stale_observations} stale · {v.restricted_source_rows} from sources without reuse rights</dd>
                <dt>Demo / test rows</dt><dd>{v.non_research_rows === 0 ? 'none' : <Badge value={`${v.non_research_rows} — unpublishable`} tone="bad" />}</dd>
              </dl>
            </div>

            {v.status === 'submitted' ? (
              <form action={decideVersion} className="inline" style={{ marginTop: 10 }}>
                <input type="hidden" name="version_id" value={v.id} /><input type="hidden" name="back" value={back} />
                <input name="comments" placeholder="Review comments (required unless approving)" style={{ width: 420 }} />
                <button type="submit" name="decision" value="approve" className="good" disabled={!can(user, 'admin', 'reviewer')}>Approve</button>
                <button type="submit" name="decision" value="request_changes" disabled={!can(user, 'admin', 'reviewer')}>Request changes</button>
                <button type="submit" name="decision" value="reject" className="bad" disabled={!can(user, 'admin', 'reviewer')}>Reject</button>
                {v.submitted_by === user.id ? <span className="badge warn">you submitted this — someone else must decide</span> : null}
              </form>) : null}

            {['submitted', 'approved'].includes(v.status) ? (
              (v.blockers as string[]).length ? (
                <div className="notice warn" style={{ marginTop: 10, marginBottom: 0 }}><b>Cannot be published yet:</b><ul>{(v.blockers as string[]).map((b, i) => <li key={i}>{b}</li>)}</ul></div>
              ) : (
                <form action={publishVersion} className="inline" style={{ marginTop: 10 }}>
                  <input type="hidden" name="version_id" value={v.id} /><input type="hidden" name="back" value={back} />
                  <button type="submit" className="primary" disabled={!can(user, 'admin') || Boolean(published)}>Publish this version</button>
                  <span className="faint small">Meets the publication policy. Publishing is an administrator action.</span>
                </form>)) : null}

            <details style={{ marginTop: 10 }}>
              <summary>{versions[ix + 1] ? `Changes since version ${versions[ix + 1].version_no} (${changes.length})` : 'First version — no earlier version to compare'}</summary>
              {versions[ix + 1] ? (
                <table>
                  <thead><tr><th>Area</th><th>Field</th><th>Before</th><th>After</th></tr></thead>
                  <tbody>
                    {changes.length === 0 ? <Empty cols={4}>No differences in identity, resolved values or completeness.</Empty> : null}
                    {changes.map((c, i) => <tr key={i}><td className="muted">{c.where}</td><td>{c.field}</td><td className="mono small">{c.before}</td><td className="mono small">{c.after}</td></tr>)}
                  </tbody>
                </table>) : null}
            </details>
            <details><summary>Frozen snapshot (JSON)</summary><pre className="pagetext">{JSON.stringify(v.snapshot, null, 1).slice(0, 60000)}</pre></details>
          </Panel>);
      })}
    </div>
  );
}

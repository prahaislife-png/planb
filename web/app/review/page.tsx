import { Fragment } from 'react';
import Link from 'next/link';
import { can, requireStaff } from '@/lib/auth';
import { asUser } from '@/lib/db';
import { dateTime, inr, num, pct } from '@/lib/format';
import { Badge, Empty, Flash, OriginBadge, PageHead, Panel, Stat } from '@/components/ui';
import { acceptVerifiedClaims, decideVersion, resolveConflict } from '@/app/actions/research';
import { ClaimRow } from '@/app/business/[slug]/tabs/evidence';

const CLAIM_LIMIT = 40;

export default async function ReviewInbox({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const back = '/review';

  const d = await asUser(user.id, async (sql) => ({
    versions: await sql`
      select v.id, v.version_no, v.submitted_by, v.submitted_by_run, v.submitted_at, v.change_summary, v.completeness_pct,
             v.critical_missing, v.pending_claims, v.open_conflicts, v.data_origin, m.slug, m.name,
             pub.publication_blockers(v.id) as blockers,
             (select s.display_name from ops.staff_members s where s.user_id = v.submitted_by) as submitted_by_name,
             (select count(*) from intel.evidence_claims c where c.business_model_id = v.business_model_id and c.status = 'extracted') as pending_now
      from intel.business_versions v
      join intel.business_models m on m.id = v.business_model_id
      where v.status = 'submitted'
      order by v.submitted_at`,
    documents: await sql`
      select d.id, d.title, d.page_count, d.data_origin, s.name as source_name, s.reuse_status, m.slug, m.name as model_name,
             count(*) as pending,
             count(*) filter (where c.quote_verified) as acceptable,
             count(*) filter (where not c.quote_verified) as not_found,
             min(c.created_at) as oldest,
             (select count(*) from intel.evidence_claims x
               where x.source_document_id = d.id and x.status = 'extracted' and x.quote_verified) as document_acceptable
      from intel.evidence_claims c
      join intel.source_documents d on d.id = c.source_document_id
      join intel.sources s on s.id = d.source_id
      left join intel.business_models m on m.id = c.business_model_id
      where c.status = 'extracted'
      group by d.id, d.title, d.page_count, d.data_origin, s.name, s.reuse_status, m.slug, m.name
      order by min(c.created_at), d.title, m.name`,
    claims: await sql`
      select c.*, d.title as doc_title, m.slug as model_slug, m.name as model_name
      from intel.evidence_claims c
      join intel.source_documents d on d.id = c.source_document_id
      left join intel.business_models m on m.id = c.business_model_id
      where c.status = 'extracted'
      order by c.created_at, c.source_document_id, c.business_model_id, c.page_no, c.id
      limit ${CLAIM_LIMIT}`,
    conflicts: await sql`
      select c.id, c.observation_count, c.min_value, c.max_value, c.spread_pct, c.detected_at, c.parameter_key, c.cost_item_id,
             ci.name as item_name, bv.name as variant_name, m.slug, m.name as model_name
      from intel.observation_conflicts c
      join intel.business_variants bv on bv.id = c.business_variant_id
      join intel.business_models m on m.id = bv.business_model_id
      left join intel.cost_items ci on ci.id = c.cost_item_id
      where c.status = 'open'
      order by c.detected_at`,
  }));

  const canDecide = can(user, 'admin', 'reviewer');
  const canReview = can(user, 'admin', 'reviewer', 'researcher');
  const pendingTotal = d.documents.reduce((n, r) => n + Number(r.pending), 0);
  const notFoundTotal = d.documents.reduce((n, r) => n + Number(r.not_found), 0);
  // The bulk action works on a whole document, so offer it once per document even when the document feeds several models.
  const docRows = new Map<string, number>();
  for (const r of d.documents) docRows.set(r.id, (docRows.get(r.id) ?? 0) + 1);
  const firstRowOfDoc = new Set<number>();
  d.documents.forEach((r, ix) => { if (d.documents.findIndex((x) => x.id === r.id) === ix) firstRowOfDoc.add(ix); });

  return (
    <>
      <PageHead title="Review & approval inbox"
        sub="Everything waiting for a human decision: submitted versions, extracted claims and conflicting observations. A version cannot be decided by the person who submitted it; the database enforces every rule shown here." />
      <Flash params={sp} />

      <div className="grid g4" style={{ marginBottom: 12 }}>
        <Stat label="Versions awaiting decision" value={num(d.versions.length)} tone={d.versions.length ? 'warn' : undefined} />
        <Stat label="Claims awaiting review" value={num(pendingTotal)} note={`in ${num(docRows.size)} documents`} tone={pendingTotal ? 'warn' : undefined} />
        <Stat label="Pending with quote not found" value={num(notFoundTotal)} note="cannot be accepted; correct or reject" tone={notFoundTotal ? 'bad' : undefined} />
        <Stat label="Open observation conflicts" value={num(d.conflicts.length)} tone={d.conflicts.length ? 'warn' : undefined} />
      </div>

      <div className="grid">
        <Panel title="Submitted versions awaiting a decision" flush
          right={<>{!canDecide ? <span className="muted">deciding a version needs the reviewer or admin role</span> : null}<span className="mono">{d.versions.length}</span></>}>
          <table>
            <thead><tr>
              <th>Business model</th><th className="num">Version</th><th>Submitted</th><th className="num">Completeness</th>
              <th className="num" title="Claims awaiting review when the version was frozen / right now">Pending claims</th>
              <th>Publication blockers</th><th>Decision</th>
            </tr></thead>
            <tbody>
              {d.versions.length === 0 ? <Empty cols={7}>No version is awaiting a decision. Researchers submit versions from a business record&apos;s Versions tab.</Empty> : null}
              {d.versions.map((v) => {
                const blockers = v.blockers as string[];
                const own = v.submitted_by === user.id;
                return (
                  <tr key={v.id}>
                    <td>
                      <Link href={`/business/${v.slug}?tab=versions`}>{v.name}</Link> <OriginBadge origin={v.data_origin} />
                      <div className="faint small">{v.change_summary ?? 'no change summary'}</div>
                    </td>
                    <td className="num">v{v.version_no}</td>
                    <td className="small">
                      {v.submitted_by_name ?? (v.submitted_by_run ? 'research pipeline' : 'unknown')}
                      <div className="mono faint">{dateTime(v.submitted_at)}</div>
                    </td>
                    <td className="num">{pct(v.completeness_pct)}
                      <div className="small" style={{ color: v.critical_missing ? 'var(--bad)' : 'var(--faint)' }}>{v.critical_missing} critical missing</div></td>
                    <td className="num">{num(v.pending_claims)}<div className="faint small">{num(v.pending_now)} now</div></td>
                    <td style={{ maxWidth: 380 }}>
                      {blockers.length === 0 ? <Badge value="none" tone="good" /> : (
                        <details><summary>{blockers.length} blocker{blockers.length === 1 ? '' : 's'}</summary>
                          <ul className="small muted" style={{ margin: 0, paddingLeft: 16 }}>{blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
                        </details>)}
                    </td>
                    <td>
                      <form action={decideVersion} className="inline">
                        <input type="hidden" name="version_id" value={v.id} /><input type="hidden" name="back" value={back} />
                        <input name="comments" placeholder="Comments (required unless approving)" style={{ width: 240 }} />
                        <button type="submit" name="decision" value="approve" className="good" disabled={!canDecide || own}>Approve</button>
                        <button type="submit" name="decision" value="request_changes" disabled={!canDecide || own}>Request changes</button>
                        <button type="submit" name="decision" value="reject" className="bad" disabled={!canDecide || own}>Reject</button>
                      </form>
                      {own ? <div style={{ marginTop: 4 }}><span className="badge warn">you submitted this — someone else must decide</span></div> : null}
                    </td>
                  </tr>);
              })}
            </tbody>
          </table>
        </Panel>

        <Panel title="Documents with claims awaiting review" right={<span className="mono">{num(pendingTotal)} claims</span>} flush>
          <table>
            <thead><tr>
              <th>Document</th><th>Source</th><th>Business model</th><th className="num">Pending</th><th className="num">Quote verified</th>
              <th className="num">Quote not found</th><th>Oldest pending</th><th>Bulk accept (whole document)</th>
            </tr></thead>
            <tbody>
              {d.documents.length === 0 ? <Empty cols={8}>No extracted claim is awaiting review.</Empty> : null}
              {d.documents.map((r, ix) => (
                <tr key={`${r.id}/${r.slug ?? ''}`}>
                  <td><Link href={`/documents/${r.id}`}>{r.title}</Link> <OriginBadge origin={r.data_origin} />
                    <div className="faint small">{r.page_count === null ? 'page count missing' : `${r.page_count} pages`}</div></td>
                  <td className="small"><span className="muted">{r.source_name}</span> <Badge value={r.reuse_status} title="Source reuse terms" /></td>
                  <td>{r.slug ? <Link href={`/business/${r.slug}?tab=evidence`}>{r.model_name}</Link> : <span className="faint">not linked to a business model</span>}</td>
                  <td className="num">{num(r.pending)}</td>
                  <td className="num" style={{ color: 'var(--good)' }}>{num(r.acceptable)}</td>
                  <td className="num" style={{ color: Number(r.not_found) ? 'var(--bad)' : undefined }}>{num(r.not_found)}</td>
                  <td className="mono small">{dateTime(r.oldest)}</td>
                  <td>
                    {firstRowOfDoc.has(ix) ? (
                      <form action={acceptVerifiedClaims} className="inline">
                        <input type="hidden" name="document_id" value={r.id} /><input type="hidden" name="back" value={back} />
                        <button type="submit" disabled={!canReview || Number(r.document_acceptable) === 0}
                          title="Use only after reading the document against its claims">Accept all {num(r.document_acceptable)} quote-verified</button>
                        {(docRows.get(r.id) ?? 1) > 1 ? <span className="faint small">covers all {docRows.get(r.id)} business models of this document</span> : null}
                      </form>) : <span className="faint small">see first row of this document</span>}
                  </td>
                </tr>))}
            </tbody>
          </table>
        </Panel>

        <Panel title={`Oldest pending claims (up to ${CLAIM_LIMIT})`}
          right={<span className="mono">{d.claims.length} of {num(pendingTotal)} shown</span>} flush>
          <table>
            <thead><tr><th>Page</th><th>Subject</th><th className="num">As printed</th><th className="num">Normalised</th><th>Verbatim quote</th><th>Quote check</th><th>Status</th><th>Review</th></tr></thead>
            <tbody>
              {d.claims.length === 0 ? <Empty cols={8}>No extracted claim is awaiting review.</Empty> : null}
              {d.claims.map((c, ix) => {
                const prev = d.claims[ix - 1];
                const newGroup = !prev || prev.source_document_id !== c.source_document_id || prev.business_model_id !== c.business_model_id;
                return (
                  <Fragment key={c.id}>
                    {newGroup ? (
                      <tr className="sub"><td colSpan={8}>
                        <Link href={`/documents/${c.source_document_id}`}>{c.doc_title}</Link>
                        {' · '}
                        {c.model_slug ? <Link href={`/business/${c.model_slug}?tab=evidence`}>{c.model_name}</Link> : 'not linked to a business model'}
                      </td></tr>) : null}
                    <ClaimRow c={c} back={back} canReview={canReview} />
                  </Fragment>);
              })}
            </tbody>
          </table>
        </Panel>

        <Panel title="Open observation conflicts" right={<span className="mono">{d.conflicts.length}</span>} flush>
          <table>
            <thead><tr>
              <th>Business model</th><th>Subject</th><th className="num">Observations</th><th className="num">Lowest</th><th className="num">Highest</th>
              <th className="num">Spread</th><th>Detected</th><th>Resolution</th>
            </tr></thead>
            <tbody>
              {d.conflicts.length === 0 ? <Empty cols={8}>No open conflict. Conflicts appear when comparable observations of the same item disagree beyond tolerance.</Empty> : null}
              {d.conflicts.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/business/${c.slug}?tab=${c.cost_item_id ? 'costs' : 'revenue'}`}>{c.model_name}</Link><div className="faint small">{c.variant_name}</div></td>
                  <td>{c.item_name ?? <span className="mono">{c.parameter_key}</span>}<div className="faint small">{c.cost_item_id ? 'cost item' : 'parameter'}</div></td>
                  <td className="num">{num(c.observation_count)}</td>
                  <td className="num">{c.cost_item_id ? inr(c.min_value) : num(c.min_value, 2)}</td>
                  <td className="num">{c.cost_item_id ? inr(c.max_value) : num(c.max_value, 2)}</td>
                  <td className="num">{pct(c.spread_pct, 0)}</td>
                  <td className="mono small">{dateTime(c.detected_at)}</td>
                  <td>
                    <form action={resolveConflict} className="inline">
                      <input type="hidden" name="conflict_id" value={c.id} /><input type="hidden" name="back" value={back} />
                      <input name="note" placeholder="Why — e.g. different capacity, GST basis" required minLength={5} style={{ width: 240 }} />
                      <select name="status" style={{ width: 140 }}><option value="resolved">Resolved</option><option value="accepted_as_range">Accept as range</option></select>
                      <button type="submit" disabled={!canReview}>Close</button>
                    </form>
                    <div className="small" style={{ marginTop: 3 }}><Link href={`/business/${c.slug}?tab=${c.cost_item_id ? 'costs' : 'revenue'}`}>compare the observations →</Link></div>
                  </td>
                </tr>))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}

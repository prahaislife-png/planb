import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { asUser } from '@/lib/db';
import { date, humanize, num, pct } from '@/lib/format';
import { Badge, Empty, GradeBar, Meter, OriginBadge, PageHead, Panel, Stat } from '@/components/ui';

const warnIf = (n: number) => (n > 0 ? { color: 'var(--warn)' } : undefined);
const badIf = (n: number) => (n > 0 ? { color: 'var(--bad)' } : undefined);
const W = { whiteSpace: 'normal' } as const; // lets a long column header wrap instead of widening the table
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export default async function Quality() {
  const user = await requireStaff();
  const d = await asUser(user.id, async (sql) => {
    const businesses = await sql`
      select m.slug, m.name, m.lifecycle_status, m.data_origin,
             c.completeness_pct, c.checks_passed, c.checks_total, c.critical_missing,
             q.observation_count, q.grade_a, q.grade_b, q.grade_c, q.grade_d, q.verified_count, q.unverified_count, q.disputed_count,
             q.stale_count, q.open_conflicts, q.claims_pending_review, q.claims_quote_unverified, q.assumption_count, q.parameter_count,
             q.parameters_c_or_better_pct, q.distinct_sources
      from intel.business_models m
      join intel.v_business_completeness c on c.business_model_id = m.id
      join intel.v_business_evidence_quality q on q.business_model_id = m.id
      where m.lifecycle_status <> 'backlog'
      order by m.name`;
    const [backlog] = await sql`select count(*) as n from intel.business_models where lifecycle_status = 'backlog'`;
    const missing = await sql`
      select m.slug, m.name, i.check_key, i.section, i.label
      from intel.v_completeness_items i join intel.business_models m on m.id = i.business_model_id
      where not i.is_satisfied and i.is_critical and m.lifecycle_status <> 'backlog'
      order by m.name, i.section, i.check_key`;
    const conflicts = await sql`
      select c.id, c.parameter_key, c.observation_count, c.min_value, c.max_value, c.spread_pct, c.detected_at, c.last_seen_at,
             m.slug, m.name as model_name, bv.name as variant_name, ci.name as cost_item_name
      from intel.observation_conflicts c
      join intel.business_variants bv on bv.id = c.business_variant_id
      join intel.business_models m on m.id = bv.business_model_id
      left join intel.cost_items ci on ci.id = c.cost_item_id
      where c.status = 'open'
      order by c.spread_pct desc, c.detected_at limit 200`;
    const [conflictCount] = await sql`select count(*) as n from intel.observation_conflicts where status = 'open'`;
    const byVerification = await sql`
      select verification_status, count(*) as n from intel.v_usable_observations group by 1 order by 2 desc`;
    const byEvidenceType = await sql`
      select evidence_type, count(*) as n,
             count(*) filter (where verification_status = 'verified') as verified,
             count(*) filter (where verification_status = 'unverified') as unverified,
             count(*) filter (where verification_status = 'disputed') as disputed
      from intel.v_usable_observations group by 1 order by 2 desc`;
    const [claimTotals] = await sql`
      select count(*) as total, count(*) filter (where not quote_verified) as quote_unverified,
             count(*) filter (where status = 'extracted') as pending
      from intel.evidence_claims`;
    const unverifiedClaims = await sql`
      select c.id, c.subject, c.attribute, c.quote, c.page_no, c.status, c.quote_match_score, c.extraction_method,
             doc.title as document_title, m.slug, m.name as model_name
      from intel.evidence_claims c
      join intel.source_documents doc on doc.id = c.source_document_id
      left join intel.business_models m on m.id = c.business_model_id
      where not c.quote_verified
      order by (c.status = 'extracted') desc, c.created_at desc limit 50`;
    const staleKinds = await sql`
      select item_kind, count(*) as tracked, count(*) filter (where days_overdue > 0) as overdue,
             max(days_overdue) filter (where days_overdue > 0) as worst
      from intel.v_freshness_queue group by 1 order by 3 desc, 1`;
    const stale = await sql`
      select f.item_kind, f.item_id, f.label, f.due_on, f.days_overdue, m.slug, m.name as model_name
      from intel.v_freshness_queue f left join intel.business_models m on m.id = f.business_model_id
      where f.days_overdue > 0
      order by f.days_overdue desc, f.item_kind, f.label limit 50`;
    const [grades] = await sql`
      select count(*) as n,
             count(*) filter (where evidence_grade = 'A') as a, count(*) filter (where evidence_grade = 'B') as b,
             count(*) filter (where evidence_grade = 'C') as c, count(*) filter (where evidence_grade = 'D') as d
      from intel.v_usable_observations`;
    const gradesBySection = await sql`
      select section, count(*) as n,
             count(*) filter (where evidence_grade = 'A') as a, count(*) filter (where evidence_grade = 'B') as b,
             count(*) filter (where evidence_grade = 'C') as c, count(*) filter (where evidence_grade = 'D') as d
      from intel.v_usable_observations group by 1 order by 2 desc`;
    return { businesses, backlog: Number(backlog.n), missing, conflicts, conflictTotal: Number(conflictCount.n), byVerification, byEvidenceType,
      claimTotals, unverifiedClaims, staleKinds, stale, grades, gradesBySection };
  });

  const observations = Number(d.grades.n);
  const unverified = d.byVerification.filter((r) => r.verification_status !== 'verified').reduce((sum, r) => sum + Number(r.n), 0);
  const overdue = d.staleKinds.reduce((sum, r) => sum + Number(r.overdue), 0);
  const tracked = d.staleKinds.reduce((sum, r) => sum + Number(r.tracked), 0);

  return (
    <>
      <PageHead title="Data quality"
        sub="Two separate questions are asked of every record and are never merged into one score: completeness — how much of the record exists — and evidence quality — how good the evidence behind what exists is. A record can be complete and weak, or thin and excellent." />
      <div className="grid g4" style={{ marginBottom: 12 }}>
        <Stat label="Missing" value={num(d.missing.length)} note={`critical record sections absent across ${num(d.businesses.length)} records in research`} tone={d.missing.length > 0 ? 'bad' : 'good'} />
        <Stat label="Contradictory" value={num(d.conflictTotal)} note="open conflicts between comparable observations" tone={d.conflictTotal > 0 ? 'warn' : 'good'} />
        <Stat label="Unverified" value={observations ? num(unverified) : '—'} note={observations ? `of ${num(observations)} usable observations not yet verified by a reviewer` : 'no observations recorded yet'} tone={unverified > 0 ? 'warn' : observations ? 'good' : undefined} />
        <Stat label="Outdated" value={tracked ? num(overdue) : '—'} note={tracked ? `of ${num(tracked)} dated items past their revalidation or expiry date` : 'nothing carries a revalidation date yet'} tone={overdue > 0 ? 'warn' : tracked ? 'good' : undefined} />
      </div>

      <div style={{ marginBottom: 12 }}>
        <Panel title={`Records in research (${d.businesses.length})`} right={<span className="faint">{num(d.backlog)} backlog models not shown — nothing has been researched for them</span>} flush>
          <table>
            <thead>
              <tr>
                <th rowSpan={2} style={{ minWidth: 190 }}>Business model</th>
                <th colSpan={2} style={{ ...W, borderLeft: '1px solid var(--line)' }}>Completeness — how much of the record exists</th>
                <th colSpan={11} style={{ borderLeft: '1px solid var(--line)' }}>Evidence quality — how good the evidence behind it is</th>
              </tr>
              <tr>
                <th style={{ minWidth: 150, borderLeft: '1px solid var(--line)' }}>Checks satisfied</th><th className="num" style={W}>Critical missing</th>
                <th style={{ minWidth: 190, borderLeft: '1px solid var(--line)' }}>Grades A/B/C/D</th>
                <th className="num" style={W}>Verified</th><th className="num" style={W}>Unverified</th><th className="num" style={W}>Disputed</th><th className="num" style={W}>Stale</th>
                <th className="num" style={W}>Open conflicts</th><th className="num" style={W}>Claims pending</th>
                <th className="num" style={W} title="Extracted claims whose quote could not be found in their document">Quote not found</th>
                <th className="num" style={W} title="Model inputs that are assumptions (grade D) out of all current base-scenario parameters">Assumptions / parameters</th>
                <th className="num" style={W} title="Share of current base-scenario model parameters graded C or better">Parameters C or better</th>
                <th className="num" style={W}>Distinct sources</th>
              </tr>
            </thead>
            <tbody>
              {d.businesses.length === 0 ? <Empty cols={14}>No record has left the backlog, so there is nothing to measure yet. Ingest a source document from a business record.</Empty> : null}
              {d.businesses.map((m) => (
                <tr key={m.slug}>
                  <td><Link href={`/business/${m.slug}`}>{m.name}</Link> <OriginBadge origin={m.data_origin} /><div><Badge value={m.lifecycle_status} /></div></td>
                  <td style={{ borderLeft: '1px solid var(--line-soft)' }}><Meter pct={m.completeness_pct} /><div className="faint small">{m.checks_passed} of {m.checks_total} checks</div></td>
                  <td className="num" style={badIf(m.critical_missing)}><Link href={`/business/${m.slug}?tab=gaps`} style={{ color: 'inherit' }}>{m.critical_missing}</Link></td>
                  <td style={{ borderLeft: '1px solid var(--line-soft)' }}><GradeBar a={m.grade_a} b={m.grade_b} c={m.grade_c} d={m.grade_d} /></td>
                  {m.observation_count > 0 ? (
                    <>
                      <td className="num">{m.verified_count}</td>
                      <td className="num" style={warnIf(m.unverified_count)}>{m.unverified_count}</td>
                      <td className="num" style={warnIf(m.disputed_count)}>{m.disputed_count}</td>
                      <td className="num" style={warnIf(m.stale_count)}>{m.stale_count}</td>
                    </>
                  ) : <td colSpan={4} className="faint small" style={{ textAlign: 'center' }}>no observations yet</td>}
                  <td className="num" style={warnIf(m.open_conflicts)}>{m.open_conflicts}</td>
                  <td className="num" style={warnIf(m.claims_pending_review)}>{m.claims_pending_review}</td>
                  <td className="num" style={badIf(m.claims_quote_unverified)}>{m.claims_quote_unverified}</td>
                  <td className="num">{m.parameter_count > 0 ? `${m.assumption_count} / ${m.parameter_count}` : <span className="faint" title="No model parameter has been resolved yet">—</span>}</td>
                  <td className="num">{m.parameters_c_or_better_pct === null ? <span className="faint" title="No model parameter has been resolved yet">—</span> : pct(m.parameters_c_or_better_pct)}</td>
                  <td className="num">{m.observation_count > 0 ? m.distinct_sources : <span className="faint">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div className="grid g2" style={{ marginBottom: 12 }}>
        <Panel title={`Evidence quality · grade of all usable observations (${num(observations)})`}>
          <GradeBar a={Number(d.grades.a)} b={Number(d.grades.b)} c={Number(d.grades.c)} d={Number(d.grades.d)} />
          <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
            A = verified primary or regulatory evidence · B = corroborated by independent sources · C = single source, older benchmark or self-reported · D = estimate or assumption.
            A grade belongs to each number; it says nothing about how complete a record is.
          </p>
        </Panel>
        <Panel title="Evidence quality · grades by section" flush>
          <table>
            <thead><tr><th>Section</th><th className="num">Observations</th><th style={{ width: '55%' }}>Grades A/B/C/D</th></tr></thead>
            <tbody>
              {d.gradesBySection.length === 0 ? <Empty cols={3}>No usable observation has been recorded, so there are no grades to distribute.</Empty> : null}
              {d.gradesBySection.map((r) => (
                <tr key={r.section}><td>{humanize(r.section)}</td><td className="num">{num(r.n)}</td>
                  <td><GradeBar a={Number(r.a)} b={Number(r.b)} c={Number(r.c)} d={Number(r.d)} /></td></tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div className="grid g2" style={{ marginBottom: 12 }}>
        <Panel title={`Missing · critical parts of a record that do not exist (${d.missing.length})`} flush>
          <table>
            <thead><tr><th>Business model</th><th>Section</th><th>Critical check not satisfied</th></tr></thead>
            <tbody>
              {d.missing.length === 0 ? (
                <Empty cols={3}>{d.businesses.length === 0 ? 'No record is in research yet, so no completeness check applies.' : 'Every critical completeness check is satisfied for the records in research.'}</Empty>
              ) : null}
              {d.missing.map((r) => (
                <tr key={`${r.slug}:${r.check_key}`}>
                  <td><Link href={`/business/${r.slug}?tab=gaps`}>{r.name}</Link></td>
                  <td className="muted">{humanize(r.section)}</td>
                  <td>{r.label} <span className="mono small faint">{r.check_key}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title={`Contradictory · open conflicts between observations (${d.conflictTotal})`} flush>
          <table>
            <thead><tr><th>Business model</th><th>Subject</th><th className="num">Observations</th><th className="num">Lowest</th><th className="num">Highest</th><th className="num">Spread</th><th>Detected</th></tr></thead>
            <tbody>
              {d.conflicts.length === 0 ? (
                <Empty cols={7}>No open conflict. Cross-verification opens one when comparable observations of the same subject disagree beyond tolerance — with a single source per figure there is nothing to disagree.</Empty>
              ) : null}
              {d.conflicts.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/business/${c.slug}?tab=${c.cost_item_name ? 'costs' : 'revenue'}`}>{c.model_name}</Link><div className="faint small">{c.variant_name}</div></td>
                  <td>{c.cost_item_name ?? <span className="mono">{c.parameter_key}</span>}<div className="faint small">{c.cost_item_name ? 'cost item' : 'parameter'}</div></td>
                  <td className="num">{c.observation_count}</td>
                  <td className="num">{num(c.min_value, 2)}</td>
                  <td className="num">{num(c.max_value, 2)}</td>
                  <td className="num" style={{ color: 'var(--warn)' }}>{pct(c.spread_pct)}</td>
                  <td className="mono small">{date(c.detected_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div className="grid g3" style={{ marginBottom: 12 }}>
        <Panel title="Unverified · usable observations by verification status" flush>
          <table>
            <thead><tr><th>Verification status</th><th className="num">Observations</th><th className="num">Share</th></tr></thead>
            <tbody>
              {d.byVerification.length === 0 ? <Empty cols={3}>No usable observation has been recorded yet.</Empty> : null}
              {d.byVerification.map((r) => (
                <tr key={r.verification_status}><td><Badge value={r.verification_status} /></td><td className="num">{num(r.n)}</td>
                  <td className="num">{pct((100 * Number(r.n)) / observations)}</td></tr>
              ))}
            </tbody>
          </table>
          {d.byVerification.length > 0 ? (
            <p className="faint small" style={{ padding: '6px 9px', margin: 0 }}>Only a reviewer or admin can mark an observation verified; a research worker never can. Rejected and superseded observations are not counted.</p>
          ) : null}
        </Panel>
        <Panel title="Unverified · usable observations by evidence type" flush>
          <table>
            <thead><tr><th>Evidence type</th><th className="num">Observations</th><th className="num">Verified</th><th className="num">Unverified</th><th className="num">Disputed</th></tr></thead>
            <tbody>
              {d.byEvidenceType.length === 0 ? <Empty cols={5}>No usable observation has been recorded yet.</Empty> : null}
              {d.byEvidenceType.map((r) => (
                <tr key={r.evidence_type}><td>{humanize(r.evidence_type)}</td><td className="num">{num(r.n)}</td><td className="num">{num(r.verified)}</td>
                  <td className="num" style={warnIf(Number(r.unverified))}>{num(r.unverified)}</td><td className="num" style={warnIf(Number(r.disputed))}>{num(r.disputed)}</td></tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Outdated · dated items by kind" flush>
          <table>
            <thead><tr><th>Kind</th><th className="num" title="Items that carry a revalidation or expiry date">Dated</th><th className="num">Overdue</th><th className="num">Most overdue</th></tr></thead>
            <tbody>
              {d.staleKinds.length === 0 ? <Empty cols={4}>Nothing carries a revalidation or expiry date yet.</Empty> : null}
              {d.staleKinds.map((r) => (
                <tr key={r.item_kind}><td>{humanize(r.item_kind.replace(':', ' · '))}</td><td className="num">{num(r.tracked)}</td>
                  <td className="num" style={warnIf(Number(r.overdue))}>{num(r.overdue)}</td>
                  <td className="num">{r.worst === null ? <span className="faint">—</span> : `${num(r.worst)} days`}</td></tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Panel title={`Unverified · claims whose quote was not found in the document (${num(d.claimTotals.quote_unverified)} of ${num(d.claimTotals.total)} claims)`} flush>
          <table>
            <thead><tr><th>Claim</th><th>Quote as extracted</th><th>Document</th><th className="num">Page</th><th className="num" title="Best fuzzy-match score of the quote against the page text (1 = exact)">Match</th><th>Status</th></tr></thead>
            <tbody>
              {d.unverifiedClaims.length === 0 ? (
                <Empty cols={6}>{Number(d.claimTotals.total) === 0
                  ? 'No claim has been extracted yet.'
                  : `All ${num(d.claimTotals.total)} extracted claims quote text that was found on the cited page of their document.`}</Empty>
              ) : null}
              {d.unverifiedClaims.map((c) => (
                <tr key={c.id}>
                  <td style={{ maxWidth: 220 }}>{c.subject}{c.attribute ? <span className="muted"> · {c.attribute}</span> : null}
                    {c.slug ? <div className="small"><Link href={`/business/${c.slug}?tab=evidence`}>{c.model_name}</Link></div> : null}</td>
                  <td><div className="quote" title={c.quote}>{clip(c.quote, 240)}</div></td>
                  <td className="small" style={{ maxWidth: 220 }}>{c.document_title}</td>
                  <td className="num">{c.page_no ?? <span className="faint">—</span>}</td>
                  <td className="num">{c.quote_match_score === null ? <span className="faint">—</span> : Number(c.quote_match_score).toFixed(2)}</td>
                  <td><Badge value={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {Number(d.claimTotals.quote_unverified) > d.unverifiedClaims.length ? <p className="faint small" style={{ padding: '6px 9px', margin: 0 }}>Showing the 50 most recent.</p> : null}
        </Panel>
      </div>

      <div>
        <Panel title={`Outdated · most overdue items (${overdue > d.stale.length ? `${d.stale.length} of ${num(overdue)}` : num(overdue)})`} flush>
          <table>
            <thead><tr><th>Item</th><th>Kind</th><th>Business model</th><th>Due on</th><th className="num">Days overdue</th></tr></thead>
            <tbody>
              {d.stale.length === 0 ? (
                <Empty cols={5}>{tracked === 0 ? 'Nothing carries a revalidation or expiry date yet.' : `None of the ${num(tracked)} dated items is past its revalidation or expiry date.`}</Empty>
              ) : null}
              {d.stale.map((r) => (
                <tr key={`${r.item_kind}:${r.item_id}`}>
                  <td style={{ maxWidth: 320 }}>{r.label ?? <span className="faint">—</span>}</td>
                  <td className="small muted">{humanize(r.item_kind.replace(':', ' · '))}</td>
                  <td>{r.slug ? <Link href={`/business/${r.slug}?tab=evidence`}>{r.model_name}</Link> : <span className="faint" title="Not tied to one business model">—</span>}</td>
                  <td className="mono small">{date(r.due_on)}</td>
                  <td className="num" style={{ color: 'var(--warn)' }}>{num(r.days_overdue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}

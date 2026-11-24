import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { asUser } from '@/lib/db';
import { dateTime, humanize, num } from '@/lib/format';
import { Badge, Empty, GradeBar, Meter, PageHead, Panel, Stat } from '@/components/ui';

export default async function Overview() {
  const user = await requireStaff();
  const d = await asUser(user.id, async (sql) => {
    const [totals] = await sql`
      select
        (select count(*) from intel.business_models) as models,
        (select count(*) from intel.business_models where lifecycle_status = 'backlog') as backlog,
        (select count(*) from intel.business_models where lifecycle_status in ('researching', 'in_review', 'approved', 'needs_revalidation')) as in_research,
        (select count(*) from intel.business_models where lifecycle_status = 'published') as published,
        (select count(*) from intel.sources) as sources,
        (select count(*) from intel.sources where reuse_status in ('permitted', 'permitted_with_attribution')) as sources_reusable,
        (select count(*) from intel.source_documents) as documents,
        (select count(*) from intel.evidence_claims) as claims,
        (select count(*) from intel.evidence_claims where status = 'extracted') as claims_pending,
        (select count(*) from intel.evidence_claims where not quote_verified) as claims_unverifiable,
        (select count(*) from intel.v_usable_observations) as observations,
        (select count(*) from intel.v_usable_observations where verification_status = 'verified') as observations_verified,
        (select count(*) from intel.v_usable_observations where evidence_grade = 'A') as ga,
        (select count(*) from intel.v_usable_observations where evidence_grade = 'B') as gb,
        (select count(*) from intel.v_usable_observations where evidence_grade = 'C') as gc,
        (select count(*) from intel.v_usable_observations where evidence_grade = 'D') as gd,
        (select count(*) from intel.observation_conflicts where status = 'open') as conflicts,
        (select count(*) from intel.v_freshness_queue where days_overdue > 0) as stale,
        (select count(*) from intel.research_tasks where status in ('open', 'in_progress', 'blocked')) as tasks_open,
        (select count(*) from intel.research_tasks where status in ('open', 'in_progress', 'blocked') and requires_human) as tasks_human,
        (select count(*) from intel.business_versions where status = 'submitted') as versions_pending,
        (select count(*) from gt.owner_interviews where status in ('conducted', 'transcribed', 'coded', 'reviewed')) as interviews,
        (select count(*) from intel.supplier_quotes) as quotes,
        (select coalesce(sum(cost_usd), 0) from ops.llm_usage) as llm_usd`;
    const lifecycle = await sql`select lifecycle_status, count(*) as n from intel.business_models group by 1 order by 2 desc`;
    const active = await sql`
      select m.slug, m.name, m.lifecycle_status, m.data_origin, c.completeness_pct, c.critical_missing,
             q.grade_a, q.grade_b, q.grade_c, q.grade_d, q.claims_pending_review, q.open_conflicts, q.stale_count, q.assumption_count,
             (select count(*) from intel.research_tasks t where t.business_model_id = m.id and t.status in ('open', 'in_progress', 'blocked')) as open_tasks
      from intel.business_models m
      join intel.v_business_completeness c on c.business_model_id = m.id
      join intel.v_business_evidence_quality q on q.business_model_id = m.id
      where m.lifecycle_status <> 'backlog'
      order by m.updated_at desc limit 25`;
    const taskTypes = await sql`
      select task_type, count(*) as n, min(priority) as top_priority from intel.research_tasks
      where status in ('open', 'in_progress', 'blocked') group by 1 order by 2 desc limit 12`;
    const runs = await sql`
      select r.id, r.pipeline, r.status, r.current_stage, r.attempt, r.created_at, r.finished_at, r.error, m.name as model_name, m.slug
      from ops.research_runs r left join intel.business_models m on m.id = r.business_model_id
      order by r.created_at desc limit 8`;
    const industries = await sql`
      select i.name, count(m.id) as models, count(m.id) filter (where m.lifecycle_status <> 'backlog') as started,
             count(m.id) filter (where m.is_pilot) as pilots
      from intel.industries i left join intel.business_models m on m.industry_id = i.id
      group by i.name, i.sort_order order by i.sort_order`;
    return { totals, lifecycle, active, taskTypes, runs, industries };
  });
  const t = d.totals;

  return (
    <>
      <PageHead title="Research overview"
        sub="State of the PlanB database. Completeness (how much of a record exists) and evidence quality (how good the evidence is) are always reported separately." />
      <div className="grid g6" style={{ marginBottom: 12 }}>
        <Stat label="Business models" value={num(t.models)} note={`${t.backlog} backlog · ${t.in_research} in research · ${t.published} published`} />
        <Stat label="Sources" value={num(t.sources)} note={`${t.sources_reusable} cleared for commercial reuse`} tone={t.sources_reusable < t.sources / 2 ? 'warn' : undefined} />
        <Stat label="Documents" value={num(t.documents)} note={`${num(t.claims)} claims extracted`} />
        <Stat label="Observations" value={num(t.observations)} note={`${t.observations_verified} verified by a reviewer`} />
        <Stat label="Awaiting review" value={num(t.claims_pending + t.versions_pending)} note={`${t.claims_pending} claims · ${t.versions_pending} versions`} tone={t.claims_pending + t.versions_pending > 0 ? 'warn' : 'good'} />
        <Stat label="Open tasks" value={num(t.tasks_open)} note={`${t.tasks_human} need a human`} />
      </div>
      <div className="grid g6" style={{ marginBottom: 12 }}>
        <Stat label="Stale evidence" value={num(t.stale)} note="past revalidation date" tone={t.stale > 0 ? 'warn' : 'good'} />
        <Stat label="Open conflicts" value={num(t.conflicts)} note="observations that disagree" tone={t.conflicts > 0 ? 'warn' : 'good'} />
        <Stat label="Unverifiable quotes" value={num(t.claims_unverifiable)} note="claims not found in their document" tone={t.claims_unverifiable > 0 ? 'bad' : 'good'} />
        <Stat label="Owner interviews" value={num(t.interviews)} note="PlanB Ground Truth" tone={t.interviews === 0 ? 'bad' : undefined} />
        <Stat label="Supplier quotations" value={num(t.quotes)} note="consented primary evidence" tone={t.quotes === 0 ? 'bad' : undefined} />
        <Stat label="LLM spend" value={`$${Number(t.llm_usd).toFixed(2)}`} note="all research runs" />
      </div>

      <div className="grid g2" style={{ marginBottom: 12 }}>
        <Panel title="Evidence grade of all usable observations" right={<Link href="/quality">data quality →</Link>}>
          <GradeBar a={t.ga} b={t.gb} c={t.gc} d={t.gd} />
          <p className="muted small" style={{ marginTop: 8 }}>
            A = verified primary or regulatory evidence · B = corroborated by independent sources · C = single source, older benchmark or self-reported · D = estimate or assumption.
            A grade belongs to each number, never to a whole business.
          </p>
        </Panel>
        <Panel title="Lifecycle">
          <div className="row">
            {d.lifecycle.map((l) => (
              <span key={l.lifecycle_status} className="row"><Badge value={l.lifecycle_status} /><span className="mono">{l.n}</span></span>
            ))}
          </div>
        </Panel>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Panel title="Records in research" right={<Link href="/catalogue">full catalogue →</Link>} flush>
          <table>
            <thead><tr>
              <th>Business model</th><th>Status</th><th style={{ width: 150 }}>Completeness</th><th className="num">Critical gaps</th>
              <th style={{ width: 190 }}>Evidence grades A/B/C/D</th><th className="num">Assumptions</th><th className="num">To review</th>
              <th className="num">Conflicts</th><th className="num">Stale</th><th className="num">Tasks</th>
            </tr></thead>
            <tbody>
              {d.active.length === 0 ? <Empty cols={10}>No record has entered research yet. Ingest a source document from a business record.</Empty> : null}
              {d.active.map((m) => (
                <tr key={m.slug}>
                  <td><Link href={`/business/${m.slug}`}>{m.name}</Link> {m.data_origin !== 'research' ? <span className="badge demo">{m.data_origin}</span> : null}</td>
                  <td><Badge value={m.lifecycle_status} /></td>
                  <td><Meter pct={m.completeness_pct} /></td>
                  <td className="num" style={{ color: m.critical_missing ? 'var(--bad)' : undefined }}>{m.critical_missing}</td>
                  <td><GradeBar a={m.grade_a} b={m.grade_b} c={m.grade_c} d={m.grade_d} /></td>
                  <td className="num">{m.assumption_count}</td>
                  <td className="num" style={{ color: m.claims_pending_review ? 'var(--warn)' : undefined }}>{m.claims_pending_review}</td>
                  <td className="num">{m.open_conflicts}</td>
                  <td className="num" style={{ color: m.stale_count ? 'var(--warn)' : undefined }}>{m.stale_count}</td>
                  <td className="num">{m.open_tasks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div className="grid g3">
        <Panel title="Open research tasks by type" right={<Link href="/tasks">all tasks →</Link>} flush>
          <table>
            <thead><tr><th>Type</th><th className="num">Open</th><th className="num">Top priority</th></tr></thead>
            <tbody>
              {d.taskTypes.length === 0 ? <Empty cols={3}>No open tasks.</Empty> : null}
              {d.taskTypes.map((r) => (
                <tr key={r.task_type}><td><Link href={`/tasks?type=${r.task_type}`}>{humanize(r.task_type)}</Link></td><td className="num">{r.n}</td><td className="num">P{r.top_priority}</td></tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Recent research runs" right={<Link href="/runs">job queue →</Link>} flush>
          <table>
            <thead><tr><th>Pipeline</th><th>Business</th><th>Status</th><th>Started</th></tr></thead>
            <tbody>
              {d.runs.length === 0 ? <Empty cols={4}>No runs yet.</Empty> : null}
              {d.runs.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/runs/${r.id}`}>{humanize(r.pipeline)}</Link></td>
                  <td>{r.slug ? <Link href={`/business/${r.slug}`}>{r.model_name}</Link> : <span className="faint">—</span>}</td>
                  <td><Badge value={r.status} title={r.error ?? undefined} /></td>
                  <td className="mono small">{dateTime(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Backlog coverage by industry" flush>
          <table>
            <thead><tr><th>Industry</th><th className="num">Models</th><th className="num">Pilot</th><th className="num">Started</th></tr></thead>
            <tbody>
              {d.industries.map((r) => (
                <tr key={r.name}><td>{r.name}</td><td className="num">{r.models}</td><td className="num">{r.pilots || ''}</td><td className="num">{r.started || ''}</td></tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
      <p className="faint small" style={{ marginTop: 14 }}>
        Figures shown anywhere in this platform are research records with their own evidence grade. Nothing here is a forecast or a promise of profitability.
      </p>
    </>
  );
}

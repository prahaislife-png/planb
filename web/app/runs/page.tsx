import Link from 'next/link';
import { can, requireStaff } from '@/lib/auth';
import { asUser } from '@/lib/db';
import { dateTime, humanize, num } from '@/lib/format';
import { Badge, Empty, Flash, OriginBadge, PageHead, Panel, Stat } from '@/components/ui';
import { cancelRun } from '@/app/actions/runs';

type Search = { status?: string; pipeline?: string; ok?: string; error?: string };

const STATUSES = ['queued', 'running', 'waiting_retry', 'succeeded', 'failed', 'cancelled', 'budget_exhausted'] as const;
const PIPELINES = ['document_research', 'business_refresh', 'freshness_scan', 'catalog_sync'] as const;
const LIMIT = 200;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const usd = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `$${Number(v).toFixed(Number(v) > 0 && Number(v) < 1 ? 4 : 2)}`);

function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}

export default async function Runs({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(str(sp.status)) ? str(sp.status) : null;
  const pipeline = (PIPELINES as readonly string[]).includes(str(sp.pipeline)) ? str(sp.pipeline) : null;

  const { totals, runs } = await asUser(user.id, async (sql) => {
    const [totals] = await sql`
      select count(*) as total,
             count(*) filter (where status = 'queued') as queued,
             count(*) filter (where status = 'running') as running,
             count(*) filter (where status = 'running' and locked_until < now()) as lost,
             count(*) filter (where status = 'waiting_retry') as waiting_retry,
             count(*) filter (where status = 'succeeded') as succeeded,
             count(*) filter (where status = 'failed') as failed,
             count(*) filter (where status = 'cancelled') as cancelled,
             count(*) filter (where status = 'budget_exhausted') as budget_exhausted
      from ops.research_runs`;
    const runs = await sql`
      select r.id, r.pipeline, r.status, r.current_stage, r.attempt, r.max_attempts, r.next_attempt_at, r.locked_by, r.locked_until,
             r.heartbeat_at, r.budget_usd, r.spent_usd, r.error, r.data_origin, r.created_at, r.started_at, r.finished_at,
             (r.status = 'running' and r.locked_until < now()) as lease_expired,
             extract(epoch from (coalesce(r.finished_at, case when r.status = 'running' then now() end) - r.started_at))::float8 as duration_s,
             m.slug, m.name as model_name, d.title as document_title
      from ops.research_runs r
      left join intel.business_models m on m.id = r.business_model_id
      left join intel.source_documents d on d.id = r.source_document_id
      where (${status}::text is null or r.status = ${status})
        and (${pipeline}::text is null or r.pipeline = ${pipeline})
      order by r.created_at desc, r.id
      limit ${LIMIT}`;
    return { totals, runs };
  });

  const operator = can(user, 'admin', 'researcher');
  const query = new URLSearchParams();
  if (status) query.set('status', status);
  if (pipeline) query.set('pipeline', pipeline);
  const back = `/runs${query.size ? `?${query.toString()}` : ''}`;

  return (
    <>
      <PageHead title="Research job queue"
        sub="Durable multi-stage research runs. Each run is leased by one worker at a time and records every stage, so it can be inspected and resumed." />
      <Flash params={sp} />
      <div className="notice">
        Runs execute only while a research worker is running (<span className="mono">planb worker</span>); a queued run simply waits until one picks it up.
        After a failure a run waits, is retried up to its attempt limit and resumes from its first unfinished stage — stages that already succeeded are never re-executed.
        A <span className="mono">running</span> run whose lease has expired has lost its worker and is handed to the next one.
        {totals.cancelled > 0 ? <> {num(totals.cancelled)} cancelled {totals.cancelled === 1 ? 'run is' : 'runs are'} not counted in the figures below.</> : null}
      </div>
      <div className="grid g6" style={{ marginBottom: 12 }}>
        <Stat label="Queued" value={num(totals.queued)} note="waiting for a worker" tone={totals.queued > 0 ? 'warn' : undefined} />
        <Stat label="Running" value={num(totals.running)} note={totals.lost > 0 ? `${totals.lost} with an expired lease` : 'leased by a worker'} tone={totals.lost > 0 ? 'bad' : undefined} />
        <Stat label="Waiting retry" value={num(totals.waiting_retry)} note="failed, will be retried" tone={totals.waiting_retry > 0 ? 'warn' : undefined} />
        <Stat label="Succeeded" value={num(totals.succeeded)} note={`of ${num(totals.total)} runs`} tone={totals.succeeded > 0 ? 'good' : undefined} />
        <Stat label="Failed" value={num(totals.failed)} note="attempt limit reached" tone={totals.failed > 0 ? 'bad' : undefined} />
        <Stat label="Budget exhausted" value={num(totals.budget_exhausted)} note="stopped at the spend limit" tone={totals.budget_exhausted > 0 ? 'warn' : undefined} />
      </div>

      <form method="get" className="row" style={{ marginBottom: 10 }}>
        <select name="status" defaultValue={status ?? ''} style={{ width: 180 }} aria-label="Status">
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
        <select name="pipeline" defaultValue={pipeline ?? ''} style={{ width: 200 }} aria-label="Pipeline">
          <option value="">Any pipeline</option>
          {PIPELINES.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
        </select>
        <button type="submit">Filter</button>
        <Link href="/runs" className="small">reset</Link>
        <span className="muted small">{runs.length === LIMIT ? `latest ${LIMIT} runs` : `${runs.length} runs`}</span>
      </form>

      <Panel title="Runs, newest first" flush>
        <table>
          <thead><tr>
            <th>Pipeline</th><th>Business model</th><th>Document</th><th>Status</th><th>Current stage</th>
            <th className="num" title="Attempts used / attempts allowed">Attempt</th><th>Lease</th>
            <th className="num" title="LLM spend recorded against the run / execution budget">Spent / budget</th>
            <th>Created</th><th>Started</th><th>Finished</th><th className="num">Duration</th><th />
          </tr></thead>
          <tbody>
            {runs.length === 0 ? (
              <Empty cols={13}>{status || pipeline
                ? 'No run matches these filters.'
                : 'No research run has been queued yet. Upload a source document or queue a refresh from a business record.'}</Empty>
            ) : null}
            {runs.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/runs/${r.id}`}>{humanize(r.pipeline)}</Link> <OriginBadge origin={r.data_origin} /></td>
                <td>{r.slug ? <Link href={`/business/${r.slug}`}>{r.model_name}</Link> : <span className="faint">—</span>}</td>
                <td className="small" style={{ maxWidth: 260 }}>{r.document_title ?? <span className="faint">—</span>}</td>
                <td style={{ maxWidth: 260 }}>
                  <Badge value={r.status} title={r.error ?? undefined} />
                  {r.error && (r.status === 'failed' || r.status === 'waiting_retry' || r.status === 'budget_exhausted') ? (
                    <div className="small" style={{ color: 'var(--bad)' }} title={r.error}>{r.error.length > 110 ? `${r.error.slice(0, 110)}…` : r.error}</div>
                  ) : null}
                  {r.status === 'waiting_retry' ? <div className="faint small">next attempt {dateTime(r.next_attempt_at)}</div> : null}
                </td>
                <td className="mono small">{r.current_stage ?? <span className="faint">—</span>}</td>
                <td className="num">{r.attempt}/{r.max_attempts}</td>
                <td className="small">
                  {r.locked_by ? (
                    <>
                      <span className="mono">{r.locked_by}</span>
                      <div className="faint">until {dateTime(r.locked_until)}</div>
                      {r.lease_expired ? <Badge value="worker lost — will be reclaimed" tone="bad" title="The lease expired while the run was still marked running; the next worker will claim and resume it." /> : null}
                    </>
                  ) : r.lease_expired ? <Badge value="worker lost — will be reclaimed" tone="bad" /> : <span className="faint">—</span>}
                </td>
                <td className="num" style={r.status === 'budget_exhausted' ? { color: 'var(--warn)' } : undefined}>
                  {usd(r.spent_usd)} / {r.budget_usd === null ? <span className="faint" title="No budget set for this run">no budget</span> : usd(r.budget_usd)}
                </td>
                <td className="mono small">{dateTime(r.created_at)}</td>
                <td className="mono small">{dateTime(r.started_at)}</td>
                <td className="mono small">{dateTime(r.finished_at)}</td>
                <td className="num">{duration(r.duration_s)}</td>
                <td>
                  {r.status === 'queued' || r.status === 'waiting_retry' ? (
                    <form action={cancelRun} className="inline">
                      <input type="hidden" name="run_id" value={r.id} /><input type="hidden" name="back" value={back} />
                      <button type="submit" className="bad" disabled={!operator} title={operator ? 'Stop this run before a worker picks it up' : 'Only an admin or researcher can cancel a run'}>Cancel</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can, requireStaff } from '@/lib/auth';
import { asUser } from '@/lib/db';
import { dateTime, humanize, num } from '@/lib/format';
import { Badge, Empty, Flash, OriginBadge, PageHead, Panel } from '@/components/ui';
import { cancelRun } from '@/app/actions/runs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOG_LIMIT = 1000;
const LEVEL_TONE: Record<string, 'good' | 'warn' | 'bad' | 'info' | undefined> = { debug: undefined, info: 'info', warning: 'warn', error: 'bad' };

const usd = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `$${Number(v).toFixed(Number(v) > 0 && Number(v) < 1 ? 4 : 2)}`);
const pretty = (v: unknown): string => JSON.stringify(v, null, 2);
const isEmptyJson = (v: unknown): boolean => v === null || v === undefined || (typeof v === 'object' && Object.keys(v as object).length === 0);

function ms(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(2)} s`;
}

function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}

export default async function RunDetail({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const user = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID.test(id)) notFound();

  const d = await asUser(user.id, async (sql) => {
    const [run] = await sql`
      select r.*, (r.status = 'running' and r.locked_until < now()) as lease_expired,
             extract(epoch from (coalesce(r.finished_at, case when r.status = 'running' then now() end) - r.started_at))::float8 as duration_s,
             m.slug, m.name as model_name, doc.title as document_title, doc.sha256 as document_sha256, s.slug as source_slug, s.name as source_name,
             st.display_name as requested_by_name
      from ops.research_runs r
      left join intel.business_models m on m.id = r.business_model_id
      left join intel.source_documents doc on doc.id = r.source_document_id
      left join intel.sources s on s.id = doc.source_id
      left join ops.staff_members st on st.user_id = r.requested_by
      where r.id = ${id}`;
    if (!run) return null;
    const steps = await sql`select * from ops.research_run_steps where run_id = ${id} order by sequence_no, stage`;
    const logs = await sql`select id, logged_at, level, stage, message, data from ops.research_run_logs where run_id = ${id} order by id limit ${LOG_LIMIT}`;
    const [logCount] = await sql`select count(*) as n from ops.research_run_logs where run_id = ${id}`;
    const usage = await sql`
      select id, occurred_at, stage, provider, model, purpose, input_tokens, output_tokens, cache_read_tokens, cost_usd
      from ops.llm_usage where run_id = ${id} order by id limit 500`;
    const ingestion = await sql`
      select l.id, l.occurred_at, l.adapter_key, l.url, l.action, l.outcome, l.http_status, l.byte_size, l.sha256, l.duration_ms, l.attempt, l.detail,
             s.slug as source_slug, s.name as source_name
      from ops.ingestion_log l left join intel.sources s on s.id = l.source_id
      where l.research_run_id = ${id} order by l.id limit 500`;
    return { run, steps, logs, logTotal: Number(logCount.n), usage, ingestion };
  });
  if (!d) notFound();
  const { run, steps, logs, usage, ingestion } = d;
  const cancellable = run.status === 'queued' || run.status === 'waiting_retry';
  const operator = can(user, 'admin', 'researcher');
  const usageTotal = usage.reduce((sum, u) => sum + Number(u.cost_usd), 0);

  return (
    <>
      <PageHead
        title={<span className="row">{humanize(run.pipeline)} run <Badge value={run.status} /><OriginBadge origin={run.data_origin} /></span>}
        sub={<><Link href="/runs">Job queue</Link> · <span className="mono">{run.id}</span></>}
        right={cancellable ? (
          <form action={cancelRun} className="inline">
            <input type="hidden" name="run_id" value={run.id} /><input type="hidden" name="back" value={`/runs/${run.id}`} />
            <button type="submit" className="bad" disabled={!operator} title={operator ? 'Stop this run before a worker picks it up' : 'Only an admin or researcher can cancel a run'}>Cancel run</button>
          </form>
        ) : undefined} />
      <Flash params={sp} />
      {run.lease_expired ? (
        <div className="notice bad"><b>Worker lost — will be reclaimed.</b> The lease held by <span className="mono">{run.locked_by ?? 'an unknown worker'}</span> expired
          at {dateTime(run.locked_until)} while the run was still marked running. The next worker will claim it and resume from the first unfinished stage.</div>
      ) : null}
      {run.status === 'queued' ? <div className="notice">Queued. This run starts when a research worker (<span className="mono">planb worker</span>) is running and picks it up.</div> : null}
      {run.error ? (
        <div className="notice bad"><b>{run.status === 'waiting_retry' ? 'Last error (will be retried)' : 'Error'}</b>
          <div className="quote" style={{ marginTop: 6 }}>{run.error}</div></div>
      ) : null}

      <div className="grid g2" style={{ marginBottom: 12 }}>
        <Panel title="Run">
          <dl className="kv" style={{ margin: 0 }}>
            <dt>Pipeline</dt><dd className="mono">{run.pipeline}</dd>
            <dt>Business model</dt><dd>{run.slug ? <Link href={`/business/${run.slug}`}>{run.model_name}</Link> : <span className="faint">—</span>}</dd>
            <dt>Document</dt>
            <dd>{run.document_title ?? <span className="faint">—</span>}
              {run.source_slug ? <div className="small muted">from <Link href={`/sources/${run.source_slug}`}>{run.source_name}</Link></div> : null}
              {run.document_sha256 ? <div className="mono small faint" title="SHA-256 of the stored document">{run.document_sha256.slice(0, 16)}…</div> : null}</dd>
            <dt>Current stage</dt><dd className="mono">{run.current_stage ?? <span className="faint">—</span>}</dd>
            <dt>Attempt</dt><dd className="mono">{run.attempt} of {run.max_attempts}</dd>
            <dt>Requested by</dt><dd>{run.requested_by_name ?? (run.requested_by ? <span className="mono small">{run.requested_by}</span> : <span className="faint" title="Not enqueued by a signed-in staff member (worker or command line)">— (not a staff request)</span>)}</dd>
            <dt>Idempotency key</dt><dd className="mono small" style={{ wordBreak: 'break-all' }}>{run.idempotency_key ?? <span className="faint">—</span>}</dd>
          </dl>
        </Panel>
        <Panel title="Execution">
          <dl className="kv" style={{ margin: 0 }}>
            <dt>Created</dt><dd className="mono">{dateTime(run.created_at)}</dd>
            <dt>Started</dt><dd className="mono">{dateTime(run.started_at)}</dd>
            <dt>Finished</dt><dd className="mono">{dateTime(run.finished_at)}</dd>
            <dt>Duration</dt><dd className="mono">{duration(run.duration_s)}{run.status === 'running' ? <span className="faint"> so far</span> : null}</dd>
            {run.status === 'waiting_retry' || run.status === 'queued' ? <><dt>Next attempt at</dt><dd className="mono">{dateTime(run.next_attempt_at)}</dd></> : null}
            <dt>Lease</dt>
            <dd>{run.locked_by ? <><span className="mono">{run.locked_by}</span> <span className="muted">until</span> <span className="mono">{dateTime(run.locked_until)}</span></> : <span className="faint">— (not leased)</span>}</dd>
            <dt>Last heartbeat</dt><dd className="mono">{dateTime(run.heartbeat_at)}</dd>
            <dt>Spent / budget (USD)</dt>
            <dd className="mono" style={run.status === 'budget_exhausted' ? { color: 'var(--warn)' } : undefined}>
              {usd(run.spent_usd)} / {run.budget_usd === null ? <span className="faint">no budget</span> : usd(run.budget_usd)}</dd>
            <dt>Tokens spent / budget</dt>
            <dd className="mono">{num(run.spent_tokens)} / {run.budget_tokens === null ? <span className="faint">no budget</span> : num(run.budget_tokens)}</dd>
          </dl>
        </Panel>
      </div>

      <div className="grid g2" style={{ marginBottom: 12 }}>
        <Panel title="Parameters">
          {isEmptyJson(run.params) ? <span className="faint">This run was queued without parameters.</span> : <pre className="pagetext" style={{ margin: 0, maxHeight: 280 }}>{pretty(run.params)}</pre>}
        </Panel>
        <Panel title="Result">
          {isEmptyJson(run.result)
            ? <span className="faint">{run.status === 'succeeded' ? 'The run recorded no result.' : 'No result yet — a result is written when the run finishes.'}</span>
            : <pre className="pagetext" style={{ margin: 0, maxHeight: 280 }}>{pretty(run.result)}</pre>}
        </Panel>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Panel title={`Stages (${steps.length})`} flush>
          <table>
            <thead><tr>
              <th className="num">#</th><th>Stage</th><th>Status</th><th className="num">Attempt</th><th>Started</th><th className="num">Duration</th>
              <th>Error</th><th style={{ width: '40%' }}>Output</th>
            </tr></thead>
            <tbody>
              {steps.length === 0 ? <Empty cols={8}>No stage has been recorded. Stages are written when a worker starts executing the run.</Empty> : null}
              {steps.map((s) => (
                <tr key={s.stage}>
                  <td className="num">{s.sequence_no}</td>
                  <td className="mono">{s.stage}</td>
                  <td><Badge value={s.status} /></td>
                  <td className="num">{s.attempt}</td>
                  <td className="mono small">{dateTime(s.started_at)}</td>
                  <td className="num">{ms(s.duration_ms)}</td>
                  <td className="small wrap" style={{ color: s.error ? 'var(--bad)' : undefined, maxWidth: 320 }}>{s.error ?? <span className="faint">—</span>}</td>
                  <td>
                    {isEmptyJson(s.output) ? <span className="faint">—</span> : (
                      <details>
                        <summary>output ({Object.keys(s.output).length} {Object.keys(s.output).length === 1 ? 'key' : 'keys'})</summary>
                        <pre className="quote" style={{ margin: 0 }}>{pretty(s.output)}</pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Panel title={`Log (${d.logTotal > logs.length ? `first ${logs.length} of ${d.logTotal}` : logs.length} lines)`} flush>
          <table>
            <thead><tr><th>Time</th><th>Level</th><th>Stage</th><th style={{ width: '65%' }}>Message</th></tr></thead>
            <tbody>
              {logs.length === 0 ? <Empty cols={4}>No log lines. A worker writes the log while it executes the run.</Empty> : null}
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="mono small nowrap">{new Date(l.logged_at).toISOString().slice(0, 23).replace('T', ' ')}Z</td>
                  <td><Badge value={l.level} tone={LEVEL_TONE[l.level]} /></td>
                  <td className="mono small">{l.stage ?? <span className="faint">—</span>}</td>
                  <td>
                    <span className="wrap">{l.message}</span>
                    {isEmptyJson(l.data) ? null : (
                      <details style={{ marginTop: 2 }}>
                        <summary>data</summary>
                        <pre className="quote" style={{ margin: 0 }}>{pretty(l.data)}</pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div className="grid">
        <Panel title={`LLM usage (${usage.length} calls${usage.length ? ` · ${usd(usageTotal)}` : ''})`} right={<Link href="/costs">research costs →</Link>} flush>
          <table>
            <thead><tr><th>Time</th><th>Stage</th><th>Model</th><th>Purpose</th><th className="num">In</th><th className="num">Out</th><th className="num">Cache read</th><th className="num">Cost</th></tr></thead>
            <tbody>
              {usage.length === 0 ? <Empty cols={8}>No LLM call was recorded for this run. Rule-based extraction makes none; LLM extraction needs an API key.</Empty> : null}
              {usage.map((u) => (
                <tr key={u.id}>
                  <td className="mono small">{dateTime(u.occurred_at)}</td>
                  <td className="mono small">{u.stage ?? <span className="faint">—</span>}</td>
                  <td className="mono small">{u.provider}/{u.model}</td>
                  <td className="small">{humanize(u.purpose)}</td>
                  <td className="num">{num(u.input_tokens)}</td>
                  <td className="num">{num(u.output_tokens)}</td>
                  <td className="num">{num(u.cache_read_tokens)}</td>
                  <td className="num">{usd(u.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title={`Ingestion log (${ingestion.length})`} flush>
          <table>
            <thead><tr><th>Time</th><th>Source</th><th>Adapter</th><th>Action</th><th>Outcome</th><th className="num">HTTP</th><th className="num">Bytes</th><th>Detail</th></tr></thead>
            <tbody>
              {ingestion.length === 0 ? <Empty cols={8}>This run fetched or stored no document, so it has no ingestion log rows.</Empty> : null}
              {ingestion.map((l) => (
                <tr key={l.id}>
                  <td className="mono small">{dateTime(l.occurred_at)}</td>
                  <td className="small">{l.source_slug ? <Link href={`/sources/${l.source_slug}`}>{l.source_name}</Link> : <span className="faint">—</span>}</td>
                  <td className="mono small">{l.adapter_key ?? <span className="faint">—</span>}</td>
                  <td className="mono small">{l.action}</td>
                  <td><Badge value={l.outcome} tone={l.outcome === 'ok' ? 'good' : l.outcome === 'skipped' ? undefined : l.outcome === 'blocked' ? 'warn' : 'bad'} /></td>
                  <td className="num">{l.http_status ?? <span className="faint">—</span>}</td>
                  <td className="num">{num(l.byte_size)}</td>
                  <td className="small" style={{ maxWidth: 420 }}>
                    {l.detail ? <span className="wrap">{l.detail}</span> : null}
                    {l.url ? <div className="mono faint" style={{ wordBreak: 'break-all' }}>{l.url}</div> : null}
                    {l.sha256 ? <div className="mono faint" title={l.sha256}>sha256 {l.sha256.slice(0, 12)}…</div> : null}
                    {!l.detail && !l.url && !l.sha256 ? <span className="faint">—</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}

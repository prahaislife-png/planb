import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { asUser } from '@/lib/db';
import { dateTime, humanize, num } from '@/lib/format';
import { Badge, Empty, PageHead, Panel, Stat } from '@/components/ui';

const usd = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `$${Number(v).toFixed(Number(v) > 0 && Number(v) < 1 ? 4 : 2)}`);

/** Small inline bar: this value as a share of the largest value in its table. */
function Bar({ value, max }: { value: number; max: number }) {
  return <div className="meter"><i style={{ width: `${max > 0 ? Math.max(1, (value / max) * 100) : 0}%` }} /></div>;
}

export default async function Costs() {
  const user = await requireStaff();
  const d = await asUser(user.id, async (sql) => {
    const [totals] = await sql`
      select count(*) as calls, sum(cost_usd) as usd,
             sum(cost_usd) filter (where occurred_at >= now() - interval '7 days') as usd_7d,
             sum(cost_usd) filter (where occurred_at >= now() - interval '30 days') as usd_30d,
             count(*) filter (where occurred_at >= now() - interval '7 days') as calls_7d,
             count(*) filter (where occurred_at >= now() - interval '30 days') as calls_30d,
             sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens, sum(cache_read_tokens) as cache_read_tokens,
             min(occurred_at) as first_at, max(occurred_at) as last_at
      from ops.llm_usage`;
    const byModel = await sql`
      select provider, model, count(*) as calls, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
             sum(cache_read_tokens) as cache_read_tokens, sum(cost_usd) as usd
      from ops.llm_usage group by 1, 2 order by sum(cost_usd) desc, 1, 2`;
    const byPurpose = await sql`
      select purpose, count(*) as calls, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens, sum(cost_usd) as usd
      from ops.llm_usage group by 1 order by sum(cost_usd) desc, 1`;
    const byDay = await sql`
      select (occurred_at at time zone 'UTC')::date as day, count(*) as calls, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
             sum(cost_usd) as usd
      from ops.llm_usage where occurred_at >= now() - interval '30 days' group by 1 order by 1 desc`;
    const byBusiness = await sql`
      select m.slug, m.name, count(*) as calls, count(distinct u.run_id) as runs, sum(u.input_tokens) as input_tokens,
             sum(u.output_tokens) as output_tokens, sum(u.cost_usd) as usd
      from ops.llm_usage u left join intel.business_models m on m.id = u.business_model_id
      group by m.slug, m.name order by sum(u.cost_usd) desc limit 50`;
    const [runTotals] = await sql`
      select count(*) as runs, count(*) filter (where spent_usd > 0) as runs_with_spend,
             count(*) filter (where status = 'budget_exhausted') as budget_exhausted,
             count(*) filter (where budget_usd is not null) as runs_with_budget,
             sum(budget_usd) as budget_usd, sum(spent_usd) as spent_usd
      from ops.research_runs`;
    const topRuns = await sql`
      select r.id, r.pipeline, r.status, r.budget_usd, r.spent_usd, r.spent_tokens, r.budget_tokens, r.created_at, m.slug, m.name as model_name
      from ops.research_runs r left join intel.business_models m on m.id = r.business_model_id
      where r.spent_usd > 0 or r.status = 'budget_exhausted'
      order by r.spent_usd desc, r.created_at desc limit 25`;
    const extraction = await sql`
      select extraction_method, count(*) as claims, count(distinct source_document_id) as documents
      from intel.evidence_claims group by 1 order by 2 desc`;
    return { totals, byModel, byPurpose, byDay, byBusiness, runTotals, topRuns, extraction };
  });

  const t = d.totals;
  const hasUsage = Number(t.calls) > 0;
  const rt = d.runTotals;
  const maxDay = Math.max(0, ...d.byDay.map((r) => Number(r.usd)));
  const maxModel = Math.max(0, ...d.byModel.map((r) => Number(r.usd)));
  const maxPurpose = Math.max(0, ...d.byPurpose.map((r) => Number(r.usd)));
  const ruleBased = d.extraction.find((r) => r.extraction_method === 'rule_based');
  const noUsage = 'No LLM call has been recorded.';

  return (
    <>
      <PageHead title="Research costs"
        sub="LLM spend recorded by research workers, call by call (ops.llm_usage), and the execution budget of each run. A run stops with status budget exhausted rather than continue past its budget." />
      {!hasUsage ? (
        <div className="notice">
          <b>No LLM usage has been recorded yet, so there is nothing to measure.</b> The dashes below mean &ldquo;not measured&rdquo;, not zero spend on LLM work.
          Rule-based extraction costs nothing and makes no LLM call
          {ruleBased ? <> — the {num(ruleBased.claims)} claims extracted so far from {num(ruleBased.documents)} {Number(ruleBased.documents) === 1 ? 'document' : 'documents'} were all produced that way</> : null}.
          LLM extraction needs an API key configured for the research worker; once it runs, every call appears here with its tokens and cost.
        </div>
      ) : null}
      <div className="grid g6" style={{ marginBottom: 12 }}>
        <Stat label="Total spend" value={hasUsage ? usd(t.usd) : '—'} note={hasUsage ? `${num(t.calls)} calls since ${dateTime(t.first_at)}` : 'no LLM calls recorded'} />
        <Stat label="Last 7 days" value={hasUsage ? usd(t.usd_7d ?? 0) : '—'} note={hasUsage ? `${num(t.calls_7d)} calls` : 'no LLM calls recorded'} />
        <Stat label="Last 30 days" value={hasUsage ? usd(t.usd_30d ?? 0) : '—'} note={hasUsage ? `${num(t.calls_30d)} calls` : 'no LLM calls recorded'} />
        <Stat label="Input tokens" value={hasUsage ? num(t.input_tokens) : '—'} note="sent to models" />
        <Stat label="Output tokens" value={hasUsage ? num(t.output_tokens) : '—'} note="generated by models" />
        <Stat label="Cache-read tokens" value={hasUsage ? num(t.cache_read_tokens) : '—'} note="input served from prompt cache" />
      </div>

      <div className="grid g2" style={{ marginBottom: 12 }}>
        <Panel title="Spend by model" flush>
          <table>
            <thead><tr><th>Provider / model</th><th className="num">Calls</th><th className="num">Input</th><th className="num">Output</th><th className="num">Cache read</th><th className="num">Spend</th><th style={{ width: 110 }} /></tr></thead>
            <tbody>
              {d.byModel.length === 0 ? <Empty cols={7}>{noUsage}</Empty> : null}
              {d.byModel.map((r) => (
                <tr key={`${r.provider}/${r.model}`}>
                  <td className="mono small">{r.provider}/{r.model}</td><td className="num">{num(r.calls)}</td><td className="num">{num(r.input_tokens)}</td>
                  <td className="num">{num(r.output_tokens)}</td><td className="num">{num(r.cache_read_tokens)}</td><td className="num">{usd(r.usd)}</td>
                  <td><Bar value={Number(r.usd)} max={maxModel} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Spend by purpose" flush>
          <table>
            <thead><tr><th>Purpose</th><th className="num">Calls</th><th className="num">Input</th><th className="num">Output</th><th className="num">Spend</th><th style={{ width: 110 }} /></tr></thead>
            <tbody>
              {d.byPurpose.length === 0 ? <Empty cols={6}>{noUsage}</Empty> : null}
              {d.byPurpose.map((r) => (
                <tr key={r.purpose}>
                  <td>{humanize(r.purpose)}</td><td className="num">{num(r.calls)}</td><td className="num">{num(r.input_tokens)}</td>
                  <td className="num">{num(r.output_tokens)}</td><td className="num">{usd(r.usd)}</td>
                  <td><Bar value={Number(r.usd)} max={maxPurpose} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div className="grid g2" style={{ marginBottom: 12 }}>
        <Panel title="Spend by day · last 30 days (UTC)" flush>
          <table>
            <thead><tr><th>Day</th><th className="num">Calls</th><th className="num">Input</th><th className="num">Output</th><th className="num">Spend</th><th style={{ width: '35%' }} /></tr></thead>
            <tbody>
              {d.byDay.length === 0 ? <Empty cols={6}>{hasUsage ? 'No LLM call was recorded in the last 30 days.' : noUsage}</Empty> : null}
              {d.byDay.map((r) => (
                <tr key={r.day}>
                  <td className="mono small">{r.day}</td><td className="num">{num(r.calls)}</td><td className="num">{num(r.input_tokens)}</td>
                  <td className="num">{num(r.output_tokens)}</td><td className="num">{usd(r.usd)}</td>
                  <td><Bar value={Number(r.usd)} max={maxDay} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.byDay.length > 0 ? <p className="faint small" style={{ padding: '6px 9px', margin: 0 }}>Only days with at least one call are listed. Bars are relative to the most expensive day shown.</p> : null}
        </Panel>
        <Panel title="Spend by business model" flush>
          <table>
            <thead><tr><th>Business model</th><th className="num">Runs</th><th className="num">Calls</th><th className="num">Input</th><th className="num">Output</th><th className="num">Spend</th></tr></thead>
            <tbody>
              {d.byBusiness.length === 0 ? <Empty cols={6}>{noUsage}</Empty> : null}
              {d.byBusiness.map((r) => (
                <tr key={r.slug ?? '-'}>
                  <td>{r.slug ? <Link href={`/business/${r.slug}`}>{r.name}</Link> : <span className="muted">Not tied to a business model</span>}</td>
                  <td className="num">{num(r.runs)}</td><td className="num">{num(r.calls)}</td><td className="num">{num(r.input_tokens)}</td>
                  <td className="num">{num(r.output_tokens)}</td><td className="num">{usd(r.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <div className="grid g2">
        <Panel title="Top runs by spend" right={<Link href="/runs">job queue →</Link>} flush>
          <table>
            <thead><tr><th>Run</th><th>Business model</th><th>Status</th><th className="num">Spent</th><th className="num">Budget</th><th className="num" title="Spend as a share of the run's budget">Used</th><th>Created</th></tr></thead>
            <tbody>
              {d.topRuns.length === 0 ? (
                <Empty cols={7}>{Number(rt.runs) === 0
                  ? 'No research run exists yet.'
                  : `None of the ${num(rt.runs)} research runs has recorded any LLM spend, and none stopped on its budget.`}</Empty>
              ) : null}
              {d.topRuns.map((r) => {
                const exhausted = r.status === 'budget_exhausted';
                const used = r.budget_usd ? (100 * Number(r.spent_usd)) / Number(r.budget_usd) : null;
                return (
                  <tr key={r.id} style={exhausted ? { background: '#211808' } : undefined}>
                    <td><Link href={`/runs/${r.id}`}>{humanize(r.pipeline)}</Link> <span className="mono small faint">{String(r.id).slice(0, 8)}</span></td>
                    <td>{r.slug ? <Link href={`/business/${r.slug}`}>{r.model_name}</Link> : <span className="faint">—</span>}</td>
                    <td><Badge value={r.status} /></td>
                    <td className="num" style={exhausted ? { color: 'var(--warn)' } : undefined}>{usd(r.spent_usd)}</td>
                    <td className="num">{r.budget_usd === null ? <span className="faint">no budget</span> : usd(r.budget_usd)}</td>
                    <td className="num">{used === null ? <span className="faint">—</span> : `${used.toFixed(0)}%`}</td>
                    <td className="mono small">{dateTime(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
        <Panel title="Run budgets and extraction methods">
          <dl className="kv" style={{ margin: 0 }}>
            <dt>Research runs</dt><dd className="mono">{num(rt.runs)}</dd>
            <dt>Runs with a budget</dt><dd className="mono">{num(rt.runs_with_budget)}{Number(rt.runs_with_budget) > 0 ? <span className="muted"> · {usd(rt.budget_usd)} budgeted in total</span> : null}</dd>
            <dt>Runs with LLM spend</dt><dd className="mono">{num(rt.runs_with_spend)}{Number(rt.runs_with_spend) > 0 ? <span className="muted"> · {usd(rt.spent_usd)} recorded against runs</span> : null}</dd>
            <dt>Budget exhausted</dt><dd className="mono" style={Number(rt.budget_exhausted) > 0 ? { color: 'var(--warn)' } : undefined}>{num(rt.budget_exhausted)}</dd>
            <dt>Claims by extraction</dt>
            <dd>
              {d.extraction.length === 0 ? <span className="faint">No claim has been extracted yet.</span> : d.extraction.map((r) => (
                <div key={r.extraction_method}><span className="mono">{num(r.claims)}</span> {humanize(r.extraction_method).toLowerCase()}
                  <span className="faint"> · {num(r.documents)} {Number(r.documents) === 1 ? 'document' : 'documents'}{r.extraction_method === 'rule_based' || r.extraction_method === 'manual' ? ' · no LLM cost' : ''}</span></div>
              ))}
            </dd>
          </dl>
          <p className="faint small" style={{ marginTop: 10, marginBottom: 0 }}>
            Costs are computed by the worker from the tokens each provider reports. They are operating costs of research, not a figure about any business model.
          </p>
        </Panel>
      </div>
    </>
  );
}

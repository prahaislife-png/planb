import type { StaffUser } from '@/lib/auth';
import { asUser, type Row } from '@/lib/db';
import { dateTime, humanize, inr, num, pct } from '@/lib/format';
import { Badge, Empty, Grade, Panel } from '@/components/ui';
import { ScenarioCalculator } from '@/components/scenario-calculator';

function monthOrNever(v: number | null | undefined): string {
  return v === null || v === undefined ? 'not within horizon' : `month ${v}`;
}

export async function ModelTab({ user, model }: { user: StaffUser; model: Row }) {
  const d = await asUser(user.id, async (sql) => ({
    scenarios: await sql`
      select fs.id, fs.scenario_key, fs.label, fs.kind, fs.engine_version, fs.input_hash, fs.summary, fs.warnings, fs.grade_profile,
             fs.assumption_count, fs.parameter_count, fs.weakest_grade, fs.computed_at, fs.input, fs.annual, bv.name as variant_name, bv.id as variant_id
      from intel.financial_scenarios fs join intel.business_variants bv on bv.id = fs.business_variant_id
      where bv.business_model_id = ${model.id} and fs.is_current and fs.location_id is null
      order by bv.is_reference desc, array_position(array['base', 'conservative', 'optimistic', 'stress', 'failure', 'custom'], fs.kind), fs.scenario_key`,
    local: await sql`
      select fs.id, fs.label, fs.summary, fs.weakest_grade, l.name as location_name, l.slug as location_slug, bv.name as variant_name
      from intel.financial_scenarios fs join intel.business_variants bv on bv.id = fs.business_variant_id
      join intel.locations l on l.id = fs.location_id
      where bv.business_model_id = ${model.id} and fs.is_current order by bv.is_reference desc, l.name`,
    pilots: await sql`select name from intel.locations where is_pilot and location_type = 'city' order by name`,
    missing: await sql`
      select s.parameter_name, s.revenue_stream_name, bv.name as variant_name from intel.v_variant_parameter_status s
      join intel.business_variants bv on bv.id = s.business_variant_id
      where s.business_model_id = ${model.id} and s.is_required and not s.is_resolved`,
  }));
  const base = d.scenarios.find((s) => s.kind === 'base');

  if (!base) {
    return (
      <div className="notice bad">
        <b>No financial scenario has been computed.</b>
        {d.missing.length ? (
          <>
            <div>The deterministic engine will not run while required inputs are missing — they are not filled with guesses:</div>
            <ul>{d.missing.map((m, i) => <li key={i}>{m.parameter_name}{m.revenue_stream_name ? ` (${m.revenue_stream_name})` : ''} — {m.variant_name}</li>)}</ul>
          </>
        ) : <div>Ingest a source document, or queue a refresh run once cost and revenue evidence exists.</div>}
      </div>
    );
  }

  const s = base.summary;
  const sum = s.summary;
  const gp = base.grade_profile as Record<string, number>;
  const rec = s.sourceReconciliation as Record<string, number | string> | undefined;
  const y = (n: number) => sum.ownerIncome.components.find((c: Row) => c.year === n);

  return (
    <div className="grid">
      <div className="notice warn">
        These are outputs of a deterministic model run on the inputs recorded for this business — <b>{gp.observed ?? 0} observed, {gp.derived ?? 0} derived, {gp.assumptions ?? 0} assumed</b>;
        weakest input grade <Grade grade={base.weakest_grade} />. They describe what the inputs imply, not what will happen. No probability of success is estimated anywhere.
      </div>

      <div className="grid g4">
        <div className="stat"><div className="k">Initial investment</div><div className="v">{inr(s.initialInvestment.total, { compact: true })}</div>
          <div className="n">capex {inr(s.initialInvestment.capex, { compact: true })} · contingency {inr(s.initialInvestment.contingency, { compact: true })} · pre-operating {inr(s.initialInvestment.preOperatingCosts, { compact: true })}</div></div>
        <div className="stat"><div className="k">Owner cash needed in total</div><div className="v">{inr(sum.totalOwnerCashRequired, { compact: true })}</div>
          <div className="n">own money upfront {inr(s.funding.ownerEquityUpfront, { compact: true })} + reserve for the deepest cash trough {inr(sum.peakFundingNeed, { compact: true })} · loan {inr(s.funding.loan, { compact: true })}</div></div>
        <div className="stat"><div className="k">Steady-state monthly revenue</div><div className="v">{inr(sum.steadyState.revenue, { compact: true })}</div>
          <div className="n">reached at operating month {sum.steadyState.referenceOperatingMonth}{sum.steadyState.reachedWithinHorizon ? '' : ' (beyond horizon)'} · this is revenue, not income</div></div>
        <div className="stat"><div className="k">Steady-state operating profit / month</div><div className="v">{inr(sum.steadyState.ebitda, { compact: true })}</div>
          <div className="n">before owner pay, depreciation, interest and tax · margin {pct(sum.steadyState.ebitdaMarginPct)}</div></div>
        <div className="stat"><div className="k">Break-even revenue / month</div><div className="v">{inr(sum.breakEven.monthlyRevenueRequired, { compact: true })}</div>
          <div className="n">{pct(sum.breakEven.pctOfSteadyStateRevenue)} of steady-state revenue · operating profit first positive: {monthOrNever(sum.breakEven.firstOperatingMonthEbitdaPositive)}</div></div>
        <div className="stat"><div className="k">Capital recovery</div><div className="v">{monthOrNever(sum.capitalRecovery.paybackOperatingMonth)}</div>
          <div className="n">first month the owner's cumulative cash is back to zero, undiscounted · position at horizon end {inr(sum.capitalRecovery.cumulativeCashAtHorizonEnd, { compact: true })}</div></div>
        <div className="stat"><div className="k">Owner income / month (cash)</div><div className="v">{inr(sum.ownerIncome.year3AvgMonthly, { compact: true })}</div>
          <div className="n">year 3 average · year 1 {inr(sum.ownerIncome.year1AvgMonthly, { compact: true })} · year 2 {inr(sum.ownerIncome.year2AvgMonthly, { compact: true })} · after debt service, before personal tax</div></div>
        <div className="stat"><div className="k">Debt service cover (min)</div><div className="v">{sum.minDscr === null ? '—' : num(sum.minDscr, 2)}</div>
          <div className="n">average {sum.avgDscr === null ? '—' : num(sum.avgDscr, 2)} · loan outstanding at horizon end {inr(sum.loanBalanceAtHorizonEnd, { compact: true })}</div></div>
      </div>

      <div className="grid g2">
        <Panel title="Revenue is not profit is not cash is not income — base case, yearly" flush>
          <table>
            <thead><tr><th>Operating year</th><th className="num">Revenue</th><th className="num">Operating profit</th><th className="num">Net profit</th><th className="num">Net cash flow</th><th className="num">Owner income / month</th></tr></thead>
            <tbody>
              {(base.annual as Row[]).filter((a) => a.year > 0).map((a) => (
                <tr key={a.year}><td>Year {a.year}{a.months < 12 ? ` (${a.months} mo)` : ''}</td><td className="num">{inr(a.revenue)}</td>
                  <td className="num">{inr(a.operatingProfitBeforeOwnerComp)}</td><td className="num">{inr(a.netProfit)}</td>
                  <td className="num" style={{ color: a.netCashFlow < 0 ? 'var(--bad)' : undefined }}>{inr(a.netCashFlow)}</td>
                  <td className="num">{inr(y(a.year)?.ownerIncomeAvgMonthly)}</td></tr>))}
            </tbody>
          </table>
        </Panel>
        <div className="grid">
          {rec ? (
            <Panel title="Reconciliation against the source document">
              <dl className="kv">
                <dt>Stated year-1 sales</dt><dd className="mono">{inr(rec.statedRevenue as number)}</dd>
                <dt>Engine at the source's assumptions</dt><dd className="mono">{inr(rec.modelledRevenue as number)} <Badge value={`${Number(rec.revenueDeltaPct) >= 0 ? '+' : ''}${rec.revenueDeltaPct}%`} tone={Math.abs(Number(rec.revenueDeltaPct)) <= 5 ? 'good' : 'bad'} /></dd>
                {rec.statedNetProfit !== undefined ? <><dt>Stated year-1 net profit</dt><dd className="mono">{inr(rec.statedNetProfit as number)}</dd>
                  <dt>Engine year-1 net profit</dt><dd className="mono">{inr(rec.modelledNetProfit as number)}</dd></> : null}
              </dl>
              <p className="muted small" style={{ marginTop: 8 }}>{rec.basis as string}. A large revenue gap would indicate an extraction or structuring error. {rec.note as string}</p>
            </Panel>) : null}
          <Panel title="Model notes and warnings">
            {(s.modelNotes as string[]).length === 0 && (base.warnings as Row[]).length === 0 ? <span className="faint">None.</span> : null}
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {(s.modelNotes as string[]).map((n, i) => <li key={`n${i}`} className="small">{n}</li>)}
              {(base.warnings as Row[]).map((w, i) => <li key={`w${i}`} className="small"><Badge value={w.severity} tone={w.severity === 'critical' ? 'bad' : w.severity === 'warning' ? 'warn' : 'info'} /> <span className="mono">{w.code}</span> — {w.message}</li>)}
            </ul>
          </Panel>
        </div>
      </div>

      <Panel title="Scenarios and stress tests — generic illustrative shocks, not forecasts" flush>
        <table>
          <thead><tr><th>Scenario</th><th>Kind</th><th className="num">Initial investment</th><th className="num">Steady revenue / mo</th><th className="num">Operating profit / mo</th>
            <th className="num">Break-even / mo</th><th>Capital recovery</th><th className="num">Deepest cash trough</th><th className="num">Owner income yr 3 / mo</th><th className="num">Capital lost on closure</th><th>Warnings</th></tr></thead>
          <tbody>
            {d.scenarios.length === 0 ? <Empty cols={11}>No scenarios.</Empty> : null}
            {d.scenarios.map((sc) => {
              const x = sc.summary; const m = x.summary;
              return (
                <tr key={sc.id}>
                  <td style={{ minWidth: 340 }}><b>{sc.label}</b>{x.description ? <div className="faint small">{x.description}</div> : null}</td>
                  <td><Badge value={sc.kind} tone={sc.kind === 'base' ? 'info' : sc.kind === 'failure' || sc.kind === 'stress' ? 'warn' : undefined} /></td>
                  <td className="num">{inr(x.initialInvestment.total)}</td><td className="num">{inr(m.steadyState.revenue)}</td>
                  <td className="num" style={{ color: m.steadyState.ebitda < 0 ? 'var(--bad)' : undefined }}>{inr(m.steadyState.ebitda)}</td>
                  <td className="num">{inr(m.breakEven.monthlyRevenueRequired)}</td>
                  <td className="small">{monthOrNever(m.capitalRecovery.paybackOperatingMonth)}</td>
                  <td className="num">{inr(m.peakFundingNeed)}</td>
                  <td className="num" style={{ color: (m.ownerIncome.year3AvgMonthly ?? 0) < 0 ? 'var(--bad)' : undefined }}>{inr(m.ownerIncome.year3AvgMonthly)}</td>
                  <td className="num">{x.closure ? inr(x.closure.ownerCapitalLost) : ''}</td>
                  <td className="small">{(sc.warnings as Row[]).filter((w) => w.severity !== 'info').map((w) => w.code).join(', ') || <span className="faint">—</span>}</td>
                </tr>);
            })}
          </tbody>
        </table>
        <div className="body faint small">
          Engine {base.engine_version} · input hash <span className="mono">{String(base.input_hash).slice(0, 16)}…</span> · computed {dateTime(base.computed_at)} · {base.variant_name}.
          Re-running this engine version on the stored input reproduces these figures exactly.
        </div>
      </Panel>

      <Panel title="Location scenarios — national record with local overlays" flush>
        <table>
          <thead><tr><th>Location</th><th>Inputs with local evidence</th><th>Level of that evidence</th><th className="num">Initial investment</th>
            <th className="num">Operating profit / mo</th><th className="num">Break-even / mo</th><th>Capital recovery</th><th className="num">Owner income yr 3 / mo</th><th>Local inputs</th></tr></thead>
          <tbody>
            <tr className="sub">
              <td>National (no overlay)</td><td colSpan={2} className="muted small">the base case above</td>
              <td className="num">{inr(s.initialInvestment.total)}</td><td className="num">{inr(sum.steadyState.ebitda)}</td>
              <td className="num">{inr(sum.breakEven.monthlyRevenueRequired)}</td><td className="small">{monthOrNever(sum.capitalRecovery.paybackOperatingMonth)}</td>
              <td className="num">{inr(sum.ownerIncome.year3AvgMonthly)}</td><td />
            </tr>
            {d.local.map((sc) => {
              const x = sc.summary; const m = x.summary; const cov = x.locationCoverage as Row;
              return (
                <tr key={sc.id}>
                  <td><b>{sc.location_name}</b><div className="faint small">{sc.variant_name}</div></td>
                  <td><b>{cov.local_inputs}</b> of {cov.local_inputs + cov.inherited_national_inputs}<div className="faint small">{cov.inherited_national_inputs} inherit the national figure</div></td>
                  <td>{Object.entries(cov.by_level as Record<string, number>).map(([level, n]) => (
                    <span key={level} className="row" style={{ display: 'inline-flex', marginRight: 8 }}>
                      <Badge value={level === 'city' ? 'city-specific' : `inherited: ${level}`} tone={level === 'city' ? 'good' : 'warn'} /><span className="mono">{n}</span></span>))}</td>
                  <td className="num">{inr(x.initialInvestment.total)}</td>
                  <td className="num" style={{ color: m.steadyState.ebitda < 0 ? 'var(--bad)' : undefined }}>{inr(m.steadyState.ebitda)}</td>
                  <td className="num">{inr(m.breakEven.monthlyRevenueRequired)}</td>
                  <td className="small">{monthOrNever(m.capitalRecovery.paybackOperatingMonth)}</td>
                  <td className="num">{inr(m.ownerIncome.year3AvgMonthly)}</td>
                  <td className="small">{(cov.inputs as Row[]).map((i) => `${i.input}: ${inr(i.value)} (${i.level})`).join(' · ')}</td>
                </tr>);
            })}
            {d.pilots.filter((p) => !d.local.some((sc) => sc.location_name === p.name)).map((p) => (
              <tr key={p.name}><td>{p.name}</td><td colSpan={8}><Badge value="no local evidence" tone="bad" /> <span className="muted small">
                No scenario is shown for this city: presenting the national case under its name would claim local knowledge that does not exist.
                Record local rents, wages or quotations (Geography; Costs → derive locally), then refresh.</span></td></tr>))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Scenario calculator — same engine, in your browser">
        <ScenarioCalculator baseInput={base.input.input} />
      </Panel>

      <Panel title="Inputs sent to the engine (base case)">
        <details><summary>Show the exact model input ({humanize('json')})</summary><pre className="pagetext">{JSON.stringify(base.input.input, null, 2)}</pre></details>
      </Panel>
    </div>
  );
}

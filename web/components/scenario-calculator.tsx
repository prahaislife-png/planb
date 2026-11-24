'use client';

import { useMemo, useState } from 'react';
import { runModel, type ModelInput } from '@planb/finance';
import { inr, pct } from '@/lib/format';

/**
 * Interactive what-if on the base case. It runs the same deterministic engine the research worker runs
 * (packages/finance) in the browser; nothing is sent to a server and nothing here is saved.
 * Adjustments are the analyst's own what-ifs — they are not evidence and are labelled as such.
 */

interface Knobs { volumePct: number; pricePct: number; variablePct: number; fixedPct: number; ownerPay: number; rampMonths: number; preOpMonths: number; loanPct: number }

function adjust(base: ModelInput, k: Knobs): ModelInput {
  const input = structuredClone(base) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const vol = 1 + k.volumePct / 100, price = 1 + k.pricePct / 100;
  for (const s of input.revenueStreams) {
    const d = s.driver;
    if (d.kind === 'transactions') { d.transactionsPerDay *= vol; d.averageTicket *= price; }
    else if (d.kind === 'capacity_utilization') { d.utilization = Math.min(1, d.utilization * vol); d.unitPrice *= price; }
    else if (d.kind === 'area_yield') { d.yieldPerAreaPerCycle *= vol; d.pricePerUnit *= price; }
    else if (d.kind === 'enrolment') { d.enrolmentRate = Math.min(1, d.enrolmentRate * vol); d.feePerStudentPerMonth *= price; }
    else if (d.kind === 'occupancy') { d.occupancy = Math.min(1, d.occupancy * vol); d.ratePerAreaPerMonth *= price; }
    else if (d.kind === 'fleet_utilization') { d.utilization = Math.min(1, d.utilization * vol); d.ratePerUnitPerDay *= price; }
    else if (d.kind === 'engagements') { d.engagementsPerMonth *= vol; d.realizedFee *= price; }
    for (const v of s.variableCosts ?? []) {
      // a %-of-revenue cost is a ratio to price; holding the rupee cost per unit constant means dividing by the price change
      v.value = v.basis === 'pct_of_revenue' ? (v.value * (1 + k.variablePct / 100)) / price : v.value * (1 + k.variablePct / 100);
    }
  }
  for (const f of input.fixedCosts ?? []) f.monthlyAmount *= 1 + k.fixedPct / 100;
  for (const st of input.staff ?? []) st.monthlySalary *= 1 + k.fixedPct / 100;
  input.owner = { ...input.owner, monthlyCompensation: k.ownerPay };
  input.rampUp = { ...input.rampUp, monthsToSteadyState: k.rampMonths };
  input.preOperatingMonths = k.preOpMonths;
  const capex = (input.capex ?? []).reduce((a: number, c: { amount: number }) => a + c.amount, 0);
  if (k.loanPct > 0 && input.financing?.loan) input.financing.loan.principal = Math.round((capex * k.loanPct) / 100);
  else if (k.loanPct === 0 && input.financing) delete input.financing.loan;
  if (input.financing && Object.keys(input.financing).length === 0) delete input.financing;
  return input as ModelInput;
}

export function ScenarioCalculator({ baseInput }: { baseInput: unknown }) {
  const base = baseInput as ModelInput & { owner: { monthlyCompensation: number }; rampUp: { monthsToSteadyState: number }; preOperatingMonths: number; capex: { amount: number }[]; financing?: { loan?: { principal: number } } };
  const capex = base.capex.reduce((a, c) => a + c.amount, 0);
  const initial: Knobs = {
    volumePct: 0, pricePct: 0, variablePct: 0, fixedPct: 0, ownerPay: base.owner.monthlyCompensation,
    rampMonths: base.rampUp.monthsToSteadyState, preOpMonths: base.preOperatingMonths,
    loanPct: base.financing?.loan && capex > 0 ? Math.round((base.financing.loan.principal / capex) * 100) : 0,
  };
  const [k, setK] = useState<Knobs>(initial);
  const set = (key: keyof Knobs) => (e: React.ChangeEvent<HTMLInputElement>) => setK({ ...k, [key]: Number(e.target.value) });

  const { baseRes, res, error } = useMemo(() => {
    try {
      return { baseRes: runModel(base as ModelInput), res: runModel(adjust(base as ModelInput, k)), error: null as string | null };
    } catch (e) {
      return { baseRes: null, res: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [base, k]);

  const row = (label: string, pick: (r: NonNullable<typeof res>) => number | null, fmt: (v: number | null) => string = (v) => inr(v), invert = false) => {
    if (!res || !baseRes) return null;
    const a = pick(baseRes), b = pick(res);
    const delta = a !== null && b !== null ? b - a : null;
    const worse = delta !== null && (invert ? delta > 0 : delta < 0);
    return (
      <tr key={label}>
        <td>{label}</td><td className="num">{fmt(a)}</td><td className="num"><b>{fmt(b)}</b></td>
        <td className="num" style={{ color: delta ? (worse ? 'var(--bad)' : 'var(--good)') : 'var(--faint)' }}>{delta === null || delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${fmt(delta)}`}</td>
      </tr>
    );
  };
  const months = (v: number | null) => (v === null ? 'not in horizon' : `month ${v}`);
  const slider = (label: string, key: keyof Knobs, min: number, max: number, step: number, suffix: string) => (
    <div>
      <label>{label}: <span className="mono" style={{ color: 'var(--text)' }}>{k[key]}{suffix}</span></label>
      <input type="range" min={min} max={max} step={step} value={k[key]} onChange={set(key)} />
    </div>
  );

  return (
    <div className="grid g2">
      <div>
        <div className="form-grid">
          {slider('Sales volume', 'volumePct', -60, 40, 5, '%')}
          {slider('Selling price', 'pricePct', -30, 30, 1, '%')}
          {slider('Variable cost per unit', 'variablePct', -20, 50, 1, '%')}
          {slider('Fixed costs and wages', 'fixedPct', -20, 60, 5, '%')}
          {slider('Months to steady state', 'rampMonths', 0, 60, 1, '')}
          {slider('Set-up months before first sale', 'preOpMonths', 0, 12, 1, '')}
          {slider('Term loan (% of capital cost)', 'loanPct', 0, base.financing?.loan ? 90 : 0, 5, '%')}
          <div><label>Owner pay drawn / month (₹)</label><input type="number" min={0} step={5000} value={k.ownerPay} onChange={set('ownerPay')} /></div>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" onClick={() => setK(initial)}>Reset to base case</button>
          <span className="faint small">What-ifs are not evidence. To change the record, add observations or record an assumption with a rationale.</span>
        </div>
        {error ? <div className="notice bad" style={{ marginTop: 10 }}>The engine rejected this combination: {error}</div> : null}
      </div>
      <table>
        <thead><tr><th>Metric</th><th className="num">Base case</th><th className="num">What-if</th><th className="num">Change</th></tr></thead>
        <tbody>
          {row('Owner cash needed in total', (r) => r.summary.totalOwnerCashRequired, undefined, true)}
          {row('Steady-state revenue / month', (r) => r.summary.steadyState.revenue)}
          {row('Contribution margin', (r) => r.summary.steadyState.contributionMarginPct, (v) => pct(v))}
          {row('Operating profit / month (before owner pay)', (r) => r.summary.steadyState.ebitda)}
          {row('Break-even revenue / month', (r) => r.summary.breakEven.monthlyRevenueRequired, undefined, true)}
          {row('Owner income / month, year 1', (r) => r.summary.ownerIncome.year1AvgMonthly)}
          {row('Owner income / month, year 3', (r) => r.summary.ownerIncome.year3AvgMonthly)}
          {row('Deepest cash trough', (r) => r.summary.peakFundingNeed, undefined, true)}
          {res && baseRes ? (
            <tr><td>Capital recovery</td><td className="num">{months(baseRes.summary.capitalRecovery.paybackOperatingMonth)}</td>
              <td className="num"><b>{months(res.summary.capitalRecovery.paybackOperatingMonth)}</b></td><td /></tr>) : null}
          {res ? <tr><td colSpan={4} className="small muted">{res.warnings.filter((w) => w.severity !== 'info').map((w) => w.message).join(' · ') || 'No engine warnings for this what-if.'}</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

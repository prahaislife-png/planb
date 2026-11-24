import type { ReactNode } from 'react';
import { humanize, MISSING } from '@/lib/format';

export function Panel({ title, right, children, flush }: { title: ReactNode; right?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="panel">
      <header>
        <h2>{title}</h2>
        {right ? <div className="row small">{right}</div> : null}
      </header>
      <div className={flush ? 'body flush' : 'body'}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : undefined;
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div className="v" style={{ color }}>{value}</div>
      {note ? <div className="n">{note}</div> : null}
    </div>
  );
}

const TONES: Record<string, 'good' | 'warn' | 'bad' | 'info'> = {
  published: 'good', approved: 'good', verified: 'good', accepted: 'good', succeeded: 'good', live: 'good', done: 'good', permitted: 'good',
  permitted_with_attribution: 'good', automated: 'good', resolved: 'good', yes: 'good', active: 'good', observation: 'good',
  in_review: 'info', submitted: 'info', researching: 'info', running: 'info', queued: 'info', extracted: 'info', in_progress: 'info', derived: 'info',
  needs_revalidation: 'warn', changes_requested: 'warn', disputed: 'warn', waiting_retry: 'warn', unverified: 'warn', unclear: 'warn',
  permission_required: 'warn', manual_only: 'warn', open: 'warn', partial: 'warn', budget_exhausted: 'warn', assumption: 'warn', stale: 'warn',
  blocked: 'warn', partially_verified: 'warn', accepted_as_range: 'warn', superseded: 'warn',
  rejected: 'bad', failed: 'bad', prohibited: 'bad', do_not_ingest: 'bad', withdrawn: 'bad', no: 'bad', cancelled: 'bad', missing: 'bad',
};

export function Badge({ value, tone, title }: { value: string | null | undefined; tone?: 'good' | 'warn' | 'bad' | 'info'; title?: string }) {
  if (!value) return <span className="faint">{MISSING}</span>;
  return <span className={`badge ${tone ?? TONES[value] ?? ''}`} title={title}>{humanize(value)}</span>;
}

export function Grade({ grade, title }: { grade: string | null | undefined; title?: string }) {
  if (!grade) return <span className="faint">{MISSING}</span>;
  const meaning: Record<string, string> = {
    A: 'A — current, documented primary evidence or authoritative regulatory information, verified',
    B: 'B — multiple independent, reasonably current supporting sources',
    C: 'C — single-source evidence, older benchmark or unverified owner-reported information',
    D: 'D — unverified estimate or assumption',
  };
  return <span className={`grade ${grade}`} title={title ?? meaning[grade]}>{grade}</span>;
}

export function GradeBar({ a = 0, b = 0, c = 0, d = 0 }: { a?: number; b?: number; c?: number; d?: number }) {
  const total = a + b + c + d;
  if (!total) return <span className="faint small">no evidence</span>;
  const w = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="row" title={`A ${a} · B ${b} · C ${c} · D ${d}`}>
      <div className="gradebar" style={{ flex: 1 }}>
        <i style={{ width: w(a), background: 'var(--grade-a)' }} />
        <i style={{ width: w(b), background: 'var(--grade-b)' }} />
        <i style={{ width: w(c), background: 'var(--grade-c)' }} />
        <i style={{ width: w(d), background: 'var(--grade-d)' }} />
      </div>
      <span className="mono small muted">{a}/{b}/{c}/{d}</span>
    </div>
  );
}

export function Meter({ pct }: { pct: number | null | undefined }) {
  if (pct === null || pct === undefined) return <span className="faint">{MISSING}</span>;
  const cls = pct >= 75 ? 'high' : pct >= 40 ? 'mid' : 'low';
  return (
    <div className="row">
      <div className={`meter ${cls}`} style={{ flex: 1 }}><i style={{ width: `${Math.min(100, pct)}%` }} /></div>
      <span className="mono small">{Number(pct).toFixed(0)}%</span>
    </div>
  );
}

export function OriginBadge({ origin }: { origin: string }) {
  if (origin === 'research') return null;
  return <span className="badge demo" title="Not research. Cannot be verified or published.">{origin === 'demo' ? 'DEMO DATA' : 'TEST DATA'}</span>;
}

export function Empty({ cols, children }: { cols: number; children: ReactNode }) {
  return <tr><td className="empty" colSpan={cols}>{children}</td></tr>;
}

export function PageHead({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {right ? <div className="row">{right}</div> : null}
    </div>
  );
}

export function Flash({ params }: { params: { ok?: string; error?: string } }) {
  if (params.error) return <div className="notice bad">{params.error}</div>;
  if (params.ok) return <div className="notice good">{params.ok}</div>;
  return null;
}

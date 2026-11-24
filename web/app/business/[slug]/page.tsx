import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can, requireStaff } from '@/lib/auth';
import { asUser } from '@/lib/db';
import { Badge, Flash, GradeBar, Meter, OriginBadge } from '@/components/ui';
import { enqueueRefresh } from '@/app/actions/research';
import { OverviewTab } from './tabs/overview';
import { CostsTab } from './tabs/costs';
import { RevenueTab } from './tabs/revenue';
import { ModelTab } from './tabs/model';
import { EvidenceTab } from './tabs/evidence';
import { GapsTab } from './tabs/gaps';
import { VersionsTab } from './tabs/versions';

const TABS = [
  ['overview', 'Record'], ['costs', 'Costs & observations'], ['revenue', 'Revenue & parameters'], ['model', 'Financial model'],
  ['evidence', 'Evidence & review'], ['gaps', 'Gaps & tasks'], ['versions', 'Versions'],
] as const;
type Tab = (typeof TABS)[number][0];

export default async function BusinessRecord({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; ok?: string; error?: string }>;
}) {
  const user = await requireStaff();
  const { slug } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS.find(([k]) => k === sp.tab)?.[0] ?? 'overview') as Tab;

  const head = await asUser(user.id, async (sql) => {
    const [m] = await sql`
      select m.*, i.name as industry_name, c.completeness_pct, c.checks_passed, c.checks_total, c.critical_missing,
             q.grade_a, q.grade_b, q.grade_c, q.grade_d, q.observation_count, q.verified_count, q.unverified_count, q.stale_count,
             q.open_conflicts, q.claims_pending_review, q.assumption_count, q.parameter_count, q.distinct_sources
      from intel.business_models m
      join intel.industries i on i.id = m.industry_id
      join intel.v_business_completeness c on c.business_model_id = m.id
      join intel.v_business_evidence_quality q on q.business_model_id = m.id
      where m.slug = ${slug}`;
    return m;
  });
  if (!head) notFound();
  const back = `/business/${slug}?tab=${tab}`;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row">
            <h1>{head.name}</h1>
            <Badge value={head.lifecycle_status} />
            {head.is_pilot ? <span className="badge info">pilot</span> : null}
            <OriginBadge origin={head.data_origin} />
          </div>
          <div className="sub">
            <Link href="/catalogue">{head.industry_name}</Link>{head.family ? <> · family <span className="mono">{head.family}</span></> : null} · <span className="mono">{head.slug}</span>
          </div>
        </div>
        <form action={enqueueRefresh} className="inline">
          <input type="hidden" name="model_id" value={head.id} />
          <input type="hidden" name="back" value={back} />
          <button type="submit" disabled={!can(user, 'admin', 'researcher')} title="Re-run structuring, cross-verification, modelling and gap analysis">Queue refresh run</button>
        </form>
      </div>

      {head.data_origin !== 'research' ? (
        <div className="notice demo"><b>{head.data_origin === 'demo' ? 'Demonstration data.' : 'Test data.'}</b> This record is not research. Its evidence can never be verified and it can never be published.</div>
      ) : null}
      <Flash params={sp} />

      <div className="grid g2" style={{ marginBottom: 12 }}>
        <div className="stat">
          <div className="k">Research completeness — how much of the record exists</div>
          <div style={{ marginTop: 6 }}><Meter pct={head.completeness_pct} /></div>
          <div className="n">{head.checks_passed} of {head.checks_total} checks satisfied · <span style={{ color: head.critical_missing ? 'var(--bad)' : 'var(--good)' }}>{head.critical_missing} critical sections missing</span></div>
        </div>
        <div className="stat">
          <div className="k">Evidence quality — how good the evidence behind it is</div>
          <div style={{ marginTop: 6 }}><GradeBar a={head.grade_a} b={head.grade_b} c={head.grade_c} d={head.grade_d} /></div>
          <div className="n">
            {head.observation_count} observations from {head.distinct_sources} source{head.distinct_sources === 1 ? '' : 's'} · {head.verified_count} verified · {head.stale_count} stale · {head.open_conflicts} conflicts ·{' '}
            {head.assumption_count} of {head.parameter_count} model inputs are assumptions · {head.claims_pending_review} claims await review
          </div>
        </div>
      </div>

      <div className="tabs">
        {TABS.map(([key, label]) => (
          <Link key={key} href={`/business/${slug}?tab=${key}`} className={key === tab ? 'active' : undefined}>{label}</Link>
        ))}
      </div>

      {tab === 'overview' ? <OverviewTab user={user} model={head} back={back} /> : null}
      {tab === 'costs' ? <CostsTab user={user} model={head} back={back} /> : null}
      {tab === 'revenue' ? <RevenueTab user={user} model={head} back={back} /> : null}
      {tab === 'model' ? <ModelTab user={user} model={head} /> : null}
      {tab === 'evidence' ? <EvidenceTab user={user} model={head} back={back} /> : null}
      {tab === 'gaps' ? <GapsTab user={user} model={head} back={back} /> : null}
      {tab === 'versions' ? <VersionsTab user={user} model={head} back={back} /> : null}
    </>
  );
}

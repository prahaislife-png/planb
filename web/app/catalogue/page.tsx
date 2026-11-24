import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { asUser } from '@/lib/db';
import { humanize } from '@/lib/format';
import { Badge, Empty, GradeBar, Meter, PageHead, Panel } from '@/components/ui';

type Search = { industry?: string; status?: string; pilot?: string; q?: string };

export default async function Catalogue({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 80);
  const { rows, industries, statuses } = await asUser(user.id, async (sql) => {
    const rows = await sql`
      select m.slug, m.name, m.family, m.lifecycle_status, m.is_pilot, m.research_priority, m.capital_tier_hypothesis, m.revenue_archetype,
             m.data_origin, i.name as industry, i.slug as industry_slug,
             c.completeness_pct, c.critical_missing, q.grade_a, q.grade_b, q.grade_c, q.grade_d, q.observation_count,
             (select cc.code from intel.business_model_classifications x join intel.classification_codes cc on cc.id = x.classification_code_id
               where x.business_model_id = m.id and x.is_primary limit 1) as nic,
             (select count(*) from intel.business_variants v where v.business_model_id = m.id) as variants
      from intel.business_models m
      join intel.industries i on i.id = m.industry_id
      join intel.v_business_completeness c on c.business_model_id = m.id
      join intel.v_business_evidence_quality q on q.business_model_id = m.id
      where (${sp.industry ?? null}::text is null or i.slug = ${sp.industry ?? null})
        and (${sp.status ?? null}::text is null or m.lifecycle_status = ${sp.status ?? null})
        and (${sp.pilot === '1'} = false or m.is_pilot)
        and (${q} = '' or m.name ilike ${'%' + q + '%'} or m.family ilike ${'%' + q + '%'} or m.slug ilike ${'%' + q + '%'})
      order by (m.lifecycle_status = 'backlog'), m.is_pilot desc, m.research_priority, i.sort_order, m.family nulls last, m.name
      limit 400`;
    const industries = await sql`select slug, name from intel.industries order by sort_order`;
    const statuses = await sql`select distinct lifecycle_status from intel.business_models order by 1`;
    return { rows, industries, statuses };
  });

  return (
    <>
      <PageHead title="Business model catalogue"
        sub="Each row is one distinct operating model — never a category. Siblings in the same family (e.g. the six coffee models) are separate records that must not be merged." />
      <form method="get" className="row" style={{ marginBottom: 10 }}>
        <input name="q" placeholder="Search name, family or slug" defaultValue={q} style={{ width: 260 }} />
        <select name="industry" defaultValue={sp.industry ?? ''} style={{ width: 240 }}>
          <option value="">All industries</option>
          {industries.map((i) => <option key={i.slug} value={i.slug}>{i.name}</option>)}
        </select>
        <select name="status" defaultValue={sp.status ?? ''} style={{ width: 170 }}>
          <option value="">Any status</option>
          {statuses.map((s) => <option key={s.lifecycle_status} value={s.lifecycle_status}>{humanize(s.lifecycle_status)}</option>)}
        </select>
        <label className="row" style={{ margin: 0 }}><input type="checkbox" name="pilot" value="1" defaultChecked={sp.pilot === '1'} /> pilot only</label>
        <button type="submit">Filter</button>
        <Link href="/catalogue" className="small">reset</Link>
        <span className="muted small">{rows.length} models</span>
      </form>
      <Panel title="Operating models" flush>
        <table>
          <thead><tr>
            <th>Operating model</th><th>Family</th><th>Industry</th><th>NIC-2008</th><th>Archetype</th><th>Status</th><th className="num">Pri</th>
            <th title="Unverified triage guess used only to prioritise research">Capital tier (hypothesis)</th>
            <th style={{ width: 130 }}>Completeness</th><th style={{ width: 170 }}>Evidence A/B/C/D</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <Empty cols={10}>No business model matches these filters.</Empty> : null}
            {rows.map((m) => (
              <tr key={m.slug}>
                <td>
                  <Link href={`/business/${m.slug}`}>{m.name}</Link>{' '}
                  {m.is_pilot ? <span className="badge info">pilot</span> : null}{' '}
                  {m.data_origin !== 'research' ? <span className="badge demo">{m.data_origin}</span> : null}
                </td>
                <td className="muted">{m.family ?? '—'}</td>
                <td className="muted">{m.industry}</td>
                <td className="mono small">{m.nic ?? '—'}</td>
                <td className="muted small">{humanize(m.revenue_archetype)}</td>
                <td><Badge value={m.lifecycle_status} /></td>
                <td className="num">{m.research_priority}</td>
                <td className="mono small faint">{m.capital_tier_hypothesis ?? '—'}</td>
                <td>{m.lifecycle_status === 'backlog' ? <span className="faint small">not started</span> : <Meter pct={m.completeness_pct} />}</td>
                <td>{m.observation_count ? <GradeBar a={m.grade_a} b={m.grade_b} c={m.grade_c} d={m.grade_d} /> : <span className="faint small">no evidence</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

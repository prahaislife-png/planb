import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { asUser } from '@/lib/db';
import { date, humanize, num } from '@/lib/format';
import { Badge, Empty, OriginBadge, PageHead, Panel, Stat } from '@/components/ui';

type Search = { reuse_status?: string; source_type?: string; recommended_ingestion?: string; accessibility?: string; q?: string };

const REUSE = ['permitted', 'permitted_with_attribution', 'permission_required', 'prohibited', 'unclear'] as const;
const SOURCE_TYPES = [
  'government_project_report', 'government_dataset', 'regulatory_portal', 'scheme_portal', 'statistical_agency',
  'academic_extension', 'skills_training', 'industry_association', 'procurement_portal', 'manufacturer_catalogue',
  'b2b_marketplace', 'commercial_report', 'property_listing', 'franchise_disclosure', 'primary_research',
] as const;
const INGESTION = ['automated', 'manual_only', 'do_not_ingest'] as const;
const ACCESSIBILITY = ['yes', 'partial', 'no', 'untested'] as const;

const W = { whiteSpace: 'normal' } as const; // lets a long column header wrap instead of widening the table
const pick = (allowed: readonly string[], v: unknown): string | null => (typeof v === 'string' && allowed.includes(v) ? v : null);

export default async function Sources({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireStaff();
  const sp = await searchParams;
  const reuse = pick(REUSE, sp.reuse_status);
  const sourceType = pick(SOURCE_TYPES, sp.source_type);
  const ingestion = pick(INGESTION, sp.recommended_ingestion);
  const accessibility = pick(ACCESSIBILITY, sp.accessibility);
  const q = (typeof sp.q === 'string' ? sp.q : '').trim().slice(0, 80);
  const filtered = Boolean(reuse || sourceType || ingestion || accessibility || q);

  const { totals, rows } = await asUser(user.id, async (sql) => {
    const [totals] = await sql`
      select count(*) as total,
             count(*) filter (where reuse_status in ('permitted', 'permitted_with_attribution')) as cleared,
             count(*) filter (where reuse_status = 'permission_required') as permission_required,
             count(*) filter (where reuse_status = 'permission_required' and permission_granted_on is not null) as permission_recorded,
             count(*) filter (where reuse_status = 'prohibited') as prohibited,
             count(*) filter (where reuse_status = 'unclear') as unclear,
             count(*) filter (where ingestion_enabled) as enabled,
             count(*) filter (where recommended_ingestion = 'automated') as recommended_automated
      from intel.sources`;
    const rows = await sql`
      select s.slug, s.name, s.publisher, s.source_type, s.authority_level, s.reuse_status, s.recommended_ingestion, s.ingestion_enabled,
             s.accessibility, s.api_available, s.registry_confidence, s.terms_checked_on, s.permission_granted_on, s.data_origin,
             coalesce(d.documents, 0) as documents, greatest(s.last_ingested_at, d.last_retrieved_at) as last_ingested
      from intel.sources s
      left join (select source_id, count(*) as documents, max(retrieved_at) as last_retrieved_at
                 from intel.source_documents group by source_id) d on d.source_id = s.id
      where (${reuse}::text is null or s.reuse_status = ${reuse})
        and (${sourceType}::text is null or s.source_type = ${sourceType})
        and (${ingestion}::text is null or s.recommended_ingestion = ${ingestion})
        and (${accessibility}::text is null or s.accessibility = ${accessibility})
        and (${q} = '' or s.name ilike ${'%' + q + '%'} or s.publisher ilike ${'%' + q + '%'} or s.slug ilike ${'%' + q + '%'}
             or s.information_available ilike ${'%' + q + '%'})
      order by coalesce(d.documents, 0) desc,
               array_position(array['permitted', 'permitted_with_attribution', 'permission_required', 'unclear', 'prohibited'], s.reuse_status),
               s.name
      limit 500`;
    return { totals, rows };
  });

  return (
    <>
      <PageHead title="Source registry"
        sub="What each research source offers, how it may be accessed, and whether it may legally be collected and commercially reused. The registry gates every automated adapter." />
      <div className="notice warn">
        <b>&ldquo;Publicly visible&rdquo; is not a licence.</b> Automated collection can only be enabled for a source whose own reuse terms permit it, or for which
        written permission has been recorded. This is enforced by a database constraint (<span className="mono">sources_ingestion_requires_reuse_right</span>), not by this screen —
        an attempt to enable ingestion for any other source is refused by the database.
      </div>
      <div className="grid g6" style={{ marginBottom: 12 }}>
        <Stat label="Sources" value={num(totals.total)} note="in the registry" />
        <Stat label="Cleared for commercial reuse" value={num(totals.cleared)} note="permitted, with or without attribution" tone={totals.cleared > 0 ? 'good' : 'bad'} />
        <Stat label="Permission required" value={num(totals.permission_required)} note={`${num(totals.permission_recorded)} with written permission recorded`} tone={totals.permission_required > 0 ? 'warn' : undefined} />
        <Stat label="Prohibited" value={num(totals.prohibited)} note="must not be ingested" tone={totals.prohibited > 0 ? 'bad' : undefined} />
        <Stat label="Unclear" value={num(totals.unclear)} note="terms not found or ambiguous" tone={totals.unclear > 0 ? 'warn' : undefined} />
        <Stat label="Automated ingestion enabled" value={num(totals.enabled)} note={`${num(totals.recommended_automated)} recommended for automation`} />
      </div>

      <form method="get" className="row" style={{ marginBottom: 10 }}>
        <input name="q" placeholder="Search name, publisher, slug, content" defaultValue={q} style={{ width: 250 }} />
        <select name="reuse_status" defaultValue={reuse ?? ''} style={{ width: 200 }} aria-label="Reuse status">
          <option value="">Any reuse status</option>
          {REUSE.map((v) => <option key={v} value={v}>{humanize(v)}</option>)}
        </select>
        <select name="source_type" defaultValue={sourceType ?? ''} style={{ width: 210 }} aria-label="Source type">
          <option value="">Any source type</option>
          {SOURCE_TYPES.map((v) => <option key={v} value={v}>{humanize(v)}</option>)}
        </select>
        <select name="recommended_ingestion" defaultValue={ingestion ?? ''} style={{ width: 190 }} aria-label="Recommended ingestion">
          <option value="">Any recommended ingestion</option>
          {INGESTION.map((v) => <option key={v} value={v}>{humanize(v)}</option>)}
        </select>
        <select name="accessibility" defaultValue={accessibility ?? ''} style={{ width: 170 }} aria-label="Accessibility">
          <option value="">Any accessibility</option>
          {ACCESSIBILITY.map((v) => <option key={v} value={v}>Accessible: {humanize(v).toLowerCase()}</option>)}
        </select>
        <button type="submit">Filter</button>
        <Link href="/sources" className="small">reset</Link>
        <span className="muted small">{rows.length} sources</span>
      </form>

      <Panel title="Sources" flush>
        <table>
          <thead>
            <tr>
              <th rowSpan={2} style={{ minWidth: 240 }}>Source</th><th rowSpan={2}>Type · authority</th><th rowSpan={2}>Reuse status</th>
              <th colSpan={2} style={{ borderLeft: '1px solid var(--line)', borderRight: '1px solid var(--line)' }}>Ingestion</th>
              <th rowSpan={2} title="Whether the source could actually be reached when it was checked, and whether it offers an API">Accessible · API</th>
              <th rowSpan={2} style={W} title="verified = the licence/terms page was actually read on the date shown">Registry confidence</th>
              <th rowSpan={2} style={W}>Terms checked on</th><th rowSpan={2} className="num" style={W}>Documents ingested</th><th rowSpan={2} style={W}>Last ingested</th>
            </tr>
            <tr>
              <th style={{ borderLeft: '1px solid var(--line)' }} title="How the registry recommends this source be collected">Recommended</th>
              <th style={{ borderRight: '1px solid var(--line)' }} title="Whether automated collection is switched on. Gated by the reuse-right constraint.">Enabled</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <Empty cols={10}>{filtered ? 'No source matches these filters.' : 'The source registry is empty. Sources are loaded from the registry seed.'}</Empty> : null}
            {rows.map((s) => (
              <tr key={s.slug}>
                <td>
                  <Link href={`/sources/${s.slug}`}>{s.name}</Link> <OriginBadge origin={s.data_origin} />
                  <div className="muted small">{s.publisher ?? <span className="faint">publisher not recorded</span>}</div>
                </td>
                <td className="small">{humanize(s.source_type)}<div className="muted">{humanize(s.authority_level)}</div></td>
                <td><Badge value={s.reuse_status} />{s.reuse_status === 'permission_required' && s.permission_granted_on
                  ? <div className="small" style={{ color: 'var(--good)' }}>permission recorded {s.permission_granted_on}</div> : null}</td>
                <td><Badge value={s.recommended_ingestion} /></td>
                <td>{s.ingestion_enabled ? <Badge value="yes" tone="good" /> : <span className="badge">no</span>}</td>
                <td className="nowrap">{s.accessibility === 'untested' ? <span className="badge">untested</span> : <Badge value={s.accessibility} />}
                  <div className="small muted" style={{ marginTop: 3 }}>API: {s.api_available === 'yes' ? <span style={{ color: 'var(--info)' }}>yes</span> : s.api_available}</div></td>
                <td><Badge value={s.registry_confidence} /></td>
                <td className="mono small nowrap">{s.terms_checked_on ? date(s.terms_checked_on) : <span className="badge warn" title="The terms of this source have never been checked">never</span>}</td>
                <td className="num">{s.documents > 0 ? num(s.documents) : <span className="faint" title="No document from this source is in the evidence store">0</span>}</td>
                <td className="mono small nowrap">{s.last_ingested ? date(s.last_ingested) : <span className="faint" title="Nothing has been ingested from this source">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  );
}

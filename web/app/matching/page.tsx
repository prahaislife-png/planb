import { narrowSnapshot } from '@planb/matching';
import { requireStaff } from '@/lib/auth';
import { asUser } from '@/lib/db';
import { dateTime } from '@/lib/format';
import { PageHead } from '@/components/ui';
import { MatchingLab, type LabRecord } from '@/components/matching-lab';

/**
 * Matching lab — an internal preview of the deterministic matching engine (packages/matching).
 * It loads the latest version of every business record, WHATEVER its review status, so analysts can see how the
 * engine reads records that are still being researched. Nothing on this page is saved or shown to customers.
 */
export default async function MatchingLabPage() {
  const user = await requireStaff();
  const d = await asUser(user.id, async (sql) => ({
    versions: await sql`
      select distinct on (v.business_model_id)
             v.id, v.version_no, v.status, v.submitted_at, v.snapshot, m.slug, m.name,
             exists (select 1 from pub.publication_versions p where p.business_version_id = v.id and p.status = 'live') as is_live
      from intel.business_versions v join intel.business_models m on m.id = v.business_model_id
      order by v.business_model_id, v.version_no desc`,
    locations: await sql`select slug, name from intel.locations where location_type = 'city' order by name`,
    skills: await sql`select slug, name from intel.skills order by name`,
    assetTypes: await sql`select slug, name from intel.asset_types order by name`,
  }));

  // Only the fields the engine reads go to the browser — not the observations, sources or documents of the full snapshot.
  const records: LabRecord[] = d.versions.map((v) => ({
    versionId: v.id,
    versionNo: v.version_no,
    status: v.status,
    submittedAt: dateTime(v.submitted_at),
    isLive: v.is_live,
    slug: v.slug,
    snapshot: narrowSnapshot(v.snapshot),
  }));
  const unpublished = records.filter((r) => !r.isLive).length;

  return (
    <>
      <PageHead title="Matching lab"
        sub="Internal preview of the deterministic matching engine: one person's profile compared with each business record — feasibility checks, fit by dimension, trade-offs and missing prerequisites, with research confidence reported separately." />
      <div className="notice warn" style={{ marginBottom: 12 }}>
        <b>Internal preview — not a customer view.</b> This page runs on the latest research version of each business,
        {' '}<b>{unpublished} of {records.length} of them unpublished</b>. Customers will only ever be matched against published records.
        Nothing here is a recommendation: the engine reports categories with reasons, computes no score or probability of any kind,
        and every financial figure is a model output on the inputs recorded so far, not a forecast.
      </div>
      <MatchingLab
        records={records}
        locations={d.locations.map((l) => ({ slug: l.slug, name: l.name }))}
        skills={d.skills.map((s) => ({ slug: s.slug, name: s.name }))}
        assetTypes={d.assetTypes.map((a) => ({ slug: a.slug, name: a.name }))}
      />
    </>
  );
}

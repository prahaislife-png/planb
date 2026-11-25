-- PlanB · 0020 · Carry asset requirements in the business snapshot.
--
-- intel.business_assets (land, shop, vehicle… a variant needs or benefits from) was not part of the snapshot, so the
-- matching engine's "required assets" check could never be answered. The existing builder is kept as the base and
-- wrapped, so every other key of the snapshot is unchanged.

alter function intel.build_business_snapshot(uuid) rename to build_business_snapshot_base;

create function intel.build_business_snapshot(p_model uuid) returns jsonb
language sql stable
as $$
  select jsonb_set(
    b.snap,
    '{variants}',
    coalesce((
      select jsonb_agg(
        v.elem || jsonb_build_object('assets', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'asset_type_slug', a.asset_type_slug, 'name', t.name, 'requirement_level', a.requirement_level,
                   'quantity', a.quantity, 'unit', a.unit_code, 'evidence_grade', a.evidence_grade) order by a.asset_type_slug)
          from intel.business_assets a join intel.asset_types t on t.slug = a.asset_type_slug
          where a.business_variant_id = (v.elem ->> 'id')::uuid), '[]'::jsonb))
        order by v.ord)
      from jsonb_array_elements(b.snap -> 'variants') with ordinality v (elem, ord)), '[]'::jsonb))
  from (select intel.build_business_snapshot_base(p_model) as snap) b
$$;
comment on function intel.build_business_snapshot is 'JSON rendering of one business record with per-number source attribution, quality metrics and asset requirements. Excludes private research notes, supplier contacts and all interview identities.';

revoke execute on function intel.build_business_snapshot(uuid) from public;
grant execute on function intel.build_business_snapshot(uuid) to authenticated, planb_worker;

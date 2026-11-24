'use server';

import { z } from 'zod';
import { act, text, uuid } from '@/lib/action';

/**
 * Source-registry actions that touch the legal gate. Both are admin-only: the role is checked inside the
 * statement by the database (ops.has_role), never taken from the client. Whether automated collection may
 * actually be enabled is decided by the table constraints on intel.sources, not by this code.
 */

const ADMIN_ONLY = 'Not permitted: only an admin can change the legal gate of a source.';

export async function recordPermission(form: FormData) {
  return act(form, z.object({
    source_id: uuid,
    permission_granted_on: z.string().date().refine((d) => d <= new Date().toISOString().slice(0, 10), 'cannot be in the future'),
    permission_evidence: text(2000).min(10),
  }), 'Written permission recorded. Automated ingestion can now be enabled for this source if its terms were checked.', async (sql, i) => {
    const rows = await sql`
      update intel.sources
         set permission_granted_on = ${i.permission_granted_on}, permission_evidence = ${i.permission_evidence}
       where id = ${i.source_id} and ops.has_role('admin')
      returning id`;
    if (rows.length === 0) throw new Error(ADMIN_ONLY);
  });
}

export async function setIngestionEnabled(form: FormData) {
  return act(form, z.object({ source_id: uuid, enabled: z.enum(['true', 'false']) }),
    (r) => (r as boolean) ? 'Automated ingestion enabled for this source.' : 'Automated ingestion disabled for this source.',
    async (sql, i) => {
      const enable = i.enabled === 'true';
      const [source] = await sql`select recommended_ingestion from intel.sources where id = ${i.source_id}`;
      if (!source) throw new Error('Unknown source.');
      if (enable && source.recommended_ingestion === 'do_not_ingest') {
        throw new Error('This source is marked do-not-ingest in the registry; automated ingestion cannot be enabled for it.');
      }
      let rows;
      try {
        rows = await sql`
          update intel.sources set ingestion_enabled = ${enable}
           where id = ${i.source_id} and ops.has_role('admin')
          returning id`;
      } catch (error) {
        const e = error as { code?: string; constraint_name?: string };
        if (e.code === '23514' && e.constraint_name === 'sources_ingestion_requires_reuse_right') {
          throw new Error('Refused by the database (sources_ingestion_requires_reuse_right): automated collection can only be enabled when the reuse terms permit it, or when the source is permission_required and a written permission (date and evidence) is recorded.');
        }
        if (e.code === '23514' && e.constraint_name === 'sources_ingestion_requires_terms_check') {
          throw new Error('Refused by the database (sources_ingestion_requires_terms_check): the source terms have never been checked (terms_checked_on is empty).');
        }
        throw error;
      }
      if (rows.length === 0) throw new Error(ADMIN_ONLY);
      return enable;
    });
}

'use server';

import { z } from 'zod';
import { act, uuid } from '@/lib/action';

/**
 * Job-queue actions. Staff enqueue and cancel runs; they never execute them. The `staff_cancel` RLS policy
 * only lets an admin or researcher update a run, and only to status queued/cancelled — so a role that may
 * not cancel simply matches no row, and this action reports that instead of pretending it worked.
 */
export async function cancelRun(form: FormData) {
  return act(form, z.object({ run_id: uuid }), 'Run cancelled. It will not be picked up by a worker.', async (sql, i) => {
    const rows = await sql`
      update ops.research_runs
         set status = 'cancelled', finished_at = now()
       where id = ${i.run_id} and status in ('queued', 'waiting_retry')
      returning id`;
    if (rows.length === 0) {
      throw new Error('Run was not cancelled: it is no longer queued or waiting for a retry, or your role may not cancel runs (admin or researcher).');
    }
  });
}

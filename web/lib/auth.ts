import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { asUser } from './db';

export type StaffRole = 'admin' | 'researcher' | 'reviewer';
export interface StaffUser {
  id: string;
  displayName: string;
  roles: StaffRole[];
  authMode: 'dev' | 'supabase';
}

export const DEV_USERS = [
  { id: '00000000-0000-4000-8000-000000000002', label: 'Dev Researcher' },
  { id: '00000000-0000-4000-8000-000000000003', label: 'Dev Reviewer' },
  { id: '00000000-0000-4000-8000-000000000001', label: 'Dev Admin' },
] as const;
export const DEV_COOKIE = 'planb_dev_user';

function authMode(): 'dev' | 'supabase' {
  const mode = process.env.PLANB_AUTH_MODE ?? 'supabase';
  if (mode === 'dev') {
    // Dev identities must never be reachable from a deployed build.
    if (process.env.NODE_ENV === 'production' && process.env.PLANB_ALLOW_DEV_AUTH_IN_PRODUCTION_BUILD !== 'local-only') {
      throw new Error('PLANB_AUTH_MODE=dev is refused in production builds');
    }
    return 'dev';
  }
  return 'supabase';
}

async function resolveUserId(): Promise<string | null> {
  const jar = await cookies();
  if (authMode() === 'dev') {
    const chosen = jar.get(DEV_COOKIE)?.value;
    return DEV_USERS.find((u) => u.id === chosen)?.id ?? DEV_USERS[0].id;
  }
  // Supabase Auth: validate the session server-side with the anon key (never the service key).
  // STATUS: written against @supabase/ssr's documented server-client contract; not yet exercised
  // against a live Supabase project.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const { createServerClient } = await import('@supabase/ssr');
  const supabase = createServerClient(url, anon, {
    cookies: { getAll: () => jar.getAll(), setAll: () => undefined },
  });
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** The signed-in staff member, or null. Looked up through RLS as that user. */
export const getStaffUser = cache(async (): Promise<StaffUser | null> => {
  const id = await resolveUserId();
  if (!id) return null;
  const rows = await asUser(id, (sql) => sql`
    select m.display_name, coalesce(array_agg(r.role order by r.role) filter (where r.role is not null), '{}') as roles
    from ops.staff_members m left join ops.staff_roles r on r.user_id = m.user_id
    where m.user_id = ${id} and m.is_active
    group by m.display_name`);
  if (rows.length === 0 || rows[0].roles.length === 0) return null;
  return { id, displayName: rows[0].display_name, roles: rows[0].roles, authMode: authMode() };
});

export async function requireStaff(): Promise<StaffUser> {
  const user = await getStaffUser();
  if (!user) redirect('/no-access');
  return user;
}

export function can(user: StaffUser, ...roles: StaffRole[]): boolean {
  return user.roles.some((r) => roles.includes(r));
}

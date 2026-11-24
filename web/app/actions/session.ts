'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DEV_COOKIE, DEV_USERS } from '@/lib/auth';

export async function switchDevUser(form: FormData): Promise<void> {
  if (process.env.PLANB_AUTH_MODE !== 'dev') return;
  const id = String(form.get('user') ?? '');
  if (!DEV_USERS.some((u) => u.id === id)) return;
  (await cookies()).set(DEV_COOKIE, id, { httpOnly: true, sameSite: 'lax', path: '/' });
  redirect('/');
}

import 'server-only';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireStaff } from './auth';
import { asUser, dbErrorMessage, type Sql } from './db';

/**
 * Shared plumbing for server actions: authenticate → validate → run as the staff user (RLS and the
 * database guard triggers decide what is allowed) → redirect back with ?ok= or ?error=.
 * Import these from a file that starts with 'use server'; this module itself is not an action file.
 */

export const uuid = z.string().uuid();
export const text = (max = 2000) => z.string().trim().max(max);
export const optionalText = (max = 2000) => text(max).optional().transform((v) => (v ? v : null));
export const optionalUuid = z.union([z.literal(''), uuid]).optional().transform((v) => (v ? v : null));
export const optionalNumber = z.union([z.literal(''), z.coerce.number().finite()]).optional().transform((v) => (v === '' || v === undefined ? null : v));
export const optionalDate = z.union([z.literal(''), z.string().date()]).optional().transform((v) => (v ? v : null));
export const checkbox = z.union([z.literal('on'), z.literal('true'), z.literal('1')]).optional().transform((v) => v !== undefined);

export function backTo(form: FormData, fallback = '/'): string {
  const raw = String(form.get('back') ?? fallback);
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : fallback; // same-origin paths only
}

export function withMessage(path: string, key: 'ok' | 'error', message: string): string {
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.delete('ok');
  params.delete('error');
  params.set(key, message.slice(0, 400));
  return `${base}?${params.toString()}`;
}

export async function act<T>(form: FormData, schema: z.ZodType<T, z.ZodTypeDef, unknown>, ok: string | ((result: unknown) => string),
                             fn: (sql: Sql, input: T, userId: string) => Promise<unknown>): Promise<never> {
  const user = await requireStaff();
  const back = backTo(form);
  const parsed = schema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) {
    redirect(withMessage(back, 'error', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')));
  }
  let target: string;
  try {
    const result = await asUser(user.id, (sql) => fn(sql, parsed.data, user.id));
    target = withMessage(back, 'ok', typeof ok === 'function' ? ok(result) : ok);
  } catch (error) {
    target = withMessage(back, 'error', dbErrorMessage(error));
  }
  revalidatePath('/', 'layout');
  redirect(target);
}

/**
 * Row-level security filters rows silently: an UPDATE the user may not perform affects zero rows and raises
 * nothing. Wrap such statements so "nothing changed" is reported as a refusal, never as success.
 */
export async function mustAffect(query: PromiseLike<{ count: number }>, what = 'this record'): Promise<void> {
  const result = await query;
  if (result.count === 0) {
    const error = new Error(`your role does not allow changing ${what}, or it no longer exists`) as Error & { code: string };
    error.code = '42501';
    throw error;
  }
}

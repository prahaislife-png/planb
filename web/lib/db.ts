import 'server-only';
import postgres from 'postgres';

/**
 * Database access for the dashboard.
 *
 * Every query runs through `asUser`, which opens a transaction, switches to the `authenticated` role
 * and sets the JWT claims — the same contract Supabase uses — so row-level security is enforced for
 * the dashboard exactly as it would be through the Supabase API. There is deliberately no helper that
 * queries as the connection owner.
 */

export type Sql = postgres.TransactionSql<Record<string, never>>;
export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

declare global {
  // eslint-disable-next-line no-var
  var __planbSql: postgres.Sql | undefined;
}

function pool(): postgres.Sql {
  if (!globalThis.__planbSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    globalThis.__planbSql = postgres(url, {
      max: 8,
      idle_timeout: 30,
      prepare: false, // compatible with transaction-mode poolers (Supabase pgbouncer/supavisor)
      types: {
        // numeric → number: money values here are well inside float64's exact-integer range
        numeric: { to: 0, from: [1700], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
        bigint: { to: 0, from: [20], serialize: (x: number) => String(x), parse: (x: string) => Number(x) },
        date: { to: 0, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
      },
    });
  }
  return globalThis.__planbSql;
}

export async function asUser<T>(userId: string, fn: (sql: Sql) => Promise<T>): Promise<T> {
  const claims = JSON.stringify({ sub: userId, role: 'authenticated' });
  return pool().begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', ${claims}, true)`;
    return fn(tx as unknown as Sql);
  }) as Promise<T>;
}

/** Turns a database error into a message safe and useful to show an analyst. */
export function dbErrorMessage(error: unknown): string {
  const e = error as { message?: string; code?: string };
  if (e?.code === '42501') return `Not permitted: ${e.message ?? 'your role does not allow this action'}`;
  return e?.message ?? 'Unexpected error';
}

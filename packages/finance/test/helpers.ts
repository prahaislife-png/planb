import type { ModelResult, MonthlyRow, AnnualRow } from '../src/index';

/** Monthly row by monthIndex (negative = pre-operating, 1.. = operating). Throws if missing. */
export function month(result: ModelResult, monthIndex: number): MonthlyRow {
  const row = result.monthly.find((candidate) => candidate.monthIndex === monthIndex);
  if (!row) throw new Error(`no monthly row with monthIndex ${monthIndex}`);
  return row;
}

/** Annual row by year (0 = pre-operating period). Throws if missing. */
export function year(result: ModelResult, yearNumber: number): AnnualRow {
  const row = result.annual.find((candidate) => candidate.year === yearNumber);
  if (!row) throw new Error(`no annual row for year ${yearNumber}`);
  return row;
}

export function warningCodes(result: ModelResult): string[] {
  return result.warnings.map((warning) => warning.code);
}

export function operatingRows(result: ModelResult): MonthlyRow[] {
  return result.monthly.filter((row) => row.phase === 'operating');
}

/** Sum of one numeric field over rows. */
export function sumOf<T extends object>(rows: readonly T[], key: keyof T & string): number {
  return rows.reduce((total, row) => total + (row[key] as unknown as number), 0);
}

/** Deep clone of plain JSON data. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

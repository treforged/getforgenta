/**
 * SAFE TO SPEND SNAPSHOT (ask 1dc2c388; design forged-glass docs/DESIGN-leo-money-glance.md).
 *
 * The dashboard publishes the figure it already shows to `safe_to_spend_snapshot`, so Leo
 * (money-glance) reads the SAME number. One engine, not two.
 *
 * WHEN A ROW IS WRITTEN, and why each guard exists:
 * - Only for `kind === 'figure'`. An empty result writes nothing: an old figure with an honest age
 *   beats a fresh zero.
 * - Never in demo mode (sample data), and never in PARTNER VIEW: there the dashboard shows the
 *   partner's money, and writing it under the viewer's own id would make Leo read out someone
 *   else's figure as theirs.
 * - Only once the figure has SETTLED (unchanged for SETTLE_MS). The dashboard renders interim
 *   figures while its queries load: measured on Tre's account, the first figure was $1,462.31 and the
 *   settled one $1,408.31, and a once-a-minute throttle wrote the interim one and then blocked the
 *   right one. Waiting for the figure to stop moving writes only what the user actually sees.
 * - Then only when the figure changed or the last write is older than REFRESH_MS - so Leo's
 *   "as of" stays honest without a write on every render.
 */
import type { SafeToSpendResult } from '@/lib/safe-to-spend';

export const SETTLE_MS = 5_000;
export const REFRESH_MS = 15 * 60_000;

export interface SafeToSpendSnapshotRow {
  user_id: string;
  amount_cents: number;
  payday: string;
  horizon: string;
  low_point_cents: number;
  low_date: string;
  floor_cents: number;
  computed_at: string;
}

const cents = (dollars: number): number => Math.round(dollars * 100);

/** The row for `result`, or null when nothing should be published. */
export function toSnapshotRow(
  result: SafeToSpendResult | null, userId: string | null | undefined, now: Date,
): SafeToSpendSnapshotRow | null {
  if (!userId || !result || result.kind !== 'figure') return null;
  const nums = [result.amount, result.lowPoint, result.floor];
  if (!nums.every(Number.isFinite)) return null;
  return {
    user_id: userId,
    amount_cents: Math.max(0, cents(result.amount)),
    payday: result.payday,
    horizon: result.horizon,
    low_point_cents: cents(result.lowPoint),
    low_date: result.lowDate,
    floor_cents: Math.max(0, cents(result.floor)),
    computed_at: now.toISOString(),
  };
}

/** The part of a row that, when it changes, makes a write worth it. */
export function snapshotKey(row: SafeToSpendSnapshotRow): string {
  return [row.user_id, row.amount_cents, row.payday, row.horizon, row.low_point_cents, row.low_date, row.floor_cents].join('|');
}

/** Whether a SETTLED `row` is worth writing, given the last write's key and time (ms). */
export function shouldWrite(
  row: SafeToSpendSnapshotRow | null, last: { key: string; at: number } | null, nowMs: number,
): boolean {
  if (!row) return false;
  if (!last) return true;
  return snapshotKey(row) !== last.key || nowMs - last.at >= REFRESH_MS;
}

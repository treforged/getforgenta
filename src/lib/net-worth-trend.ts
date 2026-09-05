/**
 * The two readings the Net Worth History card draws, as pure functions.
 *
 * Both used to live inside `src/pages/Accounts.tsx`. When the chart moved up to
 * the Overview (2026-08-20, Tre: *"move the data and net worth chart from the
 * accounts section to the overview section"*) they came with it, and were
 * extracted here rather than copied so the trend line and the month-over-month
 * figure can never be derived two different ways on two different surfaces —
 * the failure mode `net-worth.ts` was written to end.
 *
 * Neither function invents a reading. With no history at all the trend is the
 * single point the user is standing on, and the caller is expected to SAY that
 * rather than draw a line through one dot; with fewer than two snapshots far
 * enough apart, the monthly change is `null` and the card prints an em dash. A
 * confident `$0` and "no reading yet" look identical on a screen, and only one
 * of them is true.
 */

/** Minimum days between two snapshots for their difference to read as monthly. */
export const MONTHLY_CHANGE_MIN_DAYS = 25;

const MS_PER_DAY = 86_400_000;

/** The snapshot fields a trend needs. `net_worth` arrives as a numeric string from Postgres. */
export interface TrendSnapshotRow {
  snapshot_date: string;
  net_worth: number | string;
}

export interface NetWorthTrendPoint {
  month: string;
  value: number;
}

/**
 * The chart's rows, oldest first.
 *
 * With no snapshots this is a single point at today's live net worth — a
 * truthful "here is where you are", not a trend. Callers check `length <= 1`
 * to decide whether to draw a chart at all.
 */
export function buildNetWorthTrend(
  snapshots: readonly TrendSnapshotRow[],
  currentNetWorth: number,
  now: Date = new Date(),
): NetWorthTrendPoint[] {
  if (snapshots.length === 0) {
    return [{ month: now.toLocaleString('en', { month: 'short' }), value: currentNetWorth }];
  }
  return snapshots.map(s => ({
    month: new Date(s.snapshot_date + 'T00:00:00').toLocaleString('en', { month: 'short', day: 'numeric' }),
    value: Number(s.net_worth),
  }));
}

/**
 * Change against the newest snapshot at least {@link MONTHLY_CHANGE_MIN_DAYS}
 * older than the latest one, or `null` when no such pair exists.
 *
 * The recorder writes weekly, so the naive "last two rows" difference would be a
 * WEEKLY change wearing a monthly label. Walking backwards finds the closest row
 * that is genuinely a month back instead.
 */
export function monthlyNetWorthChange(snapshots: readonly TrendSnapshotRow[]): number | null {
  if (snapshots.length < 2) return null;

  const latest = snapshots[snapshots.length - 1];
  const latestTime = new Date(latest.snapshot_date + 'T00:00:00').getTime();
  if (Number.isNaN(latestTime)) return null;

  for (let i = snapshots.length - 2; i >= 0; i--) {
    const older = snapshots[i];
    const olderTime = new Date(older.snapshot_date + 'T00:00:00').getTime();
    if (Number.isNaN(olderTime)) continue;
    const daysBetween = Math.floor((latestTime - olderTime) / MS_PER_DAY);
    if (daysBetween >= MONTHLY_CHANGE_MIN_DAYS) {
      return Number(latest.net_worth) - Number(older.net_worth);
    }
  }
  return null;
}

/**
 * START THE REVOLVING-BALANCE HISTORY THAT `debt_payoff` NEEDS.
 *
 * `debt_payoff` (leaderboard-metrics.ts) is the share of your PEAK revolving balance you have
 * cleared, so it needs a dated SERIES. None exists: `account_reconciliations` holds one point per
 * card, written only when a user reconciles by hand, and `net_worth_snapshots.total_liabilities`
 * includes the car loan, so every car payment would inflate a "debt paid off" score. Every week
 * nothing is captured is history that can never be recovered, so capture starts now and the metric
 * waits until the series exists. `debt_payoff` STAYS in UNSOURCED_METRICS until then.
 *
 * The value is the ENGINE's month-0 revolving balance - the same figure Dashboard.tsx uses for the
 * payoff hero (`revolvingDebtNow`) - not the raw card balance: a card paid in full each cycle owes
 * money but revolves none.
 *
 * ⚠️ IT FILLS THE WEEKLY NET-WORTH ROW, IT DOES NOT WRITE ITS OWN. The net-worth recorder fires as
 * soon as accounts load, which is usually before the projection is ready. Writing both at once would
 * store null most weeks. So the net-worth row is written as before, and this fills
 * `revolving_balance` on the NEWEST row once a projection exists - never overwriting a recorded
 * value, and never attributing today's balance to a row more than a week old.
 */

/** A `net_worth_snapshots` row, narrowed to what the fill decision reads. */
export interface SnapshotRevolvingRow {
  snapshot_date: string;
  revolving_balance: number | null;
}

/** Days a row may lag `today` and still take today's balance: the recorder's own cadence. */
export const REVOLVING_FILL_MAX_LAG_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/**
 * Total month-0 revolving balance across cards, rounded to cents.
 *
 * `null` when there is no projection (unknown). An empty map is `0`: no cards is a real zero.
 * A missing or non-finite month-0 entry is skipped; a negative one counts as 0.
 */
export function totalRevolvingMonth0(
  monthlyRevolvingBalances: ReadonlyMap<string, readonly number[]> | null | undefined,
): number | null {
  if (!monthlyRevolvingBalances) return null;
  let total = 0;
  for (const balances of monthlyRevolvingBalances.values()) {
    const month0 = balances[0];
    if (month0 === undefined || !Number.isFinite(month0)) continue;
    total += Math.max(0, month0);
  }
  return Math.round(total * 100) / 100;
}

/** Parses 'YYYY-MM-DD' to a UTC day number; NaN for anything else. */
function utcDay(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / MS_PER_DAY;
}

/**
 * The row to fill with `revolving`, or `null` when nothing should be written.
 *
 * Null when: the balance is unknown, non-finite or negative; there is no row; the NEWEST row
 * already carries a value (never overwrite); or the newest row is future-dated, older than
 * {@link REVOLVING_FILL_MAX_LAG_DAYS}, or has a date that does not parse.
 */
export function revolvingFillTarget(
  snapshots: readonly SnapshotRevolvingRow[],
  revolving: number | null,
  today: string,
): { snapshot_date: string; revolving_balance: number } | null {
  if (revolving === null || !Number.isFinite(revolving) || revolving < 0) return null;

  let newest: SnapshotRevolvingRow | null = null;
  for (const row of snapshots) {
    if (newest === null || row.snapshot_date > newest.snapshot_date) newest = row;
  }
  if (newest === null || newest.revolving_balance !== null) return null;

  const lag = utcDay(today) - utcDay(newest.snapshot_date);
  // A NaN lag passes neither comparison below, so it must be refused explicitly.
  if (!Number.isFinite(lag) || lag < 0 || lag > REVOLVING_FILL_MAX_LAG_DAYS) return null;

  return { snapshot_date: newest.snapshot_date, revolving_balance: revolving };
}

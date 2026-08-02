/**
 * Net-worth snapshot aggregation and cadence rules.
 *
 * Extracted verbatim from the former `src/pages/NetWorth.tsx` so that snapshot
 * recording no longer depends on that page being mounted. When `/net-worth`
 * became a redirect to `/accounts`, the page stopped rendering and took the only
 * writer of `net_worth_snapshots` with it — recording silently died on
 * 2026-05-22 and the Accounts "Net Worth History" chart froze.
 *
 * The maths below is a straight port and must stay that way: live accounts
 * (credit cards are liabilities, everything else an asset) plus any manual
 * asset/liability whose name does not already appear in the live set. Narrowing
 * it to live accounts only would silently drop manual rows and put a step change
 * in the middle of every user's history.
 */

/** Minimum days between two recorded snapshots. */
export const SNAPSHOT_INTERVAL_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/** Postgres `numeric` columns arrive as strings, so money is widened here. */
type Money = number | string;

export interface SnapshotAccount {
  name: string;
  account_type: string;
  balance: Money;
  active: boolean;
}

export interface SnapshotManualAsset {
  name: string;
  value: Money;
}

export interface SnapshotManualLiability {
  name: string;
  balance: Money;
}

export interface NetWorthTotals {
  totalAssets: number;
  totalLiabilities: number;
  netWorth: number;
}

/** Snapshot rows only need their date to answer the cadence question. */
export interface SnapshotDateRow {
  snapshot_date: string;
}

const sum = (values: readonly Money[]): number =>
  values.reduce<number>((total, value) => total + Number(value), 0);

const namesOf = (rows: readonly { name: string }[]): ReadonlySet<string> =>
  new Set(rows.map(r => r.name.toLowerCase()));

/**
 * Total assets, liabilities and net worth across live accounts plus any manual
 * rows that do not duplicate a live account by name.
 */
export function aggregateNetWorth(
  accounts: readonly SnapshotAccount[],
  manualAssets: readonly SnapshotManualAsset[],
  manualLiabilities: readonly SnapshotManualLiability[],
): NetWorthTotals {
  const active = accounts.filter(a => a.active);
  const liveAssets = active.filter(a => a.account_type !== 'credit_card');
  const liveLiabilities = active.filter(a => a.account_type === 'credit_card');

  const liveAssetNames = namesOf(liveAssets);
  const liveLiabilityNames = namesOf(liveLiabilities);

  const totalAssets =
    sum(liveAssets.map(a => a.balance)) +
    sum(manualAssets.filter(a => !liveAssetNames.has(a.name.toLowerCase())).map(a => a.value));

  const totalLiabilities =
    sum(liveLiabilities.map(l => l.balance)) +
    sum(
      manualLiabilities
        .filter(l => !liveLiabilityNames.has(l.name.toLowerCase()))
        .map(l => l.balance),
    );

  return { totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities };
}

/** Guards against writing an empty snapshot before any data has loaded. */
export function hasRecordableData({ totalAssets, totalLiabilities }: NetWorthTotals): boolean {
  return totalAssets !== 0 || totalLiabilities !== 0;
}

/**
 * True when the newest snapshot is at least {@link SNAPSHOT_INTERVAL_DAYS} old,
 * or when none has ever been recorded. Takes the max date rather than trusting
 * the array to be sorted.
 */
export function shouldRecordSnapshot(
  snapshots: readonly SnapshotDateRow[],
  now: Date = new Date(),
): boolean {
  if (snapshots.length === 0) return true;

  const newest = snapshots.reduce<number>((latest, row) => {
    const time = new Date(row.snapshot_date).getTime();
    return Number.isNaN(time) ? latest : Math.max(latest, time);
  }, Number.NEGATIVE_INFINITY);

  if (newest === Number.NEGATIVE_INFINITY) return true;

  return Math.floor((now.getTime() - newest) / MS_PER_DAY) >= SNAPSHOT_INTERVAL_DAYS;
}

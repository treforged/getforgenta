/**
 * Net-worth snapshot cadence rules.
 *
 * Extracted from the former `src/pages/NetWorth.tsx` so that snapshot recording
 * no longer depends on that page being mounted. When `/net-worth` became a
 * redirect to `/accounts`, the page stopped rendering and took the only writer
 * of `net_worth_snapshots` with it — recording silently died on 2026-05-22 and
 * the Accounts "Net Worth History" chart froze.
 *
 * The aggregation itself now lives in `src/lib/net-worth.ts`, shared with the
 * Dashboard tile, the Dashboard breakdown list and the Accounts tiles, so a
 * snapshot records the same number those surfaces display. Narrowing it to live
 * accounts only would silently drop manual rows and put a step change in the
 * middle of every user's history.
 */

import type { NetWorthTotals } from './net-worth';

/** Minimum days between two recorded snapshots. */
export const SNAPSHOT_INTERVAL_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/** Snapshot rows only need their date to answer the cadence question. */
export interface SnapshotDateRow {
  snapshot_date: string;
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

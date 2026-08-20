/**
 * Where each account sits in the Balances list, and the minimum set of writes to keep it there.
 *
 * Pure and list-shaped on purpose: the caller holds a draft copy of the list so a drag or a tap
 * moves the rows at once instead of waiting on the round trip, exactly as
 * `SurplusRankingSection` does with `surplus-ranking.ts`.
 *
 * ⚠️ THE FILTER IS THE TRAP THIS FILE EXISTS FOR. The Balances list is filtered by
 * All / Assets / Liabilities, so the rows a user can see are usually a SLICE of what is stored.
 * A reorder computed against the slice writes positions that look scrambled the moment the filter
 * changes — move the second liability up while filtered and, unfiltered, it has not passed the
 * asset actually sitting above it. Every function here therefore takes the FULL list and returns
 * a new FULL list; the visible slice is passed separately, and only ever to work out which row
 * counts as "the one above".
 *
 * `sort_order` is display only. No engine reads it — see the column comment in
 * `supabase/migrations/20260820_accounts_sort_order.sql`.
 */

/** The least this module needs of an account row. */
export type Orderable = { id: string; sort_order?: number | null };

/**
 * Move `fromId` into `toId`'s slot in the full list.
 *
 * Index semantics match `moveSurplusRankRow`: the destination index is read BEFORE the removal,
 * so a downward move lands after the target and an upward move lands before it — which is what a
 * drop on a row reads as in both directions.
 */
export function moveAccountTo<T extends Orderable>(
  all: readonly T[], fromId: string, toId: string,
): T[] {
  const from = all.findIndex(a => a.id === fromId);
  const to = all.findIndex(a => a.id === toId);
  if (from < 0 || to < 0 || from === to) return [...all];
  const next = [...all];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Move `id` one place up (`-1`) or down (`+1`) as the user SEES the list — the touch half of the
 * reorder, where there is no HTML5 drag.
 *
 * `visibleIds` is the rendered (possibly filtered) order. The step is measured there, so one tap
 * always moves the row past exactly one row the user can see; the resulting position is then
 * expressed against the full list. A move off either end of the visible slice is a no-op.
 */
export function moveAccountBy<T extends Orderable>(
  all: readonly T[], visibleIds: readonly string[], id: string, delta: number,
): T[] {
  const at = visibleIds.indexOf(id);
  if (at < 0) return [...all];
  const neighbour = visibleIds[at + delta];
  if (neighbour === undefined) return [...all];
  return moveAccountTo(all, id, neighbour);
}

/**
 * The minimum set of `{ id, sort_order }` writes that takes the stored order to `after`.
 *
 * Only rows whose rank actually changed are emitted, because every one is a round trip: dragging
 * a row from the bottom to the top moves every row, but dragging it one place moves two.
 */
export function planAccountOrderWrites<T extends Orderable>(
  after: readonly T[],
): { id: string; sort_order: number }[] {
  const writes: { id: string; sort_order: number }[] = [];
  after.forEach((row, i) => {
    if (row.sort_order !== i) writes.push({ id: row.id, sort_order: i });
  });
  return writes;
}

/**
 * The rank a newly added account should take: after everything the user already has.
 *
 * The column defaults to 0, which would seat a new account at the TOP — the opposite of the
 * `created_at` ordering it replaced, where a new account appeared last. This keeps that.
 */
export function nextAccountSortOrder(all: readonly Orderable[]): number {
  return all.reduce((max, a) => Math.max(max, (a.sort_order ?? 0) + 1), 0);
}

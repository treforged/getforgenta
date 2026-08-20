/**
 * The user's ranked list of "where the extra money goes", as a UI sees it.
 *
 * `buildRankedTargets` (ranked-extra-payment-targets.ts) turns rows into the ALLOCATOR's input;
 * this module turns the same rows into the LIST the user drags. They are deliberately separate:
 * the allocator's input carries minimums and capacities and seats the card block at a fractional
 * rank, while this one carries names and a dense integer index, which is the only thing that can
 * be written back to `savings_goals.sort_order`, `car_funds.sort_order` and
 * `profiles.cards_sort_order`.
 *
 * Pure: no database, no clock, no React.
 *
 * WHY THE CARDS ARE ONE ROW. Same reason as `buildRankedTargets` — the payoff strategy orders the
 * cards among themselves on marginal APR, and letting a user drag one card above another would
 * silently override the strategy they chose. The user ranks the BLOCK.
 */

import { carFundRemainingNeed, goalRemainingNeed, type RankableGoal } from './ranked-extra-payment-targets';
import type { CarFund } from './types';

/**
 * The id the card block carries in this list. Not a uuid and never written to a row — on save it
 * becomes the INDEX stored in `profiles.cards_sort_order`.
 */
export const CARDS_ROW_ID = '__cards__';

export type SurplusRankKind = 'cards' | 'goal' | 'car_fund';

export type SurplusRankRow = {
  /** A uuid for goals and car funds; `CARDS_ROW_ID` for the card block. */
  id: string;
  kind: SurplusRankKind;
  /** What the user calls it. */
  name: string;
  /** Rank, ascending. Dense (0,1,2…) after any reorder; whatever the DB holds before one. */
  sortOrder: number;
  /**
   * Whether this row takes automatic extra payments. Always true for the cards — there is no such
   * thing as opting the cards out of the surplus, and the row exists so a goal can be ranked
   * ABOVE them, not so the debt can be switched off.
   */
  autoExtra: boolean;
  /** Remaining need in dollars, display only. `null` for the cards, whose figure comes from the
   * converged month-0 breakdown rather than from a row. */
  remaining: number | null;
  /** Tie-break for rows that share a `sortOrder` — matches the `.order('created_at')` both list
   * queries actually use. */
  createdAt: string;
};

export type BuildSurplusRankRowsParams = {
  goals: readonly (RankableGoal & { name?: string | null; created_at?: string | null })[];
  carFunds: readonly CarFund[];
  /** `profiles.cards_sort_order`. Absent ⇒ 0, cards first, today's behaviour. */
  cardsSortOrder?: number;
  /** The account surplus is deployed from — a car fund linked elsewhere reads its own balance. */
  fundingAccountId?: string | null;
  /** Live balance per account id, for `getCarFundSaved`. */
  accountBalances?: Readonly<Record<string, number>>;
};

/**
 * Ranked ascending, ties broken on `created_at` then id — EXCEPT that the cards win any tie.
 *
 * The cards winning ties is not cosmetic: `computeAutoExtraReserve` seats the block half a rank
 * ahead of its nominal position for exactly the same reason, so a list that broke the tie the
 * other way would show an order the engine does not follow.
 */
export function compareSurplusRankRows(a: SurplusRankRow, b: SurplusRankRow): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  if (a.kind !== b.kind) {
    if (a.kind === 'cards') return -1;
    if (b.kind === 'cards') return 1;
  }
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Every rankable thing the user owns, in the order the engine will read it.
 *
 * A goal or car fund with nothing left to fund is still listed: it is still a row the user can
 * rank, and hiding it would make the list jump around as balances move.
 */
export function buildSurplusRankRows(p: BuildSurplusRankRowsParams): SurplusRankRow[] {
  const { goals, carFunds, cardsSortOrder = 0, fundingAccountId = null, accountBalances = {} } = p;

  const balanceOf = (accountId: string | null) =>
    accountId != null && accountId in accountBalances ? accountBalances[accountId] : null;

  const goalRows: SurplusRankRow[] = goals
    .filter((g): g is typeof g & { id: string } => typeof g.id === 'string')
    .map(g => ({
      id: g.id,
      kind: 'goal' as const,
      name: (g.name ?? '').trim() || 'Untitled goal',
      sortOrder: Number(g.sort_order) || 0,
      autoExtra: g.auto_extra === true,
      remaining: goalRemainingNeed(g),
      createdAt: g.created_at ?? '',
    }));

  // ⚠️ A car fund in its LOAN phase is not in this list at all. `carFundRemainingNeed` gives it a
  // need of 0 — the down payment is spent and the monthly loan payment is a bill, not a rankable
  // extra — so it can never receive a ranked dollar. Listing it would print "Fully funded" next to
  // a vehicle the user still owes on, which is a lie, and would offer a rank that does nothing.
  const carRows: SurplusRankRow[] = carFunds.filter(f => f.phase === 'saving').map(f => ({
    id: f.id,
    kind: 'car_fund' as const,
    name: (f.vehicle_name ?? '').trim() || 'Vehicle',
    sortOrder: Number(f.sort_order) || 0,
    autoExtra: f.auto_extra === true,
    remaining: carFundRemainingNeed(f, fundingAccountId, balanceOf(f.linked_account)),
    createdAt: f.created_at ?? '',
  }));

  const cardsRow: SurplusRankRow = {
    id: CARDS_ROW_ID,
    kind: 'cards',
    name: 'Credit cards',
    sortOrder: Number(cardsSortOrder) || 0,
    autoExtra: true,
    remaining: null,
    createdAt: '',
  };

  return [cardsRow, ...carRows, ...goalRows].sort(compareSurplusRankRows);
}

/** Re-index a list so the ranks are dense and gap-free, which is what the writes below store. */
function densify(rows: readonly SurplusRankRow[]): SurplusRankRow[] {
  return rows.map((r, i) => (r.sortOrder === i ? r : { ...r, sortOrder: i }));
}

/**
 * Move `fromId` to `toId`'s position. Returns a new densely-ranked list; the input is untouched.
 * An unknown id or a no-op move returns the list densified and otherwise unchanged.
 */
export function moveSurplusRankRow(
  rows: readonly SurplusRankRow[], fromId: string, toId: string,
): SurplusRankRow[] {
  const from = rows.findIndex(r => r.id === fromId);
  const to = rows.findIndex(r => r.id === toId);
  if (from < 0 || to < 0 || from === to) return densify(rows);
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return densify(next);
}

/**
 * Move `id` up (`-1`) or down (`+1`) by one place — the touch half of the reorder, where there is
 * no HTML5 drag. A move off either end is a no-op.
 */
export function moveSurplusRankRowBy(
  rows: readonly SurplusRankRow[], id: string, delta: number,
): SurplusRankRow[] {
  const from = rows.findIndex(r => r.id === id);
  if (from < 0) return densify(rows);
  const to = from + delta;
  if (to < 0 || to >= rows.length) return densify(rows);
  return moveSurplusRankRow(rows, id, rows[to].id);
}

/** Set one row's `auto_extra`. The cards row cannot be opted out and is returned unchanged. */
export function setSurplusRankAutoExtra(
  rows: readonly SurplusRankRow[], id: string, autoExtra: boolean,
): SurplusRankRow[] {
  return rows.map(r => (r.id === id && r.kind !== 'cards' ? { ...r, autoExtra } : r));
}

export type SurplusRankWrites = {
  goals: { id: string; sort_order?: number; auto_extra?: boolean }[];
  carFunds: { id: string; sort_order?: number; auto_extra?: boolean }[];
  /** `profiles.cards_sort_order`, or `null` when the card block did not move. */
  cardsSortOrder: number | null;
};

/**
 * The minimum set of writes that takes `before` to `after`.
 *
 * Only changed fields are emitted, because every write is a round trip and a drag that moves one
 * row to the top would otherwise rewrite every other row for nothing. Rows that are new or gone
 * between the two lists are ignored — this plans an edit, not a sync.
 */
export function planSurplusRankWrites(
  before: readonly SurplusRankRow[], after: readonly SurplusRankRow[],
): SurplusRankWrites {
  const prev = new Map(before.map(r => [r.id, r]));
  const writes: SurplusRankWrites = { goals: [], carFunds: [], cardsSortOrder: null };

  for (const row of after) {
    const was = prev.get(row.id);
    if (!was) continue;
    if (row.kind === 'cards') {
      if (was.sortOrder !== row.sortOrder) writes.cardsSortOrder = row.sortOrder;
      continue;
    }
    const patch: { id: string; sort_order?: number; auto_extra?: boolean } = { id: row.id };
    if (was.sortOrder !== row.sortOrder) patch.sort_order = row.sortOrder;
    if (was.autoExtra !== row.autoExtra) patch.auto_extra = row.autoExtra;
    if (patch.sort_order === undefined && patch.auto_extra === undefined) continue;
    (row.kind === 'goal' ? writes.goals : writes.carFunds).push(patch);
  }

  return writes;
}

/** True when there is nothing to send. Lets a caller skip the toast as well as the round trips. */
export function isSurplusRankWritesEmpty(w: SurplusRankWrites): boolean {
  return w.goals.length === 0 && w.carFunds.length === 0 && w.cardsSortOrder === null;
}

/**
 * The user's ranked list of "where the extra money goes", as a UI sees it.
 *
 * `buildRankedTargets` (ranked-extra-payment-targets.ts) turns rows into the ALLOCATOR's input;
 * this module turns the same rows into the LIST the user drags. They are deliberately separate:
 * the allocator's input carries minimums and capacities and seats the card block at a fractional
 * rank, while this one carries names and a dense integer index, which is the only thing that can
 * be written back to `savings_goals.sort_order`, `car_funds.sort_order`,
 * `accounts.surplus_sort_order` and `profiles.cards_sort_order`.
 *
 * Pure: no database, no clock, no React.
 *
 * ── THE LIST IS GROUPS, NOT ROWS (2026-08-21) ────────────────────────────────
 * A rank used to be one row. It is now a GROUP of one or more rows sharing a `sortOrder`, because
 * Tre's own ranking cannot be said any other way: "move fund split with discover. the savings
 * split with extra car payments." Every ordering operation here therefore moves a row between
 * groups rather than between indices, and `sortOrder` is the group's index — so two rows in one
 * group genuinely carry the same number, which is exactly what `allocateRankedSurplus` reads as a
 * split. A list where every group has one member is the old list, integer for integer.
 *
 * ── WHY THE CARDS CAN BE ONE ROW *OR* SEVERAL ────────────────────────────────
 * By default they are one row: the payoff strategy orders the cards among themselves on marginal
 * APR, and letting a user drag one card above another would silently override the strategy they
 * chose. But a single block row cannot express "fund the move AFTER the Visa and BEFORE the
 * Discover", so a card can be pulled OUT of the block (`accounts.surplus_sort_order`) and ranked
 * on its own. What that buys is a place for a goal to sit BETWEEN two cards; it does not reorder
 * the payoff — see `RankedTarget.rankedIndividually`.
 */

import {
  carFundRemainingNeed, carLoanRemainingNeed, goalRemainingNeed,
  type RankableGoal, type RankableLiability,
} from './ranked-extra-payment-targets';
import type { CarFund } from './types';

/**
 * The id the card block carries in this list. Not a uuid and never written to a row — on save it
 * becomes the INDEX stored in `profiles.cards_sort_order`.
 */
export const CARDS_ROW_ID = '__cards__';

/** The default weight both sides of a new split get. Only the RATIO is ever read, so 50/50 is
 *  "half each" and the number itself is arbitrary; 50 reads as a percentage to a human. */
export const DEFAULT_SPLIT_SHARE = 50;

/**
 * `loan` is the VEHICLE loan (a `car_funds` row in its loan phase); `liability` is any other
 * non-credit-card debt the app can model — a student loan, a mortgage, an `other_liability`
 * account paired to a `debts` row. Separate kinds because they are stored in different tables and
 * credited from different projections; see `RankedTargetKind`.
 */
export type SurplusRankKind = 'cards' | 'card' | 'goal' | 'car_fund' | 'loan' | 'liability';

export type SurplusRankRow = {
  /** A uuid for goals, car funds, loans and individually-ranked cards; `CARDS_ROW_ID` for the
   *  block of cards that have not been pulled out. */
  id: string;
  kind: SurplusRankKind;
  /** What the user calls it. */
  name: string;
  /** Rank, ascending. This is the GROUP index: rows that share it are one split rank. */
  sortOrder: number;
  /**
   * Whether this row takes automatic extra payments. Always true for the cards — there is no such
   * thing as opting the cards out of the surplus, and the row exists so a goal can be ranked
   * ABOVE them, not so the debt can be switched off.
   */
  autoExtra: boolean;
  /** Remaining need in dollars, display only. `null` for the card block, whose figure comes from
   * the converged month-0 breakdown rather than from a row. */
  remaining: number | null;
  /**
   * This row's weight within its split rank, or `null` when it wants no split. Rows alone in
   * their group carry `null`; a `null` in a group of two means the OTHER row's weight decides
   * nothing, and the rank falls back to filling in order — which the UI avoids by writing both
   * weights whenever it joins two rows.
   */
  share: number | null;
  /** What this row is trying to reach, and by when, when it has an answer — a goal's
   * `target_amount` / `target_date`, a car fund's down payment / planned purchase. `null` where
   * the concept does not apply (a card, the block, a loan being paid down rather than filled). */
  targetAmount: number | null;
  targetDate: string | null;
  /** Tie-break for rows that share a `sortOrder` — matches the `.order('created_at')` both list
   * queries actually use. */
  createdAt: string;
};

/** The least this module needs of a credit-card `accounts` row. */
export type RankableCard = {
  id: string;
  name?: string | null;
  balance?: number | null;
  /** `accounts.surplus_sort_order`. Non-null ⇒ pulled out of the block and ranked on its own. */
  surplus_sort_order?: number | null;
  surplus_share?: number | null;
  created_at?: string | null;
};

export type BuildSurplusRankRowsParams = {
  goals: readonly (RankableGoal & {
    name?: string | null; created_at?: string | null; target_date?: string | null;
  })[];
  carFunds: readonly CarFund[];
  /** Credit cards, so the ones the user has pulled out of the block get their own rows. Omitted ⇒
   *  no card is individually ranked, which is the pre-2026-08-21 list exactly. */
  cards?: readonly RankableCard[];
  /** Debt-serviced non-CC liabilities. Only the ones the user has already RANKED become rows;
   *  omitted ⇒ none, which is the pre-2026-08-24 list exactly. */
  liabilities?: readonly RankableLiability[];
  /** `profiles.cards_sort_order`. Absent ⇒ 0, cards first, today's behaviour. */
  cardsSortOrder?: number;
  /** `profiles.cards_surplus_share`. */
  cardsShare?: number | null;
  /** The account surplus is deployed from — a car fund linked elsewhere reads its own balance. */
  fundingAccountId?: string | null;
  /** Live balance per account id, for `getCarFundSaved`. */
  accountBalances?: Readonly<Record<string, number>>;
};

/** A stored weight, or null. Zero, negative and unparseable are not weights. */
function readShare(raw: number | null | undefined): number | null {
  const n = Number(raw);
  return raw == null || !Number.isFinite(n) || n <= 0 ? null : n;
}

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
  const {
    goals, carFunds, cards = [], liabilities = [], cardsSortOrder = 0, cardsShare = null,
    fundingAccountId = null, accountBalances = {},
  } = p;

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
      share: readShare(g.surplus_share),
      targetAmount: Number(g.target_amount) || null,
      targetDate: g.target_date ?? null,
      createdAt: g.created_at ?? '',
    }));

  // A SAVING-phase car fund is a thing being filled; a LOAN-phase one is a debt being paid down.
  // Both are rankable and they are mutually exclusive, so the same row appears exactly once, with
  // the kind that matches its phase. Before 2026-08-21 a loan-phase fund was in NEITHER list —
  // `carFundRemainingNeed` gives it 0, so it could never take a ranked dollar and listing it would
  // have printed "Fully funded" next to a vehicle the user still owes on.
  const carRows: SurplusRankRow[] = carFunds.filter(f => f.phase === 'saving').map(f => ({
    id: f.id,
    kind: 'car_fund' as const,
    name: (f.vehicle_name ?? '').trim() || 'Vehicle',
    sortOrder: Number(f.sort_order) || 0,
    autoExtra: f.auto_extra === true,
    remaining: carFundRemainingNeed(f, fundingAccountId, balanceOf(f.linked_account)),
    share: readShare(f.surplus_share),
    targetAmount: Number(f.down_payment_goal) || null,
    targetDate: f.planned_purchase_date ?? null,
    createdAt: f.created_at ?? '',
  }));

  const loanRows: SurplusRankRow[] = carFunds.filter(f => f.phase === 'loan').map(f => ({
    id: f.id,
    kind: 'loan' as const,
    name: `${(f.vehicle_name ?? '').trim() || 'Vehicle'} loan`,
    sortOrder: Number(f.sort_order) || 0,
    autoExtra: f.auto_extra === true,
    remaining: carLoanRemainingNeed(f),
    share: readShare(f.surplus_share),
    // A loan is paid DOWN, not filled: there is no amount it is trying to reach and no date it is
    // trying to reach it by, and inventing one would be a number nobody could stand behind.
    targetAmount: null,
    targetDate: null,
    createdAt: f.created_at ?? '',
  }));

  // A student loan / mortgage is listed only once the user has RANKED it, and that is the whole
  // opt-in: `accounts` has no `auto_extra` column, so unlike a goal or a car fund there is nowhere
  // to record "in the list but switched off". Being here IS opted in, exactly as a card pulled out
  // of the block is. It is also what keeps every existing user's list byte-identical — the column
  // is null on every row until the feature is used — and it is why `autoExtra` below is a literal
  // `true` rather than a column read that would silently be `undefined`.
  //
  // The rows the user has NOT ranked are not lost: `useSurplusRanking` returns them separately so
  // the UI can offer them, the same shape it already uses for cards still inside the block.
  const liabilityRows: SurplusRankRow[] = liabilities
    .filter(l => l.surplus_sort_order != null && Number.isFinite(Number(l.surplus_sort_order)))
    .map(l => ({
      id: l.id,
      kind: 'liability' as const,
      name: (l.name ?? '').trim() || 'Loan',
      sortOrder: Number(l.surplus_sort_order),
      autoExtra: true,
      remaining: Math.max(0, Number(l.balance) || 0),
      share: readShare(l.surplus_share),
      // Paid DOWN, not filled — the same reason the vehicle loan carries neither.
      targetAmount: null,
      targetDate: null,
      createdAt: l.created_at ?? '',
    }));

  const soloCards = cards.filter(c => c.surplus_sort_order != null && Number.isFinite(Number(c.surplus_sort_order)));
  const cardRows: SurplusRankRow[] = soloCards.map(c => ({
    id: c.id,
    kind: 'card' as const,
    name: (c.name ?? '').trim() || 'Credit card',
    sortOrder: Number(c.surplus_sort_order),
    autoExtra: true,
    remaining: Math.max(0, Number(c.balance) || 0),
    share: readShare(c.surplus_share),
    targetAmount: null,
    targetDate: null,
    createdAt: c.created_at ?? '',
  }));

  // The block row disappears when every card has been pulled out of it: a row standing for nothing
  // is a rank the user can drag that changes no money at all.
  const blockIsEmpty = cards.length > 0 && soloCards.length === cards.length;
  const cardsRow: SurplusRankRow[] = blockIsEmpty ? [] : [{
    id: CARDS_ROW_ID,
    kind: 'cards',
    name: 'Credit cards',
    sortOrder: Number(cardsSortOrder) || 0,
    autoExtra: true,
    remaining: null,
    share: readShare(cardsShare),
    targetAmount: null,
    targetDate: null,
    createdAt: '',
  }];

  return [...cardsRow, ...cardRows, ...carRows, ...loanRows, ...liabilityRows, ...goalRows]
    .sort(compareSurplusRankRows);
}

// ── GROUPS ───────────────────────────────────────────────────────────────────
//
// Everything below treats the list as an ordered array of RANKS, each holding one or more rows.
// Working in groups rather than indices is what lets a split survive a drag: a row that moves
// leaves its group, and the rows it leaves behind stay together.

/**
 * Consecutive rows that share a `sortOrder` AND both carry a weight, in list order. Assumes the
 * input is already sorted.
 *
 * ⚠️ THE WEIGHT IS PART OF THE TEST, and that is not fussiness. Plenty of stored rows share a
 * `sort_order` by accident — the column defaults to 0, so a user who has never reordered anything
 * has every row at rank 0 — and reading those as one enormous split would silently divide their
 * surplus across everything they own. A split is a thing the user made, and the mark of having
 * made it is that both sides carry a weight, which is exactly what `joinSurplusRankRow` writes.
 *
 * It also keeps this module in step with the allocator, which falls back to a strict sequence for
 * a rank where no usable weight is present.
 */
function toGroups(rows: readonly SurplusRankRow[]): SurplusRankRow[][] {
  const groups: SurplusRankRow[][] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    const joins = last
      && last[0].sortOrder === row.sortOrder
      && row.share !== null
      && last[last.length - 1].share !== null;
    if (joins) last.push(row);
    else groups.push([row]);
  }
  return groups;
}

/** Flatten groups back to a list, re-numbering so the ranks are dense and gap-free. Rows that did
 *  not move keep their identity, so a caller diffing against the previous list sees no write. */
function fromGroups(groups: readonly (readonly SurplusRankRow[])[]): SurplusRankRow[] {
  const out: SurplusRankRow[] = [];
  let rank = 0;
  for (const group of groups) {
    if (group.length === 0) continue;
    for (const row of group) out.push(row.sortOrder === rank ? row : { ...row, sortOrder: rank });
    rank += 1;
  }
  return out;
}

/** Re-index a list so the ranks are dense and gap-free, preserving which rows share a rank. */
function densify(rows: readonly SurplusRankRow[]): SurplusRankRow[] {
  return fromGroups(toGroups(rows));
}

/**
 * Move `fromId` to `toId`'s position. Returns a new densely-ranked list; the input is untouched.
 * An unknown id or a no-op move returns the list densified and otherwise unchanged.
 *
 * The moved row always lands in a rank of ITS OWN, immediately before the group it was dropped on
 * (or after it, when travelling downwards — the same read a drop has in both directions). Dropping
 * a row onto one half of a split therefore does not silently join the split; joining is a separate,
 * deliberate act (`joinSurplusRankRow`), because a split changes where money goes and an accidental
 * drag should not be able to make one.
 */
export function moveSurplusRankRow(
  rows: readonly SurplusRankRow[], fromId: string, toId: string,
): SurplusRankRow[] {
  if (fromId === toId) return densify(rows);
  const groups = toGroups(rows).map(g => [...g]);
  const fromGroupIdx = groups.findIndex(g => g.some(r => r.id === fromId));
  const toGroupIdx = groups.findIndex(g => g.some(r => r.id === toId));
  if (fromGroupIdx < 0 || toGroupIdx < 0) return densify(rows);

  const moved = groups[fromGroupIdx].find(r => r.id === fromId)!;
  groups[fromGroupIdx] = groups[fromGroupIdx].filter(r => r.id !== fromId);

  // A row leaving a split is no longer sharing anything, and a partner left alone is not either.
  const stripped: SurplusRankRow = moved.share === null ? moved : { ...moved, share: null };
  if (groups[fromGroupIdx].length === 1 && groups[fromGroupIdx][0].share !== null) {
    groups[fromGroupIdx] = [{ ...groups[fromGroupIdx][0], share: null }];
  }

  const insertAt = toGroupIdx + (toGroupIdx > fromGroupIdx ? 1 : 0);
  groups.splice(insertAt, 0, [stripped]);
  return fromGroups(groups.filter(g => g.length > 0));
}

/**
 * Move `id` up (`-1`) or down (`+1`) by one RANK — the touch half of the reorder, where there is
 * no HTML5 drag. A move off either end is a no-op.
 *
 * One tap crosses one rank, not one row, so a tap next to a split moves past the whole split
 * rather than landing invisibly "inside" it.
 */
export function moveSurplusRankRowBy(
  rows: readonly SurplusRankRow[], id: string, delta: number,
): SurplusRankRow[] {
  const groups = toGroups(rows);
  const at = groups.findIndex(g => g.some(r => r.id === id));
  if (at < 0) return densify(rows);
  // A row inside a split "moves up" by leaving the split first — it is already at that rank.
  if (groups[at].length > 1) return separateSurplusRankRow(rows, id, delta >= 0 ? 1 : -1);
  const to = groups[at + delta];
  if (!to) return densify(rows);
  return moveSurplusRankRow(rows, id, to[0].id);
}

/**
 * Join `id`'s rank to the rank ABOVE it, making the two share their money instead of the upper one
 * filling first. Both sides get an explicit weight, because a split where only one side has one is
 * not a split at all — `allocateRankedSurplus` falls back to sequence when no usable weight is
 * present, and a rank that LOOKS split but pays sequentially is the worst of both.
 *
 * The card block can be joined like anything else. A row already at the top, or an unknown id,
 * returns the list unchanged.
 */
export function joinSurplusRankRow(
  rows: readonly SurplusRankRow[], id: string, share = DEFAULT_SPLIT_SHARE,
): SurplusRankRow[] {
  const groups = toGroups(rows).map(g => [...g]);
  const at = groups.findIndex(g => g.some(r => r.id === id));
  if (at <= 0) return densify(rows);
  const row = groups[at].find(r => r.id === id)!;
  groups[at] = groups[at].filter(r => r.id !== id);
  groups[at - 1] = [
    ...groups[at - 1].map(r => (r.share === null ? { ...r, share } : r)),
    { ...row, share: row.share ?? share },
  ];
  return fromGroups(groups.filter(g => g.length > 0));
}

/**
 * Pull `id` out of the split it is in and give it a rank of its own, `direction` places away
 * (`+1` below the split, `-1` above it). A row that is already alone at its rank is returned
 * unchanged; the partners it leaves behind lose their weights if only one of them is left.
 */
export function separateSurplusRankRow(
  rows: readonly SurplusRankRow[], id: string, direction: 1 | -1 = 1,
): SurplusRankRow[] {
  const groups = toGroups(rows).map(g => [...g]);
  const at = groups.findIndex(g => g.some(r => r.id === id));
  if (at < 0 || groups[at].length < 2) return densify(rows);
  const row = groups[at].find(r => r.id === id)!;
  groups[at] = groups[at].filter(r => r.id !== id);
  if (groups[at].length === 1 && groups[at][0].share !== null) {
    groups[at] = [{ ...groups[at][0], share: null }];
  }
  groups.splice(direction === 1 ? at + 1 : at, 0, [{ ...row, share: null }]);
  return fromGroups(groups.filter(g => g.length > 0));
}

/** Set one row's weight within its split. A row that is not in a split cannot have one — its
 *  weight would be a number with nothing to be a ratio against. */
export function setSurplusRankShare(
  rows: readonly SurplusRankRow[], id: string, share: number,
): SurplusRankRow[] {
  const groups = toGroups(rows);
  const at = groups.findIndex(g => g.some(r => r.id === id));
  if (at < 0 || groups[at].length < 2 || !(share > 0)) return [...rows];
  return rows.map(r => (r.id === id ? { ...r, share } : r));
}

/**
 * Set one row's `auto_extra`. The cards row cannot be opted out and is returned unchanged.
 *
 * ⚠️ NEITHER CAN A LIABILITY, and for a different reason: there is no `accounts.auto_extra`
 * column to write it to. Letting the toggle flip in memory would have produced the worst possible
 * result — a switch that moves, a `planSurplusRankWrites` that emits nothing for it, and a state
 * that silently reverts on the next refetch. A liability leaves the list by leaving the LIST
 * (`planLiabilityRankWrites`), which is a write that exists.
 */
export function setSurplusRankAutoExtra(
  rows: readonly SurplusRankRow[], id: string, autoExtra: boolean,
): SurplusRankRow[] {
  return rows.map(r => (
    r.id === id && r.kind !== 'cards' && r.kind !== 'card' && r.kind !== 'liability'
      ? { ...r, autoExtra }
      : r
  ));
}

export type SurplusRankWrites = {
  goals: { id: string; sort_order?: number; auto_extra?: boolean; surplus_share?: number | null }[];
  carFunds: { id: string; sort_order?: number; auto_extra?: boolean; surplus_share?: number | null }[];
  /**
   * `accounts` rows for cards that have been pulled out of the block, or put back into it —
   * `surplus_sort_order: null` is the "back in the block" write, not a no-op.
   *
   * Ranked LIABILITIES ride this same list. The field keeps its name because it is the `accounts`
   * write channel and a liability is an `accounts` row: one table, one `Promise.all` entry, and
   * the caller does not have to learn a second one. `surplus_sort_order: null` there means "off
   * the ranked list" rather than "back in the block", which is the only sense a debt with no
   * block can make of it.
   */
  cards: { id: string; surplus_sort_order?: number | null; surplus_share?: number | null }[];
  /** `profiles.cards_sort_order`, or `null` when the card block did not move. */
  cardsSortOrder: number | null;
  /** `profiles.cards_surplus_share`, or `undefined` when the block's weight did not change.
   *  A stored `null` is a real write — it is how a block leaves a split. */
  cardsShare?: number | null;
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
  const writes: SurplusRankWrites = { goals: [], carFunds: [], cards: [], cardsSortOrder: null };

  for (const row of after) {
    const was = prev.get(row.id);
    if (!was) continue;
    if (row.kind === 'cards') {
      if (was.sortOrder !== row.sortOrder) writes.cardsSortOrder = row.sortOrder;
      if (was.share !== row.share) writes.cardsShare = row.share;
      continue;
    }
    // Cards and liabilities are both `accounts` rows and both store their rank in
    // `surplus_sort_order`, so they plan identically. Neither emits `auto_extra`: the column does
    // not exist on `accounts`, and `setSurplusRankAutoExtra` refuses to move the flag for exactly
    // that reason, so there is never one to write.
    if (row.kind === 'card' || row.kind === 'liability') {
      const patch: SurplusRankWrites['cards'][number] = { id: row.id };
      if (was.sortOrder !== row.sortOrder) patch.surplus_sort_order = row.sortOrder;
      if (was.share !== row.share) patch.surplus_share = row.share;
      if (patch.surplus_sort_order === undefined && patch.surplus_share === undefined) continue;
      writes.cards.push(patch);
      continue;
    }
    const patch: SurplusRankWrites['goals'][number] = { id: row.id };
    if (was.sortOrder !== row.sortOrder) patch.sort_order = row.sortOrder;
    if (was.autoExtra !== row.autoExtra) patch.auto_extra = row.autoExtra;
    if (was.share !== row.share) patch.surplus_share = row.share;
    if (patch.sort_order === undefined && patch.auto_extra === undefined && patch.surplus_share === undefined) continue;
    // A loan row and a saving row are the same `car_funds` row wearing different hats — both write
    // to `car_funds`, which is why they can share one `sort_order` without ever colliding.
    (row.kind === 'goal' ? writes.goals : writes.carFunds).push(patch);
  }

  return writes;
}

/** True when there is nothing to send. Lets a caller skip the toast as well as the round trips. */
export function isSurplusRankWritesEmpty(w: SurplusRankWrites): boolean {
  return w.goals.length === 0 && w.carFunds.length === 0 && w.cards.length === 0
    && w.cardsSortOrder === null && w.cardsShare === undefined;
}

/**
 * Pull a card OUT of the block and give it its own rank, or put it back in. This is the only way
 * an individual card enters the ranked list, and it is deliberately an explicit act: the default —
 * one block, ordered by the payoff strategy — is the one that cannot cost the user interest.
 *
 * Returns a full write set rather than one patch, because the new rank has to be MADE. Seating the
 * card at `block + 1` on its own would land it on top of whatever already holds that rank and
 * silently create a split, so every row at or below the new rank is bumped down one. Putting a
 * card back needs no bump: a gap in the ranks is harmless, and the next reorder densifies it.
 *
 * The card's own row does not exist in `rows` until the write lands, which is why this returns
 * writes instead of a new list.
 */
export function planCardSeparationWrites(
  rows: readonly SurplusRankRow[], cardId: string, separate: boolean,
): SurplusRankWrites {
  const writes: SurplusRankWrites = { goals: [], carFunds: [], cards: [], cardsSortOrder: null };
  if (!separate) {
    writes.cards.push({ id: cardId, surplus_sort_order: null, surplus_share: null });
    return writes;
  }

  const block = rows.find(r => r.kind === 'cards');
  const at = block ? block.sortOrder + 1 : toGroups(rows).length;
  writes.cards.push({ id: cardId, surplus_sort_order: at, surplus_share: null });

  for (const row of rows) {
    if (row.sortOrder < at) continue;
    const moved = row.sortOrder + 1;
    if (row.kind === 'cards') writes.cardsSortOrder = moved;
    // A liability bumps through the `accounts` channel like a card, NOT through the trailing
    // `car_funds` fallback — that fallback used to be "anything that is not a goal", and a
    // liability landing there would have written a `sort_order` to a `car_funds` row that does
    // not exist, silently losing the bump and leaving two rows sharing a rank.
    else if (row.kind === 'card' || row.kind === 'liability') writes.cards.push({ id: row.id, surplus_sort_order: moved });
    else if (row.kind === 'goal') writes.goals.push({ id: row.id, sort_order: moved });
    else writes.carFunds.push({ id: row.id, sort_order: moved });
  }
  return writes;
}

/**
 * Put a non-CC liability ON the ranked list, or take it off.
 *
 * The debt half of `planCardSeparationWrites`, and separate from it because the SEAT differs. A
 * card leaves the block and sits immediately below it, so everything at or below that rank has to
 * be bumped; a liability is not in any block, so it joins at the END of the list — a rank of its
 * own, below everything, bumping nothing. Last is also the conservative seat: a debt the user has
 * only just added to the list should not silently outrank the goals they placed deliberately.
 *
 * Returns writes rather than a new list for the same reason its sibling does: the liability's row
 * does not exist in `rows` until `accounts.surplus_sort_order` is non-null, so there is no "next
 * list" to diff against.
 */
export function planLiabilityRankWrites(
  rows: readonly SurplusRankRow[], accountId: string, ranked: boolean,
): SurplusRankWrites {
  const writes: SurplusRankWrites = { goals: [], carFunds: [], cards: [], cardsSortOrder: null };
  // Off the list clears the weight too: a rank that is gone cannot be half of a split.
  writes.cards.push(ranked
    ? { id: accountId, surplus_sort_order: toGroups(rows).length, surplus_share: null }
    : { id: accountId, surplus_sort_order: null, surplus_share: null });
  return writes;
}

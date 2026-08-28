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
  carFundRemainingNeed, carLoanRemainingNeed, goalRemainingNeed, goalStages, revolvingRemainingOf,
  stopRowId,
  type GoalStageContext, type RankableGoal, type RankableLiability,
} from './ranked-extra-payment-targets';
import type { CarFund } from './types';
import { cardStartMonthOffset } from './card-start-date';

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
  /** True once `planAutoExtraDeselect` has already switched `autoExtra` off for this row because it
   * was met -- read from `savings_goals.auto_extra_auto_cleared` / `car_funds.auto_extra_auto_cleared`.
   * Always false for the cards, the block and liabilities, which carry no such column. Persists the
   * guard's exactly-once decision across a page reload; see `planAutoExtraDeselect` below. */
  autoExtraAutoCleared?: boolean;
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
  /**
   * The `savings_goals` row this stop belongs to. Present ONLY on a staged goal's rows, and it is
   * what makes them writable: the row's own `id` is `<goalId>::stopN` for the second stop onwards,
   * which is not a uuid in any table, so a patch has to be aimed at the goal and then at the entry
   * named by {@link stageId} inside its `stages` array.
   */
  goalId?: string;
  /** The stop's stored id inside `savings_goals.stages` — which entry a write patches. */
  stageId?: string;
  /**
   * Which stop of a STAGED goal this row stands for, 1-based. Absent on every ordinary row.
   *
   * The list shows the stops SEPARATELY because that is what actually happens to the money, and
   * since 2026-08-26 each one is a row in its own right: its own rank, its own Auto extra tick,
   * both stored on the stop. The only thing a drag may not do is let two stops cross — see
   * {@link enforceStopOrder}.
   */
  stage?: number;
  /** How many stops the goal has in total — so a row can say "Stop 2 of 3" without re-deriving it. */
  stageCount?: number;
  /** This stop's own name, for the label beside the goal name. */
  stageLabel?: string;
  /**
   * A credit card the user has PLANNED but not opened yet — `accounts.card_start_date` is in the
   * future. Tre, 2026-08-26: "if we still want to show the two not live cards yet, just show them
   * individually with a note."
   *
   * Its row otherwise reads "$0 balance · minimum always paid", which is the same sentence a real
   * open card with nothing owed prints — so a card that does not exist looks like a card that is
   * paid off, and the two are opposite news.
   */
  notOpenYet?: boolean;
  /** The month it opens, already formatted ("Mar 2027"). Only set with {@link notOpenYet}. */
  opensLabel?: string;
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
  /** `accounts.card_start_date`. A FUTURE date means the card is planned, not open. */
  card_start_date?: string | null;
  /** `accounts.apr`, so the not-yet-open cards can be ordered the way the payoff strategy would. */
  apr?: number | null;
};

export type BuildSurplusRankRowsParams = {
  goals: readonly (RankableGoal & {
    name?: string | null; created_at?: string | null; target_date?: string | null;
    /** `savings_goals.auto_extra_auto_cleared` (20260826_auto_extra_auto_cleared.sql). Optional
     * (unlike `CarFund`'s copy) so pre-existing test fixtures and callers that never auto-cleared
     * anything stay valid: absent reads the same as `false`. */
    auto_extra_auto_cleared?: boolean | null;
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
  /**
   * One month of essential cost — `computeEssentialMonthlyExpenses`. The multiplicand a STAGED
   * emergency goal's thresholds are measured in.
   *
   * ⚠️ OMITTING IT IS NOT NEUTRAL FOR A STAGED GOAL. With nothing here the stages cannot be sized,
   * so the goal reports its base `target_amount` while the ENGINE is chasing stage 1 — the list and
   * the forecast would print different numbers for the same row. Absent is the right answer only
   * where no goal is staged, which is every caller until the feature is switched on.
   * The `cards` above double as the stage gate; see {@link revolvingRemainingOf}.
   */
  essentialMonthlyExpenses?: number;
  /**
   * Today, for deciding which cards are open yet. Injected rather than read from the clock so the
   * list is a pure function of its inputs and a test can stand anywhere in time.
   */
  asOf?: Date;
  /**
   * The payoff strategy in force, which orders the NOT-YET-OPEN cards among themselves — Tre,
   * 2026-08-26: "ordered by the payoff method". Open cards keep the rank the user dragged them to;
   * a card that does not exist yet has no rank anybody chose, so the strategy is the only honest
   * answer to what order they should be in.
   */
  cardPayoffStrategy?: 'avalanche' | 'snowball';
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
/** Half a cent — the same dust rule `goalRemainingNeed` applies, so "filled" means the same thing
 *  in this list as it does in the allocator. */
const RANK_CENT = 0.005;

export function buildSurplusRankRows(p: BuildSurplusRankRowsParams): SurplusRankRow[] {
  const {
    goals, carFunds, cards = [], liabilities = [], cardsSortOrder = 0, cardsShare = null,
    fundingAccountId = null, accountBalances = {}, essentialMonthlyExpenses = 0,
    asOf, cardPayoffStrategy = 'avalanche',
  } = p;
  const today = asOf ?? new Date();

  const balanceOf = (accountId: string | null) =>
    accountId != null && accountId in accountBalances ? accountBalances[accountId] : null;

  // Built from the SAME `cards` the block row is built from, exactly as `buildRankedTargets` builds
  // its own — so the list and the allocator agree about whether stage 2 has opened. With no
  // multiplicand `goalStages` reports `staged: false` and every goal falls back to `target_amount`,
  // which is what this list printed before staged goals existed.
  const stageCtx: GoalStageContext = {
    essentialMonthlyExpenses,
    revolvingRemaining: revolvingRemainingOf(cards),
  };

  const rankableGoals = goals.filter((g): g is typeof g & { id: string } => typeof g.id === 'string');

  // ── ONE ROW PER UNFILLED STOP, EACH ONE REAL ────────────────────────────────
  //
  // Tre, 2026-08-26: *"each part of the stagger should always have the choice of extra payments. and
  // each should be freely re-orderable around the other items. just stay in their relative order.
  // for example, emergercy 2 should be behind all the credit cards, then 3 is behind the loan."*
  //
  // So a stop is not a projection of the goal any more — it is a row in its own right, with its own
  // rank and its own Auto extra tick, both stored on the stop inside `savings_goals.stages`. That is
  // also what retired the `after_cards` flag: a stop expresses "after the cards" by SITTING after
  // them, and a flag saying the same thing in a second language could only ever disagree with it.
  //
  // A FILLED STOP LEAVES THE LIST ("that stage should immediately stop/drop once its done"). A goal
  // whose every stop is filled keeps its LAST one, at zero — the same rule that keeps a finished
  // ordinary goal listed rather than making the list jump around as balances move.
  const goalRows: SurplusRankRow[] = rankableGoals.flatMap(g => {
    const stages = goalStages(g, essentialMonthlyExpenses);
    const saved = Number(g.current_amount) || 0;
    const unfilled = stages.stops.filter(s => saved < s.threshold - RANK_CENT);
    const shown = unfilled.length > 0 ? unfilled : stages.stops.slice(-1);
    return shown.map(stop => ({
      id: stopRowId(g.id, stop.index),
      kind: 'goal' as const,
      name: (g.name ?? '').trim() || 'Untitled goal',
      sortOrder: stop.sortOrder,
      autoExtra: stop.autoExtra,
      // The provenance flag lives on the GOAL, so only the stop that reads that column can carry it.
      autoExtraAutoCleared: stop.index === 1 && g.auto_extra_auto_cleared === true,
      // THIS stop's own dollars, never the plan's. The rows then sum to what is left rather than
      // each restating the total.
      remaining: stages.staged
        ? Math.max(0, stop.threshold - Math.max(saved, stop.floor))
        : goalRemainingNeed(g, stageCtx),
      // EVERY STOP CAN CARRY A SPLIT WEIGHT since 2026-08-27 — its own `surplus_share` inside the
      // `stages` entry, with the goal's column as stop 1's fallback because that column always was
      // stop 1's. Until then a later stop could be dragged onto a shared rank but never actually
      // split it, which is the arrangement Tre asked for by name ("split stage 2 of savings with
      // car loan"). `goalStages` resolves the fallback; this reads what it decided.
      share: readShare(stop.share),
      // A staged goal's headline number is the stop, not the cached total.
      targetAmount: stages.staged ? stop.threshold : (Number(g.target_amount) || null),
      targetDate: stages.staged ? stop.targetDate : (g.target_date ?? null),
      createdAt: g.created_at ?? '',
      ...(stages.staged
        ? {
          goalId: g.id,
          stageId: stop.id,
          stage: stop.index,
          stageCount: stages.stops.length,
          stageLabel: stop.name,
        }
        : {}),
    }));
  });

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
    autoExtraAutoCleared: f.auto_extra_auto_cleared === true,
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
    autoExtraAutoCleared: f.auto_extra_auto_cleared === true,
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
  const cardRows: SurplusRankRow[] = soloCards.map(c => {
    // ⚠️ `cardStartMonthOffset`, NOT `isCardOpenAsOf`. That sibling first checks
    // `account_type === 'credit_card'` and returns TRUE for anything else — and a `RankableCard`
    // carries no `account_type`, so every card would have read as open and the note would never
    // have appeared. Both helpers are the same arithmetic underneath; only this one is answerable
    // from the shape this module actually holds.
    const opensIn = cardStartMonthOffset(c.card_start_date, today);
    const notOpenYet = opensIn > 0;
    return {
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
      ...(notOpenYet
        ? {
          notOpenYet: true,
          opensLabel: new Date(`${c.card_start_date}T00:00:00`)
            .toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
        }
        : {}),
    };
  });

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

  return orderNotOpenCards(
    enforceStopOrder(
      [...cardsRow, ...cardRows, ...carRows, ...loanRows, ...liabilityRows, ...goalRows]
        .sort(compareSurplusRankRows),
    ),
    cardPayoffStrategy,
    soloCards,
  );
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
 * THE ONE THING A DRAG MAY NOT DO: let two stops of the same goal cross.
 *
 * Tre, 2026-08-26: *"each should be freely re-orderable around the other items. just stay in their
 * relative order."* Anywhere is fair game — behind the cards, behind the loan, between two other
 * goals — but stop 3 landing above stop 2 would be a plan that cannot happen: the thresholds are
 * cumulative, so the money physically passes through stop 2 first and the list would be describing
 * an order the engine can never follow.
 *
 * The rule is positional and it preserves the user's intent as far as it can. A goal's stops keep
 * the SET of positions they collectively occupy; only which stop sits in which of those positions
 * is corrected, back into index order. Drag stop 3 to the top and it takes the topmost of its
 * goal's positions — so it moves, visibly, as far as it legally can, rather than snapping back to
 * where it started with no explanation.
 *
 * Assumes the input is already sorted; returns a densely-ranked list.
 */
export function enforceStopOrder(rows: readonly SurplusRankRow[]): SurplusRankRow[] {
  const byGoal = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (r.goalId == null || r.stage == null) return;
    const at = byGoal.get(r.goalId);
    if (at) at.push(i); else byGoal.set(r.goalId, [i]);
  });
  const out = [...rows];
  let touched = false;
  for (const positions of byGoal.values()) {
    if (positions.length < 2) continue;
    const stops = positions.map(i => out[i]).sort((a, b) => (a.stage ?? 0) - (b.stage ?? 0));
    positions.forEach((slot, k) => {
      if (out[slot] === stops[k]) return;
      // The slot's rank belongs to the POSITION, not to the row that happened to be dropped in it.
      out[slot] = { ...stops[k], sortOrder: rows[slot].sortOrder };
      touched = true;
    });
  }
  return touched ? densify(out.sort(compareSurplusRankRows)) : [...rows];
}

/**
 * NOT-YET-OPEN CARDS, IN THE ORDER THE PAYOFF STRATEGY WOULD ATTACK THEM.
 *
 * Tre, 2026-08-26: *"if we still want to show the two not live cards yet, just show them
 * individually with a note ... ordered by the payoff method."*
 *
 * A card that does not exist yet cannot have a rank anybody meant: it has never owed anything, so
 * whatever `surplus_sort_order` it holds is an accident of when it was created. The strategy is the
 * only answer that is about the card rather than about the row.
 *
 * ⚠️ IT REORDERS WITHIN THE POSITIONS THOSE ROWS ALREADY OCCUPY and touches nothing else — the same
 * rule {@link enforceStopOrder} uses. So this can never move a planned card past an OPEN one, past
 * a goal, or past the block; it only decides which planned card sits in which of the slots the
 * planned cards already hold. Nothing the user dragged moves.
 *
 * Avalanche is highest APR first, snowball is lowest balance first — the same two comparators
 * `getStrategyPayoffOrder` uses, on the only two fields an `accounts` row hands this module.
 */
/**
 * The seat the payoff strategy would give a card, as a number that sorts ASCENDING — lower is paid
 * first. Avalanche negates the APR so "highest rate first" and "lowest balance first" can be the
 * same comparison; a card with neither field reads as the back of the queue under avalanche and the
 * front under snowball, which is what a $0 card genuinely is under each rule.
 *
 * The one statement of this ordering inside this module, shared by {@link orderNotOpenCards} and
 * {@link planNewCardRankWrites} so the list cannot seat a card in one place and reorder it in
 * another. `getStrategyPayoffOrder` (debt-payoff-order.ts) is the same two comparators over
 * `CardData`; it cannot be called here because it drops every card with no balance, and a card that
 * has just been created always has one.
 */
function payoffSeatKey(
  strategy: 'avalanche' | 'snowball',
  apr: number | null | undefined,
  balance: number | null | undefined,
): number {
  return strategy === 'avalanche' ? -(Number(apr) || 0) : Math.max(0, Number(balance) || 0);
}

export function orderNotOpenCards(
  rows: readonly SurplusRankRow[],
  strategy: 'avalanche' | 'snowball',
  cards: readonly RankableCard[],
): SurplusRankRow[] {
  const slots: number[] = [];
  rows.forEach((r, i) => { if (r.kind === 'card' && r.notOpenYet) slots.push(i); });
  if (slots.length < 2) return [...rows];
  const byId = new Map(cards.map(c => [c.id, c]));
  const ordered = slots.map(i => rows[i]).sort((a, b) => (
    payoffSeatKey(strategy, byId.get(a.id)?.apr, a.remaining)
    - payoffSeatKey(strategy, byId.get(b.id)?.apr, b.remaining)
  ));
  const out = [...rows];
  slots.forEach((slot, k) => { out[slot] = { ...ordered[k], sortOrder: rows[slot].sortOrder }; });
  return out;
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
  // A stop is free to land anywhere EXCEPT above an earlier stop of its own goal; see
  // `enforceStopOrder` for why that one is not a preference.
  return enforceStopOrder(fromGroups(groups.filter(g => g.length > 0)));
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
 *
 * ⚠️ ALSO CLEARS `autoExtraAutoCleared`, in either direction. `auto_extra_auto_cleared` means
 * "this row's `auto_extra` currently reads what it does because automation put it there" — the
 * moment a person touches the switch by hand, that stops being true, whichever way they moved it.
 * `planSurplusRankWrites` below turns this into the DB write; the in-session guard `Set`
 * (`useSurplusRanking.ts`) is untouched by it and keeps a re-ticked row safe from an immediate
 * re-fight for the rest of the tab's life either way — see `planAutoExtraDeselect`.
 */
export function setSurplusRankAutoExtra(
  rows: readonly SurplusRankRow[], id: string, autoExtra: boolean,
): SurplusRankRow[] {
  return rows.map(r => (
    r.id === id && r.kind !== 'cards' && r.kind !== 'card' && r.kind !== 'liability'
      ? { ...r, autoExtra, autoExtraAutoCleared: false }
      : r
  ));
}

/**
 * A row whose `auto_extra` should be switched off because the thing it was saving for is done.
 *
 * `kind` is carried so the caller knows which TABLE to write — `goal` is `savings_goals`, and both
 * `car_fund` and `loan` are the same `car_funds` row wearing different hats.
 */
export type AutoExtraDeselect = {
  id: string;
  kind: 'goal' | 'car_fund' | 'loan';
  /** Set on a STAGED goal's stop. The tick lives inside `savings_goals.stages`, so the caller
   *  patches that entry rather than the goal's `auto_extra` column — `id` here is the ROW id
   *  (`<goalId>::stopN` from the second stop on) and is not a uuid anywhere. */
  goalId?: string;
  stageId?: string;
  /** For the message. The user is told a switch of theirs moved; saying which one is the least
   *  that owes them. */
  name: string;
};

/**
 * Which ranked rows have met their goal and should have `auto_extra` switched off.
 *
 * The second half of Tre's 2026-08-25 ask: "once it comes true it should auto deselect." The
 * waterfall in `allocateRankedSurplus` already stops paying a target the month after it is met —
 * this is what makes that visible on the switch the user actually looks at, so the list reads as
 * "this one is next" rather than as five things all ticked and one of them silently receiving.
 *
 * ⚠️ THIS CAN NEVER MOVE A DOLLAR, and that is what makes it safe to run from an effect. A met
 * target is already excluded from every allocation by its own capacity — `computeAutoExtraReserve`
 * drops anything under half a cent, and the forecast's `autoExtraCapacity` never admits a need of
 * zero — so the flag it clears was already inert. The write is presentational, and a pass that
 * failed or never ran costs the user nothing but a stale tick.
 *
 * ⚠️ IT IS PLANNED FROM REAL ROWS, NEVER FROM THE PROJECTION. `remaining` on a `SurplusRankRow` is
 * `goalRemainingNeed` / `carFundRemainingNeed` / `carLoanRemainingNeed` against live balances. A
 * projection saying a goal WILL be met is a forecast; only the row says it HAS been.
 *
 * Idempotence is the flag itself: the write makes `autoExtra` false, so the very next plan is
 * empty and there is nothing to loop on. `alreadyDeselected` and `row.autoExtraAutoCleared` are
 * the second guard, for the one case the flag cannot cover — a user who deliberately re-ticks a
 * finished row. Flipping it straight back off would be a fight, so a row named there is left alone.
 *
 * ⚠️ TWO LAYERS OF THAT SECOND GUARD, not one, and they age differently on purpose.
 * `alreadyDeselected` is the in-session `Set` (`useSurplusRanking.ts`) — fast, current before a
 * refetch has landed, and NEVER cleared for the life of the tab, so a re-tick is safe from an
 * immediate re-fight for as long as the user stays on the page, whatever they do to the row after.
 * `row.autoExtraAutoCleared` is `savings_goals.auto_extra_auto_cleared` /
 * `car_funds.auto_extra_auto_cleared` (`20260826_auto_extra_auto_cleared.sql`) — the same fact,
 * persisted so a reload does not rebuild an empty `Set` and re-fight a re-tick the user made
 * moments before reloading, but it is NOT permanent: `setSurplusRankAutoExtra` clears it back to
 * `false` the instant a person touches the switch by hand, because at that point the column would
 * otherwise keep asserting "automation put this here" about a value the user just chose themselves.
 * The practical edge this leaves: re-tick a finished row, then reload a SECOND time (nothing else
 * in between), and the rule reasserts itself — "once it comes true it should auto deselect" wins
 * rather than a manual override becoming permanent across every future reload. That is the
 * intentional reading; the in-session `Set` is what keeps the common case (reload once, or never)
 * from ever seeing it.
 *
 * Cards, the card block and liabilities are never included: `accounts` has no `auto_extra` column,
 * which is the same reason `setSurplusRankAutoExtra` refuses to move their switch by hand.
 */
export function planAutoExtraDeselect(
  rows: readonly SurplusRankRow[],
  alreadyDeselected: ReadonlySet<string> = new Set(),
): AutoExtraDeselect[] {
  const out: AutoExtraDeselect[] = [];
  for (const row of rows) {
    if (row.kind !== 'goal' && row.kind !== 'car_fund' && row.kind !== 'loan') continue;
    if (!row.autoExtra || alreadyDeselected.has(row.id) || row.autoExtraAutoCleared) continue;
    if (row.remaining === null || row.remaining > 0) continue;
    // A goal or a car fund with nothing to reach is UNCONFIGURED, not finished, and its remaining
    // need reads 0 for that reason alone. A debt being paid down has no target amount by design
    // (`loanRows` above), so nothing outstanding there really is paid off.
    if (row.kind !== 'loan' && !(row.targetAmount !== null && row.targetAmount > 0)) continue;
    out.push({
      id: row.id, kind: row.kind, name: row.name,
      ...(row.goalId != null && row.stageId != null ? { goalId: row.goalId, stageId: row.stageId } : {}),
    });
  }
  return out;
}

export type SurplusRankWrites = {
  goals: {
    id: string; sort_order?: number; auto_extra?: boolean;
    /** Emptied when `auto_extra` is switched ON, never otherwise. See
     *  `planSurplusRankWrites`. */
    lump_sum_payments?: [];
    /** Cleared to `false` alongside a manual `auto_extra` write — see `setSurplusRankAutoExtra`.
     *  Not yet in the generated `Update` type as of `20260826_auto_extra_auto_cleared.sql`
     *  (unapplied); the destructured `patch` this rides on is a variable, not a literal, so it
     *  compiles today without a cast and needs no change once the migration lands and types
     *  regenerate — see `useSurplusRanking.ts`'s `save` mutation, which is where this is written. */
    auto_extra_auto_cleared?: boolean;
    surplus_share?: number | null;
  }[];
  carFunds: {
    id: string; sort_order?: number; auto_extra?: boolean; auto_extra_auto_cleared?: boolean;
    /** Emptied when `auto_extra` is switched ON, never otherwise. See
     *  `planSurplusRankWrites`. */
    lump_sum_payments?: [];
    surplus_share?: number | null;
  }[];
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
  /**
   * Per-STOP patches for a staged goal, keyed by the goal row and the stop's own id inside its
   * `stages` array.
   *
   * A separate channel from `goals` because it is a separate WRITE: the caller has to read the
   * goal's current `stages`, patch the named entry and put the whole array back. Folding these into
   * `goals` would have let a stop's rank collide with the goal's own `sort_order` column, which is
   * the FIRST stop's rank and nothing else's.
   */
  goalStages: {
    goalId: string; stageId: string; sort_order?: number; auto_extra?: boolean;
    /** ⚠️ `null` IS A REAL VALUE HERE — it is how a stop leaves a split — so this is
     *  `number | null` and `undefined` alone means "unchanged". */
    surplus_share?: number | null;
  }[];
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
  const writes: SurplusRankWrites = { goals: [], carFunds: [], cards: [], goalStages: [], cardsSortOrder: null };

  for (const row of after) {
    const was = prev.get(row.id);
    if (!was) continue;
    // ⚠️ A STAGED GOAL'S ROWS DO NOT WRITE THE GOAL'S COLUMNS. `<goalId>::stop2` is not a uuid in
    // any table, and even the first stop's row must not touch `savings_goals.sort_order` any more:
    // the plan's ranks live on the stops, and writing one of them to the goal would leave two
    // sources for the same number, disagreeing the moment a stop is dragged.
    if (row.goalId != null && row.stageId != null) {
      const patch: SurplusRankWrites['goalStages'][number] = { goalId: row.goalId, stageId: row.stageId };
      if (was.sortOrder !== row.sortOrder) patch.sort_order = row.sortOrder;
      if (was.autoExtra !== row.autoExtra) patch.auto_extra = row.autoExtra;
      if (was.share !== row.share) patch.surplus_share = row.share;
      if (patch.sort_order === undefined && patch.auto_extra === undefined
        && patch.surplus_share === undefined) continue;
      writes.goalStages.push(patch);
      continue;
    }
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
    if (was.autoExtra !== row.autoExtra) {
      patch.auto_extra = row.autoExtra;
      // ⚠️ TURNING IT ON CLEARS THE HAND-TYPED EXTRAS, and only that edge does.
      // Automatic and manual extra against ONE target are two answers to the same
      // question, and leaving both standing funds it twice (Tre, 2026-08-26: "if
      // auto extra payments are enabled, dont allow manual entry and remove
      // current manual payments"). Turning the switch OFF deliberately does
      // NOTHING here: the user is most likely switching to manual precisely so
      // they can type their own, and wiping the list at that moment would delete
      // what they came to write.
      if (!was.autoExtra && row.autoExtra) patch.lump_sum_payments = [];
    }
    // `setSurplusRankAutoExtra` always resets `autoExtraAutoCleared` to `false` on a manual
    // toggle, so this only ever fires a real write when the row's CURRENT value is `true` --
    // i.e. exactly the row a manual re-select is correcting the provenance of. A row that was
    // never auto-cleared diffs to nothing here, same as `auto_extra` on an untouched row.
    if (was.autoExtraAutoCleared !== row.autoExtraAutoCleared) patch.auto_extra_auto_cleared = row.autoExtraAutoCleared;
    if (was.share !== row.share) patch.surplus_share = row.share;
    if (patch.sort_order === undefined && patch.auto_extra === undefined
      && patch.auto_extra_auto_cleared === undefined && patch.surplus_share === undefined
      && patch.lump_sum_payments === undefined) continue;
    // A loan row and a saving row are the same `car_funds` row wearing different hats — both write
    // to `car_funds`, which is why they can share one `sort_order` without ever colliding.
    (row.kind === 'goal' ? writes.goals : writes.carFunds).push(patch);
  }

  return writes;
}

/** True when there is nothing to send. Lets a caller skip the toast as well as the round trips. */
export function isSurplusRankWritesEmpty(w: SurplusRankWrites): boolean {
  return w.goals.length === 0 && w.carFunds.length === 0 && w.cards.length === 0
    && w.goalStages.length === 0 && w.cardsSortOrder === null && w.cardsShare === undefined;
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
/**
 * Put EVERY card on its own row, or put every card back in the block.
 *
 * ⚠️ WHY A MODE AND NOT A PER-CARD CHOICE. Pulling cards out one at a time let the
 * list show a "Credit Cards" block row AND individual card rows at the same time,
 * which is two different answers to "how are my cards ranked" on one screen. Tre,
 * 2026-08-26: "add a toggle to separate by card ... or just credit cards in
 * general, never both". It is worst on a split rank, where the block carries one
 * weight and a pulled-out card carries another, and the two weights are partly
 * about the same debt - so a 50/50 split does not mean what it says.
 *
 * Going INDIVIDUAL seats each card at consecutive ranks starting where the block
 * sat, so the list the user was looking at does not reorder underneath them, and
 * clears each card's own share: a weight set while the card was sharing a rank
 * with something else is not a weight it should keep once it has a rank to itself.
 *
 * Going BLOCK clears `surplus_sort_order` on every card, which is the one and only
 * thing that decides membership, and clears their shares for the same reason.
 * The block's own rank and weight live on `profiles` and are untouched by both.
 *
 * The payoff STRATEGY still orders the cards inside the block, and still decides
 * which card the surviving pool actually pays even when they are ranked
 * individually. See `ranked-extra-payment-targets.ts` - an individual rank moves
 * the SPLIT POINT between debt and goals, it does not override avalanche.
 */
export function planCardRankModeWrites(
  rows: readonly SurplusRankRow[],
  blockedCards: readonly { id: string }[],
  mode: 'block' | 'individual',
): SurplusRankWrites {
  const writes: SurplusRankWrites = { goals: [], carFunds: [], cards: [], goalStages: [], cardsSortOrder: null };

  if (mode === 'block') {
    for (const row of rows) {
      if (row.kind !== 'card') continue;
      writes.cards.push({ id: row.id, surplus_sort_order: null, surplus_share: null });
    }
    return writes;
  }

  const block = rows.find(r => r.kind === 'cards');
  const at = block ? block.sortOrder : toGroups(rows).length;
  // Cards already on their own keep their relative order; the ones still inside the
  // block follow, in the order the block itself was showing them.
  const already = rows.filter(r => r.kind === 'card').sort((a, b) => a.sortOrder - b.sortOrder);
  const seating = [...already.map(r => r.id), ...blockedCards.map(c => c.id)];
  seating.forEach((id, i) => {
    writes.cards.push({ id, surplus_sort_order: at + i, surplus_share: null });
  });
  return writes;
}

export function planCardSeparationWrites(
  rows: readonly SurplusRankRow[], cardId: string, separate: boolean,
): SurplusRankWrites {
  const writes: SurplusRankWrites = { goals: [], carFunds: [], cards: [], goalStages: [], cardsSortOrder: null };
  if (!separate) {
    writes.cards.push({ id: cardId, surplus_sort_order: null, surplus_share: null });
    return writes;
  }

  const block = rows.find(r => r.kind === 'cards');
  const at = block ? block.sortOrder + 1 : toGroups(rows).length;
  writes.cards.push({ id: cardId, surplus_sort_order: at, surplus_share: null });
  bumpRowsAtOrBelow(rows, at, writes);
  return writes;
}

/**
 * MAKE ROOM AT RANK `at`: every row already at it or below moves down one.
 *
 * Shared by every planner that INSERTS a rank rather than re-ordering existing ones. Seating a new
 * row on top of an occupied rank would silently create a split — two rows sharing a number is what
 * a split IS — so the room has to be made first.
 *
 * ⚠️ A STAGED GOAL'S STOP IS ROUTED FIRST, BEFORE `kind`. Its row id is `<goalId>::stopN` from stop
 * 2 onwards and its rank lives inside `savings_goals.stages`, so a `kind === 'goal'` patch would
 * aim `savings_goals.sort_order` at an id that exists in no table: the bump vanishes, and the stop
 * stays behind on a rank the row above just took. That is exactly what broke the Prime Visa /
 * move-fund split pairing when the Robinhood card was seated at rank 0 on 2026-08-27, and it had to
 * be repaired by hand in SQL.
 *
 * A liability bumps through the `accounts` channel like a card, NOT through the trailing
 * `car_funds` fallback — that fallback used to be "anything that is not a goal", and a liability
 * landing there would have written a `sort_order` to a `car_funds` row that does not exist.
 */
function bumpRowsAtOrBelow(
  rows: readonly SurplusRankRow[], at: number, writes: SurplusRankWrites,
): void {
  for (const row of rows) {
    if (row.sortOrder < at) continue;
    const moved = row.sortOrder + 1;
    if (row.goalId != null && row.stageId != null) {
      writes.goalStages.push({ goalId: row.goalId, stageId: row.stageId, sort_order: moved });
    } else if (row.kind === 'cards') writes.cardsSortOrder = moved;
    else if (row.kind === 'card' || row.kind === 'liability') writes.cards.push({ id: row.id, surplus_sort_order: moved });
    else if (row.kind === 'goal') writes.goals.push({ id: row.id, sort_order: moved });
    else writes.carFunds.push({ id: row.id, sort_order: moved });
  }
}

/**
 * A CARD THE USER HAS JUST CREATED, SEATED WHERE THE PAYOFF STRATEGY WOULD PUT IT.
 *
 * Tre, 2026-08-27: *"it needs to show in rank individually regardless. consider my customers. they
 * cant just have you take it in and out with sql ... i selected it and yoy overwrote it. and follow
 * the avalanche/snowball order selected on debt payoff tab by default."*
 *
 * A new `accounts` row lands with `surplus_sort_order` NULL, which is the "inside the block" value —
 * so on a list the user had set to **One row each** the new card silently re-created the block and
 * turned the whole list MIXED, which is the one arrangement `planCardRankModeWrites` exists to
 * prevent. The user's chosen mode was overwritten by an account they added.
 *
 * ⚠️ IT ONLY ACTS IN INDIVIDUAL MODE — every other active card already ranked on its own. Returns
 * `null` otherwise, and `null` means "write nothing": in BLOCK mode the block is the mode the user
 * picked and a NULL rank is precisely how the new card joins it, and in a legacy MIXED list nobody
 * has picked anything, so inventing a rank would be this same bug pointed the other way.
 *
 * The SEAT is the first existing card the strategy would pay AFTER this one, read down the list in
 * the order the user actually has it — so a user who dragged their cards out of strategy order
 * keeps that order, and the new card lands at the boundary inside it rather than reshuffling
 * everything. Nothing already on the list changes rank relative to anything else; the rows at and
 * below the seat move down one together.
 */
export function planNewCardRankWrites(
  rows: readonly SurplusRankRow[],
  cards: readonly RankableCard[],
  newCard: RankableCard,
  strategy: 'avalanche' | 'snowball',
): SurplusRankWrites | null {
  // The new card may or may not have reached `cards` yet depending on whether the refetch has
  // landed, and it must not count as one of the cards whose mode is being read either way.
  const others = cards.filter(c => c.id !== newCard.id);
  const solo = rows.filter(r => r.kind === 'card' && r.id !== newCard.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (others.length === 0 || solo.length !== others.length) return null;

  const byId = new Map(others.map(c => [c.id, c]));
  const key = payoffSeatKey(strategy, newCard.apr, newCard.balance);
  const behind = solo.find(r => payoffSeatKey(strategy, byId.get(r.id)?.apr, r.remaining) > key);
  const at = behind ? behind.sortOrder : solo[solo.length - 1].sortOrder + 1;

  const writes: SurplusRankWrites = { goals: [], carFunds: [], cards: [], goalStages: [], cardsSortOrder: null };
  // ⚠️ THE BLOCK ROW IS NOT BUMPED, and it is the one row that must not be. On an individual list
  // the block only exists at all because this very card is transiently sitting in it — a NULL
  // `surplus_sort_order` IS block membership — and the moment this write lands the block is empty
  // again and its row disappears. Moving `profiles.cards_sort_order` for it would leave the block's
  // stored rank one lower than the user set it, permanently, one step per card they ever add, and
  // they would only find out by switching back to One group.
  bumpRowsAtOrBelow(rows.filter(r => r.kind !== 'cards'), at, writes);
  writes.cards.push({ id: newCard.id, surplus_sort_order: at, surplus_share: null });
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
  const writes: SurplusRankWrites = { goals: [], carFunds: [], cards: [], goalStages: [], cardsSortOrder: null };
  // Off the list clears the weight too: a rank that is gone cannot be half of a split.
  writes.cards.push(ranked
    ? { id: accountId, surplus_sort_order: toGroups(rows).length, surplus_share: null }
    : { id: accountId, surplus_sort_order: null, surplus_share: null });
  return writes;
}

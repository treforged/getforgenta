/**
 * Turning the user's real rows into the allocator's input.
 *
 * `allocateRankedSurplus` (`ranked-surplus-allocation.ts`) is deliberately ignorant of cards, car
 * funds and goals — it takes minimums, capacities and ranks. This module is the one place that
 * knows how each of those is derived from a `CardData`, a `CarFund` and a `SavingsGoal`, so the
 * allocator's proof stays a proof about arithmetic and every real-world judgement call lives here
 * where it can be read in one screen.
 *
 * Pure: no database, no clock, no engine. Live balances arrive as arguments.
 *
 * WHY CARDS RANK AS A BLOCK BY DEFAULT. The payoff strategy (avalanche/snowball) already orders
 * the cards, and it orders them on the marginal APR — the rate the next dollar actually saves
 * (`debt-payoff-order.ts`). Letting a user drag one card above another would silently override the
 * strategy they chose and cost them interest. So by default the user ranks the BLOCK of cards
 * against their goals and car funds, and within the block the strategy still decides.
 * `cardsSortOrder` is that block's rank.
 *
 * WHY A CARD CAN NOW LEAVE THE BLOCK ANYWAY (2026-08-21). A contiguous block cannot express "fund
 * the move AFTER the Visa but BEFORE the Discover", which is a real and ordinary thing to want —
 * it was Tre's own ranking, and the fractional `cardsSortOrder + i/(n+1)` seating made it
 * impossible by construction. A card with an explicit `surplus_sort_order` therefore leaves the
 * block and carries its own rank.
 *
 * ⚠️ That still does not override the strategy. An individual rank moves the SPLIT POINT between
 * debt and goals — how much of the pool survives to reach the goal ranked between two cards. Which
 * card the surviving card pool actually pays is decided, as it always was, by the revolving
 * cascade running the user's strategy. See `RankedTarget.rankedIndividually`.
 */

import type { CardData } from './credit-card-engine';
import type { CarFund, SavingsGoal } from './types';
import { getStrategyPayoffOrder } from './debt-payoff-order';
import {
  listDebtServiceLiabilities,
  type DebtServiceAccountInput, type DebtServiceRuleInput, type LiabilityDebtInput,
} from './non-cc-liabilities';
import { getCarFundSaved } from './vehicle-loan-engine';
import {
  IRA_ANNUAL_LIMIT, isIraCapped, levelMonthlyAllowance, levelMonthlyToDate, monthsUntilTargetDate,
} from './retirement-contribution-cap';
import type { RankedTarget } from './ranked-surplus-allocation';
import { toLocalDateStr } from './scheduling';

export type BuildRankedTargetsParams = {
  cards: readonly CardData[];
  carFunds: readonly CarFund[];
  goals: readonly RankableGoal[];
  /** Payoff strategy in force — orders the cards WITHIN the card block. */
  strategy: 'avalanche' | 'snowball';
  /** Local YYYY-MM-DD, for the marginal-APR ranking. */
  asOf: string;
  /** Where the card block sits relative to the goals and car funds. Defaults to 0 — cards first,
   * which is today's behaviour and the conservative default for a user who has ranked nothing. */
  cardsSortOrder?: number;
  /** The account surplus is deployed from — a car fund linked elsewhere reads its own balance. */
  fundingAccountId?: string | null;
  /** Live balance per account id, for `getCarFundSaved`. Missing ⇒ the typed figure is used. */
  accountBalances?: Readonly<Record<string, number>>;
  /**
   * Per-card overrides, keyed by card id, from the card's `accounts` row.
   *
   * `sortOrder` non-null pulls that card OUT of the block and seats it at that rank in its own
   * right. Absent, or null, leaves it in the block — which is every card of every user who has not
   * touched the feature, and is byte-identical to before the column existed.
   */
  cardRanks?: Readonly<Record<string, { sortOrder?: number | null; share?: number | null }>>;
  /** `profiles.cards_surplus_share` — the block's weight when it SHARES its rank with something. */
  cardsShare?: number | null;
  /**
   * Whether LOAN targets (extra principal on a vehicle loan) may draw a reserve.
   *
   * Defaults to FALSE, and the default is about the CALLER, not about the feature. A reserve is
   * cash leaving checking, and whoever asks for one has to be able to put those dollars somewhere
   * or the user's money evaporates — `forecast-engine.ts` says exactly that at its crediting step.
   * A goal has a pool to land in and a car fund has one; a loan's credit is a LIABILITY going
   * down, which only a caller that projects the vehicle's amortized balance can perform.
   *
   * `forecast-engine.ts` can (step 4c-ii-b reduces the amortized balance by the same dollars, from
   * the paying month forward), so the two hooks that feed it pass `true`. Any future caller that
   * cannot must leave this alone, and will then get a loan the user can rank but not fund — which
   * is the honest half-feature, not a broken one.
   */
  includeLoanTargets?: boolean;
  /**
   * Non-credit-card liability accounts the user has RANKED — a student loan, a mortgage, an
   * `other_liability` paired to a `debts` row. Built by the caller via
   * `listDebtServiceLiabilities` (non-cc-liabilities.ts), which owns the account/`debts` pairing,
   * so this module never has to know that rule. Omitted ⇒ no liability targets at all, which is
   * every caller that has not been taught to credit one.
   */
  liabilities?: readonly RankableLiability[];
  /**
   * Whether LIABILITY targets (extra principal on a student loan / mortgage / other liability)
   * may draw a reserve.
   *
   * A SIBLING of `includeLoanTargets` rather than the same flag, and the reason is the one that
   * flag's own doc gives: the gate is about what the CALLER can credit, and the two credits come
   * from different projections. A caller that reduces `loanBalancesByFundId` has said nothing
   * about whether it can reduce `buildNonCCLiabilities`'s rows. Folding them into one flag would
   * have switched liability targets on at every existing `includeLoanTargets: true` call site the
   * moment this existed — including any future one that only implemented the vehicle half — and
   * the dollars would have left checking and landed nowhere.
   *
   * `forecast-engine.ts` step 4c-ii-c performs the credit, so the two hooks that feed it pass
   * `true`. Defaults FALSE for the same reason its sibling does.
   */
  includeLiabilityTargets?: boolean;
  /**
   * One month of essential cost (`computeEssentialMonthlyExpenses`) — what a STAGED goal's
   * thresholds are multiples of.
   *
   * Omitted ⇒ no goal is staged and every goal chases its plain `target_amount`, which is every
   * caller and every user until the feature is switched on. See {@link goalStages}.
   */
  essentialMonthlyExpenses?: number;
  /**
   * `accounts.account_type` per account id.
   *
   * Read for ONE purpose: deciding whether a goal's linked account makes its contributions subject
   * to the IRA annual limit ({@link goalMonthlyCeiling}). Omitted ⇒ no goal is IRA-capped, which is
   * how this module behaved before it paced anything — the DATE half of the pacing still applies,
   * because that is read off the target itself and needs no account at all.
   */
  accountTypes?: Readonly<Record<string, string | null | undefined>>;
};

/**
 * A debt-serviced non-CC liability, joined to the two ranking columns on its `accounts` row.
 *
 * Built by {@link buildRankableLiabilities}, and shared with `surplus-ranking.ts` (which needs the
 * name for the row the user drags) rather than declared twice — the ranked LIST and the
 * ALLOCATOR's input have to agree on which liabilities exist, and the surest way to make them
 * agree is for both to read the same rows.
 */
export type RankableLiability = {
  id: string;
  name: string;
  /** `student_loan` / `mortgage` / `other_liability` — what the row calls itself. */
  account_type: string;
  /** The account's live balance: what is still owed, and therefore the most extra principal can
   *  absorb this month. */
  balance: number;
  /**
   * `accounts.surplus_sort_order`. NON-NULL IS THE OPT-IN, and it is the whole opt-in: the
   * `accounts` table has no `auto_extra` column, so unlike a goal or a car fund a liability
   * cannot record "ranked but switched off". A null — which is every row of every user today —
   * means this liability is not in the ranked list and takes no surplus, exactly as a card that
   * has not been pulled out of the block is not in it. See `buildSurplusRankRows`.
   */
  surplus_sort_order?: number | null;
  /** Weight for a SPLIT rank. Null/absent ⇒ no split; see `allocateRankedSurplus`. */
  surplus_share?: number | null;
  /** `accounts.created_at`, the list's tie-break for two rows sharing a rank. */
  created_at?: string | null;
};

/** The ranking columns this module reads off an `accounts` row, on top of the debt-service ones. */
export type LiabilityRankColumns = {
  surplus_sort_order?: number | null;
  surplus_share?: number | null;
  created_at?: string | null;
};

/**
 * Every non-CC liability a user could rank, with its stored rank attached.
 *
 * ⚠️ THE ELIGIBILITY RULE IS NOT REPEATED HERE. `listDebtServiceLiabilities` owns it — active,
 * debt-serviced type, not a linked vehicle loan, paired to a `debts` row — and it is the same
 * function that decides which debts take cash out of the projection. One rule means the list a
 * user can rank and the list the engine actually pays cannot drift apart, which is the divergence
 * `non-cc-liabilities.ts` exists to have stopped happening once already.
 *
 * All this adds is the join back to `accounts.surplus_sort_order` / `surplus_share`, which that
 * helper deliberately knows nothing about.
 */
export function buildRankableLiabilities(params: {
  accounts: readonly (DebtServiceAccountInput & LiabilityRankColumns)[];
  debts: readonly LiabilityDebtInput[];
  rules: readonly DebtServiceRuleInput[];
  excludedAccountIds?: ReadonlySet<string>;
}): RankableLiability[] {
  const ranks = new Map(params.accounts.map(a => [a.id, a]));
  return listDebtServiceLiabilities(params).map(l => {
    const a = ranks.get(l.id);
    return {
      id: l.id,
      name: l.name,
      account_type: l.account_type,
      balance: l.balance,
      surplus_sort_order: a?.surplus_sort_order ?? null,
      surplus_share: a?.surplus_share ?? null,
      created_at: a?.created_at ?? null,
    };
  });
}

/** Half a cent. Below this a remaining need is rounding noise, not money. */
const CENT = 0.005;

/**
 * A saving-phase car fund's remaining OWN-CASH need: the down payment, less anything gifted and
 * less what is already saved. A fund in its loan phase is excluded entirely — the down payment is
 * spent, and its monthly loan payment is a bill, not a rankable extra.
 */
export function carFundRemainingNeed(
  fund: CarFund, fundingAccountId: string | null, linkedAccountBalance: number | null,
): number {
  if (fund.phase !== 'saving') return 0;
  const saved = getCarFundSaved(fund, fundingAccountId, linkedAccountBalance);
  const gifted = Math.max(0, Number(fund.gift_contribution) || 0);
  const need = (Number(fund.down_payment_goal) || 0) - gifted - saved;
  return need < CENT ? 0 : need;
}

/**
 * A LOAN-phase car fund's outstanding principal — the capacity of an "extra car payments" target.
 *
 * This is the other half of a car fund's life and it was previously not rankable at all: the fund
 * fell out of `carFundRemainingNeed` the moment it activated, so the one thing a user most wants
 * to throw surplus at — principal on a live auto loan — had nowhere to be ranked. Tre asked for it
 * by name on 2026-08-21 ("extra car payments should be on the list").
 *
 * The live linked-account balance wins when there is one. `current_balance_override` is filled in
 * by `applyLinkedLoanBalances` from the `accounts` row that IS the loan, and it is the real
 * outstanding principal; `loan_amount` is the ORIGINAL principal, frozen at activation, and using
 * it once payments had started would offer the user capacity they no longer owe.
 */
export function carLoanRemainingNeed(fund: CarFund): number {
  if (fund.phase !== 'loan') return 0;
  const override = fund.current_balance_override;
  const outstanding = override != null && Number.isFinite(Number(override))
    ? Number(override)
    : Number(fund.loan_amount) || 0;
  return outstanding < CENT ? 0 : outstanding;
}

/**
 * A non-CC liability's outstanding principal — the capacity of an "extra principal" target on a
 * student loan, a mortgage or any other `debts`-paired liability account.
 *
 * The ACCOUNT's own balance, because the connected account wins the balance over the `debts` row
 * everywhere else in this app (Tre, 2026-08-18: "if an account is connected the manual amount
 * should be disregarded"). Negative and unparseable read as 0, never as capacity the user does
 * not owe.
 */
export function liabilityRemainingNeed(liability: RankableLiability): number {
  const owed = Number(liability.balance);
  return !Number.isFinite(owed) || owed < CENT ? 0 : owed;
}

/**
 * A savings goal as this module needs it.
 *
 * Structural and all-optional, listing only the columns this module reads. That is genuinely what
 * the app's data layer hands back — `useSavingsGoals` returns `Partial<Tables<'savings_goals'>>[]`,
 * whose nullable columns do not even fit `Partial<SavingsGoal>` — and pretending otherwise at this
 * boundary would only move the lie one layer up. Every field is read defensively below, and a row
 * with no `id` is not a target at all.
 */
export type RankableGoal = {
  id?: string | null;
  sort_order?: number | null;
  auto_extra?: boolean | null;
  target_amount?: number | null;
  /** The goal's single date. Superseded by a per-stop `target_date` once stops exist; carried here
   *  so an UNSTAGED goal's one stop can still report the date the user set. */
  target_date?: string | null;
  /** The account this goal saves into. Read only to find its type, and only for the IRA ceiling;
   *  see {@link goalMonthlyCeiling}. */
  linked_account?: string | null;
  current_amount?: number | null;
  /** Weight for a SPLIT rank. Null/absent ⇒ no split; see `allocateRankedSurplus`. */
  surplus_share?: number | null;
  /**
   * THE PLANNED STOPS, in order — `savings_goals.stages`. Non-empty is the whole opt-in, and it
   * WINS over the two legacy columns below. Typed loosely because it arrives as `Json` off the
   * data layer; {@link goalStages} validates every entry it reads.
   */
  stages?: unknown;
  /**
   * LEGACY stage 1, in MONTHS of essential expenses, on top of `target_amount`.
   *
   * ⚠️ SUPERSEDED by `stages` and read only when `stages` is empty. Kept for one release so a row
   * the backfill missed keeps its plan instead of silently losing it; see the migration.
   */
  emergency_months_stage1?: number | null;
  /** LEGACY stage 2, in months, also on top of `target_amount`. See {@link goalStages}. */
  emergency_months_stage2?: number | null;
};

/**
 * WHY A STAGED GOAL IS A FEATURE AND NOT TWO GOALS (2026-08-26).
 *
 * Tre's sequence is: fill the move fund, then three months of expenses, then STOP and throw
 * everything at the cards, then come back for months four to six. The waterfall already funds one
 * rank at a time in order and the card block is already a rankable row, so that sequence LOOKS
 * expressible as two goals ranked either side of the cards — and it is a trap. A goal linked to a
 * savings ACCOUNT resolves `current_amount` FROM that account, so two goals pointing at one account
 * both report the same balance and both read as funded. Splitting it in the data would silently
 * double-count the very savings the feature exists to build.
 *
 * So it is ONE goal with two thresholds over ONE balance, and the hand-off to the cards needs no
 * new mechanism at all: **capacity 0 is already how a target yields its dollars to the next rank.**
 */
export type GoalStageContext = {
  /**
   * One month of essential cost — `computeEssentialMonthlyExpenses`. The thresholds are multiples
   * of this rather than stored dollars so they track the user's actual spending; see that module
   * for why a frozen figure goes wrong within months.
   */
  essentialMonthlyExpenses: number;
  /**
   * Revolving card balance still owed. ANY of it holds a staged goal at stage 1, which is the
   * hand-off Tre asked for. Zero (or no context at all) lets stage 2 open.
   */
  revolvingRemaining: number;
};

/**
 * ONE PLANNED STOP as it is stored, inside `savings_goals.stages`.
 *
 * Sized by EXACTLY ONE of `amount` (fixed dollars) or `months` (a multiplier over essential
 * expenses) — the database constraint enforces the same thing, because a stop sized by both would
 * have no single answer and one sized by neither would be a rank the user can drag that moves no
 * money.
 */
export type GoalStageInput = {
  id?: string | null;
  name?: string | null;
  /** Fixed dollars for THIS stop. Mutually exclusive with `months`. */
  amount?: number | null;
  /** Months of essential expenses for THIS stop. Mutually exclusive with `amount`. */
  months?: number | null;
  /** This stop's own date. Replaces the goal's single `target_date`, which could only ever describe
   *  one of them — on Tre's row it is the MOVE date and says nothing about the six-month stop. */
  target_date?: string | null;
  /**
   * ⚠️ LEGACY. "This stop waits until revolving credit-card debt is clear", from the first cut of
   * the feature, when a stop had no rank of its own and the hand-off had to be a flag.
   *
   * Tre, 2026-08-26: *"each should be freely re-orderable around the other items ... emergency 2
   * should be behind all the credit cards, then 3 is behind the loan."* A stop that carries its own
   * rank expresses that by SITTING there, and a flag saying the same thing in a second language can
   * only disagree with it. Read for one release to seed a stop's rank; never written again.
   */
  after_cards?: boolean | null;
  /**
   * This stop's own rank in "Where the extra money goes". Null on a stop that has never been
   * dragged; {@link goalStages} then seats it just after the stop above it.
   */
  sort_order?: number | null;
  /** This stop's own Auto extra tick. Every stop has one — Tre, 2026-08-26: "each part of the
   *  stagger should always have the choice of extra payments." */
  auto_extra?: boolean | null;
  /**
   * THIS STOP'S OWN SPLIT WEIGHT, so a stop can share a rank with something else.
   *
   * Tre, 2026-08-27: *"split stage 2 of savings with car loan."* A split is two targets at ONE
   * `sortOrder`, at least one of them carrying a weight (`allocateRankedSurplus`), and until this
   * key existed a later stop had nowhere to store one — `savings_goals.surplus_share` is a single
   * column and it belongs to stop 1. So a stop could be dragged anywhere and ticked on its own but
   * could never JOIN a rank, which is the one arrangement his sequence needs.
   *
   * Stop 1 falls back to the goal's column when it carries none of its own, exactly as
   * `auto_extra` does, so a goal that was split before it had stops keeps its weight.
   */
  surplus_share?: number | null;
  /**
   * THIS STOP IS MONEY THAT LEAVES. A move fund, a down payment, a wedding — saved up, then spent,
   * on this stop's own `target_date`.
   *
   * Tre, 2026-08-27: *"why dont i see the savings go up to the first goal then drop to 0 after the
   * payments? is there a bigger issue"* — there was. Nothing in the app ever SPENT a savings goal:
   * a car fund is spent at its purchase month, but a plain goal only ever grew, so a balance
   * earmarked for something counted toward net worth for ever and the cash it will really need
   * never left the projection.
   */
  spends?: boolean | null;
};

/** One stop, resolved into dollars against a live expense figure. */
export type GoalStop = {
  /** The stored stop id, or a positional fallback. What a write patches, and what keys a React
   *  list. NOT the ranked row's id — see {@link stopRowId}. */
  id: string;
  /** 1-based position in the plan. The plan's order, which a drag may never change. */
  index: number;
  name: string;
  /** THIS stop's own dollars. */
  size: number;
  /** CUMULATIVE dollars — what must be saved for this stop to be filled. */
  threshold: number;
  /** What must already be saved before this stop starts filling — the previous threshold. */
  floor: number;
  /** LEGACY, and only ever read to seed a rank. See `GoalStageInput.after_cards`. */
  afterCards: boolean;
  targetDate: string | null;
  /** This stop's own rank in the surplus list. */
  sortOrder: number;
  /** This stop's own Auto extra tick. */
  autoExtra: boolean;
  /** This stop's own SPLIT weight, or null for a stop that does not want one. See
   *  `GoalStageInput.surplus_share`. */
  share: number | null;
  /** This stop's money LEAVES on {@link targetDate}. See `GoalStageInput.spends`. */
  spends: boolean;
  /** True when the rank above was DERIVED rather than stored, i.e. this stop has never been
   *  dragged. Lets the list seat it sensibly without pretending the user chose the position. */
  rankIsDefault: boolean;
};

/**
 * The id a stop wears in "Where the extra money goes".
 *
 * The FIRST stop keeps the bare goal id, because that is the id every other surface already uses
 * for a goal — the forecast's `autoExtraByTarget`, the reachability verdicts, the pool it credits.
 * An unstaged goal is a goal with one stop, and it therefore keeps exactly the id it always had.
 */
export function stopRowId(goalId: string, index: number): string {
  return index <= 1 ? goalId : `${goalId}::stop${index}`;
}

/**
 * A goal's plan: its stops in order, and what the whole thing comes to.
 *
 * `staged: false` is an ordinary one-target goal, and it still carries ONE stop — the plain
 * `target_amount` — so that every caller can walk `stops` without a special case. `total` is the
 * last threshold, i.e. the number the goal is ultimately chasing.
 */
export type GoalStages = { staged: boolean; stops: GoalStop[]; total: number };

/** A positive months multiplier, or null. Zero, negative and unparseable are not stages. */
function monthsOf(raw: number | null | undefined): number | null {
  const n = Number(raw);
  return raw == null || !Number.isFinite(n) || n <= 0 ? null : n;
}

/**
 * A stored SPLIT weight, or null. Zero and negative are not weights — a rank divided by a weight of
 * zero has no answer — and they are dropped here so no consumer has to decide what they mean. The
 * same rule `buildRankedTargets` and `buildSurplusRankRows` already apply to the column version.
 */
function shareIn(raw: number | null | undefined): number | null {
  const n = Number(raw);
  return raw == null || !Number.isFinite(n) || n <= 0 ? null : n;
}

/** A non-negative dollar size, or null. */
function amountOf(raw: number | null | undefined): number | null {
  const n = Number(raw);
  return raw == null || !Number.isFinite(n) || n < 0 ? null : n;
}

/** The stored `stages` column as an array of candidate stops, or `[]` for anything else. */
function readStageInputs(raw: unknown): GoalStageInput[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is GoalStageInput => s != null && typeof s === 'object' && !Array.isArray(s));
}

/**
 * THE STOPS A GOAL PASSES THROUGH, in order, resolved into dollars.
 *
 * Tre, 2026-08-26: *"the original $5,730 should show as the first stage since its only for the move
 * fund part (that stage should immediately stop/drop once its done) ... also be able to add multiple
 * planned stops with target amounts."*
 *
 * So the move fund is not a BASE the stages are measured up from any more — it is stop #1 in its own
 * right, and thresholds are CUMULATIVE: stop N is reached at the sum of stops 1..N. That is what
 * lets a stop drop out of the list the moment it is filled without moving any of the others.
 *
 * Three shapes are read, in this order:
 *   1. `stages` non-empty  → the stops as stored. `target_amount` is NOT added; it is a cached
 *      display total the form rewrites on save, and adding it would double-count stop #1.
 *   2. LEGACY `emergency_months_stage1/2` → the same thresholds the two-column design produced
 *      (`target_amount`, +stage1 months, +stage2 months), expressed as three stops. Only reached by
 *      a row the migration's backfill missed.
 *   3. Neither → one stop, the plain `target_amount`, `staged: false`.
 */
export function goalStages(goal: RankableGoal, essentialMonthlyExpenses: number): GoalStages {
  const base = Number(goal.target_amount) || 0;
  const monthly = Number(essentialMonthlyExpenses);
  const hasMonthly = Number.isFinite(monthly) && monthly > 0;
  const goalRank = Number(goal.sort_order) || 0;
  const goalAutoExtra = goal.auto_extra === true;
  const goalShare = shareIn(goal.surplus_share);

  const unstaged = (): GoalStages => ({
    staged: false,
    stops: [{
      id: 'target', index: 1, name: 'Target', size: base, threshold: base, floor: 0,
      afterCards: false, targetDate: goal.target_date ?? null,
      sortOrder: goalRank, autoExtra: goalAutoExtra, share: goalShare,
      spends: false, rankIsDefault: false,
    }],
    total: base,
  });

  const build = (inputs: GoalStageInput[]): GoalStages => {
    let running = 0;
    const stops: GoalStop[] = [];
    for (const s of inputs) {
      const amount = amountOf(s.amount);
      const months = monthsOf(s.months);
      // A months-sized stop with no expense figure to multiply is not zero, it is UNKNOWN — and a
      // zero-size stop would silently read as already filled. Drop it rather than invent it.
      let size: number | null = null;
      if (amount != null && months == null) size = amount;
      else if (months != null && amount == null) size = hasMonthly ? months * monthly : null;
      if (size == null) continue;
      const floor = running;
      running += size;
      const index = stops.length + 1;
      const stored = Number(s.sort_order);
      const hasStoredRank = s.sort_order != null && Number.isFinite(stored);
      // A stop nobody has dragged sits one rank under the stop above it — or under the goal's own
      // rank, for the first one. That is a DEFAULT, not a choice, and `rankIsDefault` says so, so
      // the list can seat it without claiming the user put it there.
      const previous = stops[stops.length - 1];
      const fallback = previous == null ? goalRank : previous.sortOrder + 1;
      stops.push({
        id: typeof s.id === 'string' && s.id.length > 0 ? s.id : `stop-${index}`,
        index,
        name: (s.name ?? '').trim() || `Stop ${index}`,
        size,
        threshold: running,
        floor,
        afterCards: s.after_cards === true,
        targetDate: s.target_date ?? null,
        sortOrder: hasStoredRank ? stored : fallback,
        // The FIRST stop inherits the goal's own column, so a goal that was ticked before it had
        // stops keeps its tick. Later stops start unticked: a stop nobody has looked at must not
        // start diverting money.
        autoExtra: s.auto_extra != null ? s.auto_extra === true : (index === 1 && goalAutoExtra),
        // Same inheritance as the tick, and for the same reason: `savings_goals.surplus_share` is
        // the FIRST stop's weight and nothing else's, so a goal that was already half of a split
        // when it gained stops keeps that split. A later stop with no weight of its own is simply
        // not in one. ⚠️ `s.surplus_share === null` is a REAL VALUE — it is how a stop LEAVES a
        // split — so the fallback is keyed on the key being absent, never on the value being falsy.
        share: 'surplus_share' in s ? shareIn(s.surplus_share) : (index === 1 ? goalShare : null),
        // A stop with no date cannot be spent on one, so the flag alone is not enough.
        spends: s.spends === true && (s.target_date ?? null) != null,
        rankIsDefault: !hasStoredRank,
      });
    }
    return stops.length === 0 ? unstaged() : { staged: true, stops, total: running };
  };

  const stored = readStageInputs(goal.stages);
  if (stored.length > 0) return build(stored);

  const m1 = monthsOf(goal.emergency_months_stage1);
  if (m1 == null || !hasMonthly) return unstaged();
  const m2 = monthsOf(goal.emergency_months_stage2);
  const tailMonths = m2 != null && m2 > m1 ? m2 - m1 : null;
  return build([
    ...(base > 0 ? [{ name: 'First target', amount: base, target_date: goal.target_date ?? null }] : []),
    { name: 'Emergency runway', months: m1 },
    ...(tailMonths != null ? [{ name: 'Full runway', months: tailMonths, after_cards: true }] : []),
  ]);
}

/**
 * The first stop that still WAITS on the cards, or -1. Everything from it onwards is parked while
 * revolving debt is outstanding — cards clear once, so one gate is the whole gate.
 */
export function firstGatedStopIndex(stages: GoalStages): number {
  return stages.stops.findIndex(s => s.afterCards);
}

/** What must be saved before any stop is gated — i.e. the target while the cards still owe. */
export function openThresholdOf(stages: GoalStages): number {
  const gate = firstGatedStopIndex(stages);
  if (gate === -1) return stages.total;
  return gate === 0 ? 0 : stages.stops[gate - 1].threshold;
}

/**
 * A goal's remaining need. Negative (over-funded) reads as 0, never as a refund.
 *
 * ⚠️ WITHOUT `ctx` A STAGED GOAL REPORTS ITS BASE TARGET ONLY, and that under-report is the
 * deliberate choice: a caller that has not been taught to compute essential expenses cannot size
 * the stages, and offering capacity it cannot explain would move a user's money on a number nobody
 * derived. Every caller that CAN — the forecast, the card projection, the ranked list — passes it.
 */
export function goalRemainingNeed(goal: RankableGoal, ctx?: GoalStageContext): number {
  const saved = Number(goal.current_amount) || 0;
  const need = ctx == null
    ? (Number(goal.target_amount) || 0) - saved
    : stagedTargetFor(goal, ctx) - saved;
  return need < CENT ? 0 : need;
}

/**
 * The target a staged goal is chasing RIGHT NOW, given what is saved and what the cards still owe.
 *
 * Walk the stops in order and stop at the first one not yet filled. If that stop WAITS on the cards
 * and the cards still owe, the target is the threshold already reached instead — which makes the
 * remaining need zero, and capacity 0 is already how a rank yields its dollars to the next one.
 * Every stop is filled ⇒ the last threshold, i.e. nothing left to chase.
 */
export function stagedTargetFor(goal: RankableGoal, ctx: GoalStageContext): number {
  const stages = goalStages(goal, ctx.essentialMonthlyExpenses);
  const saved = Number(goal.current_amount) || 0;
  const cardsOwe = Number(ctx.revolvingRemaining) > 0;
  for (let i = 0; i < stages.stops.length; i++) {
    const stop = stages.stops[i];
    if (saved >= stop.threshold - CENT) continue;
    if (stop.afterCards && cardsOwe) return i === 0 ? 0 : stages.stops[i - 1].threshold;
    return stop.threshold;
  }
  return stages.total;
}

/**
 * The stop the goal is filling right now — the first one not yet complete, or the last one when
 * every stop is done. What a person reading a list needs to see; the ENGINE reads
 * {@link stagedTargetFor}, which also knows about the hand-off to the cards.
 */
export function currentStopOf(goal: RankableGoal, essentialMonthlyExpenses: number): GoalStop {
  const stages = goalStages(goal, essentialMonthlyExpenses);
  const saved = Number(goal.current_amount) || 0;
  return stages.stops.find(s => saved < s.threshold - CENT) ?? stages.stops[stages.stops.length - 1];
}

/**
 * THE MOST THIS GOAL MAY TAKE IN RANKED EXTRA THIS MONTH — month 0's copy of the forecast engine's
 * `monthlyCeilingFor`.
 *
 * ⚠️ WITHOUT THIS THE TWO SURFACES DISAGREE ABOUT THE FIRST MONTH. Months 1+ are paced inside
 * `forecast-engine.ts`; month 0 is decided here (`useCardProjection` → {@link buildRankedTargets}),
 * and until 2026-08-27 it was not paced at all — so a dated goal could reserve its WHOLE remaining
 * need in the month the user is actually standing in, while every later month took only that
 * month's figure. Same two limits, same smaller-wins rule, same `maxExtra`-beside-`capacity` shape,
 * so `holdsQueueBelow` can tell "on pace for this month" from "met entirely" here too.
 *
 * TWO LIMITS, AND THE SMALLER WINS. A statutory ceiling ("how much may go in this year") and a
 * deadline ("how much does this need per month to arrive on time") answer different questions, and
 * a target that has both is bound by both.
 *
 * ⚠️ THE YEAR IS ASSUMED UNUSED (`alreadyContributed: 0`), because nothing in this app records what
 * a person put into their IRA before today — no transaction feed is attributed to a statutory
 * allowance, and the forecast makes exactly the same assumption at the start of its own horizon.
 * Inventing a figure here would be worse: too high denies a real allowance, too low invents one.
 * The pacing this does give is the levelling, which is the half Tre asked for by name.
 *
 * Returns `{}` — no field at all, rather than an infinite one — when nothing limits the goal, which
 * is every undated goal not linked to an IRA.
 */
export function goalMonthlyCeiling(params: {
  goal: RankableGoal;
  /** THE STOP being paced. Its own date is the deadline; see below. */
  stop: GoalStop;
  /** The need being paced: what this stop still owes. */
  remainingNeed: number;
  /** Local `YYYY-MM-DD` — the month whose ceiling is being decided. */
  asOf: string;
  /** `accounts.account_type` per id. Absent ⇒ no statutory ceiling. */
  accountTypes?: Readonly<Record<string, string | null | undefined>>;
}): { maxExtra?: number } {
  const from = new Date(`${String(params.asOf ?? '').slice(0, 10)}T00:00:00`);
  if (Number.isNaN(from.getTime())) return {};

  // ⚠️ THE STOP'S OWN DATE, with the GOAL's date as the fallback for stop 1 ONLY — the same rule
  // `forecast-engine.ts` applies when it fills `targetDateByRowId`. A later stop with no date of
  // its own is genuinely undated, and inheriting the goal's date would invent a deadline.
  const stop = params.stop;
  const targetDate = stop.targetDate ?? (stop.index === 1 ? params.goal.target_date ?? null : null);

  const linkedType = params.goal.linked_account != null
    ? params.accountTypes?.[params.goal.linked_account]
    : null;
  const statutory = isIraCapped(linkedType)
    ? levelMonthlyAllowance({ annualCap: IRA_ANNUAL_LIMIT, alreadyContributed: 0, month: from.getMonth() })
    : Number.POSITIVE_INFINITY;
  const onTime = levelMonthlyToDate({
    remainingNeed: params.remainingNeed,
    monthsUntilDate: monthsUntilTargetDate(targetDate, from),
  });

  const allowance = Math.min(statutory, onTime);
  return Number.isFinite(allowance) ? { maxExtra: allowance } : {};
}

/**
 * The least this needs of a card. `CardData` satisfies it, and so does a raw credit-card `accounts`
 * row — which is deliberate: the ranked LIST holds account rows and the ALLOCATOR holds `CardData`,
 * and both have to compute this gate the same way or the two surfaces would disagree about whether
 * stage 2 is open. It costs nothing to be structural here because `buildCardData` sets
 * `autopayFullBalance` to exactly `balance <= 0`, so an account row that omits the flag sums
 * identically.
 */
export type RevolvingCard = {
  balance?: number | null;
  autopayFullBalance?: boolean;
};

/**
 * Revolving balance still owed across the user's cards — the gate that keeps a staged goal at
 * stage 1.
 *
 * A card on autopay-in-full is excluded for the same reason `buildRankedTargets` gives it
 * `autoExtra: false`: its balance is cleared by the autopay itself, so it is not debt anyone is
 * paying down and it must not hold the second stage shut for ever.
 */
export function revolvingRemainingOf(cards: readonly RevolvingCard[]): number {
  return cards.reduce((sum, c) => {
    if (c.autopayFullBalance) return sum;
    const bal = Number(c.balance);
    return Number.isFinite(bal) && bal > 0 ? sum + bal : sum;
  }, 0);
}

/**
 * The ranked list the allocator consumes.
 *
 * Cards contribute their minimum AND their balance as capacity, whatever their `auto_extra` —
 * there is no such thing as opting a card out of its minimum. Goals and car funds contribute a
 * minimum of 0: their manual `monthly_contribution` / `gift_contribution` is already a bill by the
 * time surplus is computed, so counting it again here would deduct the same dollars twice.
 */
export function buildRankedTargets(p: BuildRankedTargetsParams): RankedTarget[] {
  const {
    cards, carFunds, goals, strategy, asOf,
    cardsSortOrder = 0, fundingAccountId = null, accountBalances = {},
    cardRanks = {}, cardsShare = null, includeLoanTargets = false,
    liabilities = [], includeLiabilityTargets = false,
    essentialMonthlyExpenses = 0, accountTypes,
  } = p;

  // Built from the SAME `cards` the block is built from, so the gate that holds a staged goal at
  // stage 1 and the debt those dollars are being handed to are provably the same rows.
  const stageCtx: GoalStageContext = {
    essentialMonthlyExpenses,
    revolvingRemaining: revolvingRemainingOf(cards),
  };

  /** A stored weight, or undefined. Zero and negative are not weights and are dropped here so the
   *  allocator never has to decide what they mean. */
  const shareOf = (raw: number | null | undefined): number | undefined => {
    const n = Number(raw);
    return raw == null || !Number.isFinite(n) || n <= 0 ? undefined : n;
  };

  const balanceOf = (accountId: string | null) =>
    accountId != null && accountId in accountBalances ? accountBalances[accountId] : null;

  // Within the block, the strategy's own order — offset by index so the whole block still sits at
  // `cardsSortOrder` relative to everything else. Fractional so it can never collide with a
  // user-chosen integer rank.
  const payoffOrder = getStrategyPayoffOrder(cards, strategy, asOf);
  const rankWithinBlock = new Map(payoffOrder.map((e, i) => [e.cardId, i]));

  const cardTargets: RankedTarget[] = cards.map(c => {
    // `accounts.surplus_sort_order`. Null / absent ⇒ this card stays in the block, seated at the
    // fractional in-block rank that has always kept the block contiguous.
    const own = cardRanks[c.id]?.sortOrder;
    const solo = own != null && Number.isFinite(Number(own));
    return {
      id: c.id,
      kind: 'card' as const,
      sortOrder: solo
        ? Number(own)
        : cardsSortOrder + (rankWithinBlock.get(c.id) ?? payoffOrder.length) / (cards.length + 1),
      minimum: Math.max(0, c.minPayment),
      capacity: Math.max(0, c.balance),
      // A card the strategy is not paying down (autopay-in-full) takes no ranked surplus: its
      // balance is cleared by the autopay itself, so extra dollars there buy nothing.
      autoExtra: !c.autopayFullBalance,
      ...(solo ? { rankedIndividually: true as const } : {}),
      // A card still inside the block shares the BLOCK's weight, not its own: the block is one row
      // in the user's list, so a per-card weight there would be a weight on something the user
      // cannot see or set.
      ...(() => {
        const share = shareOf(solo ? cardRanks[c.id]?.share : cardsShare);
        return share === undefined ? {} : { share };
      })(),
    };
  });

  // A car fund is a SAVING target or a LOAN target, never both — `phase` decides, and each of the
  // two need helpers returns 0 for the other phase, so the pair below can never double-count one
  // fund. They share the row's single `sort_order` / `auto_extra` / `surplus_share`, which is
  // right: it is one thing in the user's list whose meaning changes when the car is bought.
  const carTargets: RankedTarget[] = carFunds.map(f => ({
    id: f.id,
    kind: 'car_fund' as const,
    sortOrder: f.sort_order,
    minimum: 0,
    capacity: carFundRemainingNeed(f, fundingAccountId, balanceOf(f.linked_account)),
    autoExtra: f.auto_extra,
    ...(shareOf(f.surplus_share) === undefined ? {} : { share: shareOf(f.surplus_share)! }),
  }));

  const loanTargets: RankedTarget[] = (includeLoanTargets ? carFunds : [])
    .filter(f => f.phase === 'loan')
    .map(f => ({
      id: f.id,
      kind: 'loan' as const,
      sortOrder: f.sort_order,
      // ZERO, like a goal. The loan's scheduled payment is already a bill by the time surplus is
      // computed (`getTotalCarLoanMonthly` is subtracted upstream in both the hook and the
      // forecast), so charging it again here would take the same dollars twice.
      minimum: 0,
      capacity: carLoanRemainingNeed(f),
      autoExtra: f.auto_extra,
      ...(shareOf(f.surplus_share) === undefined ? {} : { share: shareOf(f.surplus_share)! }),
    }));

  // A non-CC liability is a target only once the user has RANKED it (`surplus_sort_order`
  // non-null), the same explicit act that pulls a card out of the block. There is no `auto_extra`
  // column on `accounts` to opt one out afterwards, so being in the list IS the opt-in — which is
  // also what keeps every existing user byte-identical, since the column is null on every row
  // until the feature is used.
  const liabilityTargets: RankedTarget[] = (includeLiabilityTargets ? liabilities : [])
    .filter(l => l.surplus_sort_order != null && Number.isFinite(Number(l.surplus_sort_order)))
    .map(l => ({
      id: l.id,
      kind: 'liability' as const,
      sortOrder: Number(l.surplus_sort_order),
      // ZERO, like a goal and like a vehicle loan. The liability's scheduled payment is already a
      // bill by the time surplus is computed (`buildOtherDebtPaymentSchedule` is subtracted upstream in
      // both the hook and the forecast), so charging it again here would take the same dollars
      // twice.
      minimum: 0,
      capacity: liabilityRemainingNeed(l),
      autoExtra: true,
      ...(shareOf(l.surplus_share) === undefined ? {} : { share: shareOf(l.surplus_share)! }),
    }));

  // ── ONE TARGET PER STOP, exactly as `forecast-engine.ts` builds months 1+ ────
  //
  // ⚠️ MONTH 0 USED TO BUILD ONE TARGET PER GOAL, at the GOAL's rank, with the GOAL's tick and the
  // GOAL's weight, carrying whatever `stagedTargetFor` said the current stop needed. Three ways
  // that disagreed with every later month the moment a plan had more than one stop:
  //   • THE RANK. Once stop 1 filled, the current stop was funded at the goal's own rank — so a
  //     runway the user deliberately dragged below the cards would be funded AHEAD of them in the
  //     one month they are standing in, and behind them in every month after.
  //   • THE TICK. `auto_extra` on the goal row is stop 1's tick. A user who unticks stop 1 and
  //     ticks stop 2 got the opposite of what they asked for in month 0, in both directions.
  //   • THE SPLIT. One row per goal cannot join a rank as a stop, which is exactly what Tre asked
  //     for on 2026-08-27 ("split stage 2 of savings with car loan").
  // Each stop is now its own row under `stopRowId`, which is the id every downstream surface
  // already speaks: the engine's `goalIdByTargetId` maps `<goal>::stopN` back to the goal before it
  // credits a pool, and month 0's `autoExtraPerTarget` is read straight into that same map.
  //
  // ⚠️ `auto_extra` is compared to `true`, never passed through. The allocator reads an OMITTED
  // `autoExtra` as opted IN, and a partial row can be missing the column entirely — so a bare
  // pass-through would silently divert surplus away from the cards on a row that never opted in.
  // `goalStages` has already applied that rule per stop.
  const goalTargets: RankedTarget[] = goals
    .filter((g): g is RankableGoal & { id: string } => typeof g.id === 'string')
    .flatMap(g => {
      const stages = goalStages(g, essentialMonthlyExpenses);
      const saved = Number(g.current_amount) || 0;
      return stages.stops.map(stop => {
        // THIS stop's own dollars — `buildSurplusRankRows` sizes its rows the same way, so the list
        // and the allocator cannot disagree about what a stop still owes. An unstaged goal is one
        // stop with `floor: 0`, which is `goalRemainingNeed` to the cent; it goes through
        // `goalRemainingNeed` anyway so the un-staged path stays literally the code it always was.
        const capacity = stages.staged
          ? Math.max(0, stop.threshold - Math.max(saved, stop.floor))
          : goalRemainingNeed(g, stageCtx);
        return {
          id: stopRowId(g.id, stop.index),
          kind: 'goal' as const,
          sortOrder: stop.sortOrder,
          minimum: 0,
          // ⚠️ THE WHOLE REMAINING NEED, and the month's allowance BESIDE it as `maxExtra`. Folding
          // the allowance into the capacity caps the month correctly but tells the waterfall the
          // need itself is that small, so a paced goal looks unmet for ever and holds every rank
          // below it for the whole pace (Tre, 2026-08-27: "pass the rest down to the next rank").
          capacity,
          autoExtra: stop.autoExtra,
          ...(stop.share == null ? {} : { share: stop.share }),
          // Month 0's half of the pacing the forecast engine applies to months 1+.
          ...goalMonthlyCeiling({
            goal: g, stop, remainingNeed: capacity, asOf, accountTypes,
          }),
        };
      });
    });

  return [...cardTargets, ...carTargets, ...loanTargets, ...liabilityTargets, ...goalTargets];
}


/** One planned outflow from a goal's balance: what leaves, and when. */
export type GoalWithdrawal = { stopId: string; date: string; amount: number };

/**
 * THE MONEY THIS GOAL IS GOING TO SPEND, and when.
 *
 * One entry per stop marked `spends`, at that stop's own date. A plan with no such stop returns
 * `[]`, which is every goal of every user until one is marked — so every caller that consumes this
 * is inert by default.
 */
export function goalWithdrawals(
  goal: RankableGoal, essentialMonthlyExpenses: number,
): GoalWithdrawal[] {
  return goalStages(goal, essentialMonthlyExpenses).stops
    .filter(s => s.spends && s.targetDate != null && s.size > 0)
    .map(s => ({ stopId: s.id, date: s.targetDate as string, amount: s.size }));
}

/**
 * What this goal has saved, counting money it has ALREADY SPENT as still achieved.
 *
 * ⚠️ WITHOUT THIS A SPENT STOP RE-OPENS AND IS RE-FUNDED. The thresholds are cumulative and
 * measured against the live balance, so the moment the move fund's $5,730 leaves the account the
 * plan reads "stop 1 unfilled" and starts saving for the move all over again — for a move that has
 * already happened. Progress through a plan is not the same thing as the balance in the account,
 * and this is where the two part company.
 */
export function goalSavedIncludingSpent(
  goal: RankableGoal, essentialMonthlyExpenses: number, asOf: Date,
): number {
  const saved = Number(goal.current_amount) || 0;
  const today = toLocalDateStr(asOf);
  const spent = goalWithdrawals(goal, essentialMonthlyExpenses)
    .filter(w => w.date <= today)
    .reduce((sum, w) => sum + w.amount, 0);
  return saved + spent;
}

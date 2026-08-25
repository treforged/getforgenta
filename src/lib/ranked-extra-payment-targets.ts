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
import type { RankedTarget } from './ranked-surplus-allocation';

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
  current_amount?: number | null;
  /** Weight for a SPLIT rank. Null/absent ⇒ no split; see `allocateRankedSurplus`. */
  surplus_share?: number | null;
};

/** A goal's remaining need. Negative (over-funded) reads as 0, never as a refund. */
export function goalRemainingNeed(goal: RankableGoal): number {
  const need = (Number(goal.target_amount) || 0) - (Number(goal.current_amount) || 0);
  return need < CENT ? 0 : need;
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
  } = p;

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
      // bill by the time surplus is computed (`sumOtherDebtPayments` is subtracted upstream in
      // both the hook and the forecast), so charging it again here would take the same dollars
      // twice.
      minimum: 0,
      capacity: liabilityRemainingNeed(l),
      autoExtra: true,
      ...(shareOf(l.surplus_share) === undefined ? {} : { share: shareOf(l.surplus_share)! }),
    }));

  // ⚠️ `auto_extra` is compared to `true`, never passed through. The allocator reads an OMITTED
  // `autoExtra` as opted IN, and a partial row can be missing the column entirely — so a bare
  // pass-through would silently divert surplus away from the cards on a row that never opted in.
  const goalTargets: RankedTarget[] = goals
    .filter((g): g is RankableGoal & { id: string } => typeof g.id === 'string')
    .map(g => ({
      id: g.id,
      kind: 'goal' as const,
      sortOrder: Number(g.sort_order) || 0,
      minimum: 0,
      capacity: goalRemainingNeed(g),
      autoExtra: g.auto_extra === true,
      ...(shareOf(g.surplus_share) === undefined ? {} : { share: shareOf(g.surplus_share)! }),
    }));

  return [...cardTargets, ...carTargets, ...loanTargets, ...liabilityTargets, ...goalTargets];
}

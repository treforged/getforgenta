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
 * WHY CARDS RANK AS A BLOCK. Cards are not individually rankable here, and that is not a
 * simplification — the payoff strategy (avalanche/snowball) already orders them, and it orders
 * them on the marginal APR, which is the rate the next dollar actually saves (`debt-payoff-order.ts`).
 * Letting a user drag one card above another would silently override the strategy they chose and
 * cost them interest. So the user ranks the BLOCK of cards against their goals and car funds, and
 * within the block the strategy still decides. `cardsSortOrder` is that block's rank.
 */

import type { CardData } from './credit-card-engine';
import type { CarFund, SavingsGoal } from './types';
import { getStrategyPayoffOrder } from './debt-payoff-order';
import { getCarFundSaved } from './vehicle-loan-engine';
import type { RankedTarget } from './ranked-surplus-allocation';

export type BuildRankedTargetsParams = {
  cards: readonly CardData[];
  carFunds: readonly CarFund[];
  goals: readonly SavingsGoal[];
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
};

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

/** A goal's remaining need. Negative (over-funded) reads as 0, never as a refund. */
export function goalRemainingNeed(goal: SavingsGoal): number {
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
  } = p;

  const balanceOf = (accountId: string | null) =>
    accountId != null && accountId in accountBalances ? accountBalances[accountId] : null;

  // Within the block, the strategy's own order — offset by index so the whole block still sits at
  // `cardsSortOrder` relative to everything else. Fractional so it can never collide with a
  // user-chosen integer rank.
  const payoffOrder = getStrategyPayoffOrder(cards, strategy, asOf);
  const rankWithinBlock = new Map(payoffOrder.map((e, i) => [e.cardId, i]));

  const cardTargets: RankedTarget[] = cards.map(c => ({
    id: c.id,
    kind: 'card' as const,
    sortOrder: cardsSortOrder + (rankWithinBlock.get(c.id) ?? payoffOrder.length) / (cards.length + 1),
    minimum: Math.max(0, c.minPayment),
    capacity: Math.max(0, c.balance),
    // A card the strategy is not paying down (autopay-in-full) takes no ranked surplus: its
    // balance is cleared by the autopay itself, so extra dollars there buy nothing.
    autoExtra: !c.autopayFullBalance,
  }));

  const carTargets: RankedTarget[] = carFunds.map(f => ({
    id: f.id,
    kind: 'car_fund' as const,
    sortOrder: f.sort_order,
    minimum: 0,
    capacity: carFundRemainingNeed(f, fundingAccountId, balanceOf(f.linked_account)),
    autoExtra: f.auto_extra,
  }));

  const goalTargets: RankedTarget[] = goals.map(g => ({
    id: g.id,
    kind: 'goal' as const,
    sortOrder: g.sort_order,
    minimum: 0,
    capacity: goalRemainingNeed(g),
    autoExtra: g.auto_extra,
  }));

  return [...cardTargets, ...carTargets, ...goalTargets];
}

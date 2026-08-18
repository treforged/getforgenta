// The Dashboard hero's two numbers, resolved from what the engine already computed.
//
// DIRECTION.md rule 2 wants the debt-free MONTH leading the page, and REDESIGN-PLAN.md
// decision 1 pins it to a DATE rather than a count. Both numbers already exist elsewhere:
// the payoff month is what `CreditCardEngine.tsx`'s "Payoff ETA" cell prints, and the floor
// comes from `getAugmentedMinSafeCash`. Nothing here re-derives either — this file only
// picks between readings the engine published and turns the winner into a calendar month.
//
// The resolution order is copied verbatim from CreditCardEngine.tsx's Payoff ETA cell
// (`simRevolvingPayoffMonth ?? forecastRevolvingPayoffMonth ?? per-card sim`) so /debt and
// the Dashboard cannot print different dates for the same plan. Change it in one place and
// the other surface silently disagrees, which is the defect this shared selector prevents.

import { firstRevolvingPayoffMonth } from './revolving-payoff';

/** Which of the three readings the answer came from. Surfaced for debugging and tests. */
export type PayoffSource = 'sim' | 'forecast' | 'perCard';

export interface RevolvingPayoff {
  /** 1-indexed month, month 1 = this month — the convention `payoffMonth` uses engine-wide. */
  month: number;
  /** First day of the calendar month the revolving debt clears. */
  date: Date;
  /** Whole months from `asOf`; 0 means "this month". */
  monthsAway: number;
  source: PayoffSource;
}

export interface RevolvingPayoffInput {
  /** `CardProjectionResult.simRevolvingPayoffMonth`. */
  simRevolvingPayoffMonth: number | null;
  /** `CardProjectionResult.forecastRevolvingPayoffMonth`. */
  forecastRevolvingPayoffMonth: number | null;
  /**
   * `CardProjectionResult.forecastAdjustedRevolvingBalances` — the per-card trajectory
   * `CreditCardEngine.tsx` feeds to `projectCardVariable` to produce the per-card
   * `payoffMonth` values its third fallback maxes over. Reading the first all-clear month
   * off that same map is the same answer without running a second simulation.
   */
  forecastAdjustedRevolvingBalances?: Map<string, number[]> | null;
  /** Card ids to consider, normally `simCards.map(c => c.id)`. */
  cardIds?: readonly string[];
  /** Projection horizon, normally `PROJECTION_MONTHS`. */
  months?: number;
}

/**
 * The month revolving card debt clears, or null when no reading resolves one.
 *
 * Null is a real answer and must be rendered as "no reading", never as month 0 or a date —
 * it means the plan does not clear inside the horizon, or the engine has not produced a
 * projection yet (house rule: never a confident zero).
 */
export function selectRevolvingPayoff(
  input: RevolvingPayoffInput,
  asOf: Date = new Date(),
): RevolvingPayoff | null {
  const {
    simRevolvingPayoffMonth,
    forecastRevolvingPayoffMonth,
    forecastAdjustedRevolvingBalances,
    cardIds,
    months,
  } = input;

  let month: number | null = null;
  let source: PayoffSource = 'sim';

  if (simRevolvingPayoffMonth != null && simRevolvingPayoffMonth > 0) {
    month = simRevolvingPayoffMonth;
    source = 'sim';
  } else if (forecastRevolvingPayoffMonth != null && forecastRevolvingPayoffMonth > 0) {
    month = forecastRevolvingPayoffMonth;
    source = 'forecast';
  } else if (forecastAdjustedRevolvingBalances && cardIds?.length && months && months > 0) {
    const perCard = firstRevolvingPayoffMonth(forecastAdjustedRevolvingBalances, [...cardIds], months);
    if (perCard != null && perCard > 0) {
      month = perCard;
      source = 'perCard';
    }
  }

  if (month == null) return null;

  const date = new Date(asOf.getFullYear(), asOf.getMonth() + month - 1, 1);
  return { month, date, monthsAway: month - 1, source };
}

/** Why the hero has no number to show. Each maps to its own honest empty copy. */
export type HeroEmptyReason =
  /** Nothing connected yet — the one action is to add an account. */
  | 'no-accounts'
  /** Cards are connected but the debt engine has not produced a projection yet. */
  | 'projecting'
  /** A converged plan exists and it does not clear the cards inside the horizon. */
  | 'no-payoff-in-range'
  /** No debt AND no cash-above-floor reading — nothing truthful to lead with. */
  | 'no-reading';

export type DashboardHeroState =
  /**
   * `hasOtherDebt` is carried on BOTH readings because the payoff date is a CREDIT-CARD
   * date — `selectRevolvingPayoff` reads the revolving engine and knows nothing about a
   * car loan, a mortgage or a student loan. A hero that says "debt free" over that date
   * while an auto loan runs three years past it is the confident-zero rule broken from
   * the other end: not a fabricated number, but a true number carrying a false claim.
   */
  | { kind: 'payoff'; payoff: RevolvingPayoff; cashAboveFloor: number | null; hasOtherDebt: boolean }
  /**
   * No interest-bearing debt, so cash above the floor IS the hero. `carriesCardBalance`
   * separates "owes nothing" from "pays the statement in full every month" — calling the
   * second one debt free would be a claim the data does not support. `hasOtherDebt` is the
   * same guard for the loans half: only a user with neither is actually debt free.
   */
  | { kind: 'cash'; cashAboveFloor: number; carriesCardBalance: boolean; hasOtherDebt: boolean }
  | { kind: 'empty'; reason: HeroEmptyReason };

export interface DashboardHeroInput {
  /** The user has at least one account on file. */
  hasAccounts: boolean;
  /**
   * Interest-bearing revolving balance today. Prefer the engine's own month-0 revolving
   * figure over raw card balances: a card paid in full each cycle carries a balance but no
   * revolving debt, and has no payoff month by construction.
   */
  revolvingDebt: number;
  /** Total balance across open cards, revolving or not. Only distinguishes the cash hero's copy. */
  cardBalance?: number;
  /**
   * Outstanding NON-CARD debt — loans, mortgages, anything the revolving engine does not
   * project. Use {@link nonCardLiabilityTotal} so this and the net-worth breakdown cannot
   * come to disagree about what counts as a card. Only ever narrows a claim; it can never
   * change WHICH hero is shown.
   */
  otherDebt?: number;
  /** Result of `selectRevolvingPayoff`. */
  payoff: RevolvingPayoff | null;
  /** Projected cash minus the safety floor. Null when there is no reading — never a zero. */
  cashAboveFloor: number | null;
  /** The debt engine has published a month-0 projection. */
  projectionReady: boolean;
}

/**
 * Which hero the Dashboard renders. Pure so the honest-fallback rule is testable rather
 * than asserted: every branch that lacks a number returns `empty` with a reason, and no
 * branch can produce a $0 or a fabricated date.
 */
export function selectDashboardHero(input: DashboardHeroInput): DashboardHeroState {
  const { hasAccounts, revolvingDebt, cardBalance = 0, otherDebt = 0, payoff, cashAboveFloor, projectionReady } = input;

  const hasOtherDebt = otherDebt > 0;

  if (!hasAccounts) return { kind: 'empty', reason: 'no-accounts' };

  if (revolvingDebt <= 0) {
    return cashAboveFloor != null
      ? { kind: 'cash', cashAboveFloor, carriesCardBalance: cardBalance > 0, hasOtherDebt }
      : { kind: 'empty', reason: 'no-reading' };
  }

  if (payoff) return { kind: 'payoff', payoff, cashAboveFloor, hasOtherDebt };

  return { kind: 'empty', reason: projectionReady ? 'no-payoff-in-range' : 'projecting' };
}

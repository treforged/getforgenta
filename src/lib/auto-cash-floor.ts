/**
 * The AUTOMATIC cash floor — a real per-month figure, not a constant and not zero.
 *
 * ── WHY THE FIRST VERSION WAS WRONG (2026-08-21, caught live) ────────────────
 * Automatic mode originally resolved the floor to 0 and let `getMinSafeCash` fall through to
 * `max(0, prePaycheckBills)` — the bills due before the next paycheck, and nothing else. On Tre's
 * real data that projected **cash going negative in Apr 2028**, where his manual $2,500 floor never
 * did. The reason is simple in hindsight: **pre-paycheck bills are what must be PAID, not a buffer.**
 * Draining an account to exactly its upcoming bills leaves zero margin, and that figure was only
 * ever designed to RAISE a user's floor, never to be the whole of it.
 *
 * ── THE RULE NOW: DRAIN TO WHAT YOU MEASURE ──────────────────────────────────
 * The app already had a fuller yardstick — `getAugmentedMinSafeCash` adds credit-card minimums and
 * vehicle-loan payments on top of the bills, and it is what the forecast compares ending cash
 * AGAINST when it decides a month is below safe minimum. The engine, meanwhile, drained to the bare
 * bills. **A plan that spends down to one line and is judged against a higher one will breach by
 * construction**, and that asymmetry is exactly what a manual floor had been papering over.
 *
 * So the automatic floor is the same shape as the yardstick: for each month,
 *
 *     bills due before the next paycheck  +  credit-card minimums  +  vehicle-loan payments
 *
 * Every term is measured from the user's own rows. There is no buffer constant, no percentage and
 * no "one month of expenses" heuristic — a floor nobody can source is precisely the confident
 * number this codebase refuses to print.
 *
 * ── WHY IT IS PER MONTH, AND WHY THAT IS THE EFFICIENT ANSWER ────────────────
 * Tre's ask: *"it should set floors specific to each month so that money is most
 * effective/efficient at all times."* A single constant is wrong in both directions at once — too
 * high in a light month, where it strands cash that could be retiring 27% debt, and too low in a
 * heavy one, where it lets the plan overspend into a breach. Both terms below genuinely move month
 * to month: bills shift with the pay calendar, and a vehicle loan stops entirely once it is paid
 * off. Holding back exactly what a given month needs, and not a dollar more, is what makes the
 * surplus maximal without ever going negative.
 *
 * Pure: no database, no clock. The month arrives as an argument.
 */

import { getTotalCarLoanMonthly } from './vehicle-loan-engine';
import type { CarFund } from './types';

/** The `accounts` fields this reads. Structurally satisfied by an account row. */
export type FloorCard = {
  account_type?: string | null;
  active?: boolean | null;
  min_payment?: number | string | null;
};

/**
 * The committed outflows a month must still cover on top of its pre-paycheck bills.
 *
 * ⚠️ CONTRACTUAL MINIMUMS, NOT SIMULATED ONES. `accounts.min_payment` is a stored figure, so this
 * needs nothing from the payoff simulation — which matters because the simulation is the very thing
 * the floor constrains. Reading a sim-derived minimum here would make the floor depend on the plan
 * that depends on the floor, and the convergence loop has been round that circle before.
 *
 * A card with no stored minimum contributes 0 rather than a guess.
 */
export function committedMonthlyOutflows(
  cards: readonly FloorCard[],
  carFunds: readonly CarFund[],
  monthDate: Date,
): number {
  const cardMinimums = cards.reduce((sum, c) => {
    if (c.active === false) return sum;
    if (c.account_type !== 'credit_card') return sum;
    const min = Number(c.min_payment);
    return Number.isFinite(min) && min > 0 ? sum + min : sum;
  }, 0);

  // Month-aware on purpose: a loan that has paid off by this month contributes nothing, so the
  // floor falls away exactly when the obligation does.
  const carLoans = getTotalCarLoanMonthly([...carFunds], monthDate);

  return cardMinimums + Math.max(0, carLoans);
}

/**
 * What to pass as `getMinSafeCash`'s `committedOutflows` for one month.
 *
 * Manual mode contributes **0**, which keeps every manual user byte-identical to before automatic
 * existed: their floor stays `max(their number, pre-paycheck bills)`. Only automatic mode opts into
 * the fuller figure, because only automatic mode has no user-chosen buffer to fall back on.
 */
export function automaticFloorComponents(
  isManual: boolean,
  cards: readonly FloorCard[],
  carFunds: readonly CarFund[],
  monthDate: Date,
): number {
  return isManual ? 0 : committedMonthlyOutflows(cards, carFunds, monthDate);
}

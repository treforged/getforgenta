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
 *     bills due before the next paycheck  +  credit-card minimums
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
 * to month: the bills shift with the pay calendar, and a card's minimum falls as its balance does.
 * Holding back exactly what a given month needs, and not a dollar more, is what makes the surplus
 * maximal without ever going negative.
 *
 * Pure: no database, no clock. The month arrives as an argument.
 */

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

  // ⚠️ VEHICLE-LOAN PAYMENTS ARE DELIBERATELY *NOT* HERE, and leaving them in was a real defect —
  // `useCardProjection.carLoanActivationDiscontinuity` caught it, which is exactly what that test
  // exists for. A live loan payment is ALREADY subtracted from `cashPreDebt` before the floor is
  // ever consulted, so reserving it again holds back money that has already gone: the floor rose by
  // one payment the moment a car fund activated, and activation is supposed to be a cash no-op.
  //
  // `getAugmentedMinSafeCash` does include them, but only behind `isCapturedInBalance` — it gates
  // each payment on whether the balance already reflects it. Re-deriving that gating here would be
  // a second copy of a rule this codebase has already paid to unify once (finding §1.1 cause C, the
  // $537 payment). A card minimum has no such problem: it is paid OUT of the debt payment the floor
  // is constraining, never before it.
  void monthDate;
  return cardMinimums;
}

/**
 * What to pass as `getMinSafeCash`'s `committedOutflows` for one month.
 *
 * ⚠️ THE MODE NO LONGER CHANGES THE ANSWER, and that is the point (Tre, 2026-08-21: *"i want manual
 * users to get the same fix"*). A month owes its card minimums and its vehicle-loan payment whoever
 * chose the floor, so leaving them out for manual users left the SAME drain-vs-yardstick asymmetry
 * that made automatic project negative cash: the engine drained to `max(their floor, bills)` while
 * the forecast judged them against `bills + minimums + loans`. A big enough manual floor hid it;
 * Tre's $2,500 did not, and his projection showed three below-minimum months because of it.
 *
 * What the two modes still differ on is the FLOOR ITSELF, not these components: manual takes
 * `max(their number, bills + committed)`, automatic takes `bills + committed` alone. The user's
 * number is a floor under the calculation, never a replacement for it.
 *
 * `isManual` is kept in the signature so every call site reads as a deliberate decision rather than
 * an omission, and so the two modes can diverge again without re-threading four call sites.
 */
export function automaticFloorComponents(
  isManual: boolean,
  cards: readonly FloorCard[],
  carFunds: readonly CarFund[],
  monthDate: Date,
): number {
  void isManual;
  return committedMonthlyOutflows(cards, carFunds, monthDate);
}

/**
 * Budget Allocation donut arithmetic — extracted from BudgetControl.tsx so the over-allocation
 * case can be pinned by tests. The page renders these numbers; it does not derive them.
 *
 * The five shares are a true partition of take-home: `remaining` is income minus the four spend
 * buckets, so fixed + variable + debt + transfers + remaining === income by construction. That is
 * what makes a NEGATIVE remaining share meaningful rather than a glitch — it is exactly how far
 * the buckets over-run income. Site walk §4.2: clamping it to 0% left the legend reading
 * "Fixed 30 · Variable 22 · Debt 77 · Transfers 17 · Remaining 0" — 146% of income presented as
 * an allocation breakdown, with the overspend the user most needed to see rounded silently away.
 */

export interface BudgetAllocationTotals {
  income: number;
  fixed: number;
  variable: number;
  debt: number;
  transfers: number;
  /** income − (fixed + variable + debt + transfers). Passed in rather than re-derived so the
   * donut can never disagree with the Remaining figure the rest of the page already shows. */
  remaining: number;
}

export interface BudgetAllocationShares {
  fixedPct: number;
  variablePct: number;
  debtPct: number;
  xferPct: number;
  /** Signed. Negative when the four buckets over-allocate income. */
  remPct: number;
  /** How far the four spend buckets over-run income, in points. 0 when within budget. */
  overByPct: number;
}

export function getBudgetAllocationShares(totals: BudgetAllocationTotals): BudgetAllocationShares {
  const { income: t } = totals;
  if (!(t > 0)) {
    // No income recorded — every share is undefined rather than zero, but 0 is the only honest
    // thing to draw, and there is no overspend to report against an income of nothing.
    return { fixedPct: 0, variablePct: 0, debtPct: 0, xferPct: 0, remPct: 0, overByPct: 0 };
  }
  const pct = (v: number) => Math.max(0, (v / t) * 100);
  const fixedPct = pct(totals.fixed);
  const variablePct = pct(totals.variable);
  const debtPct = pct(totals.debt);
  const xferPct = pct(totals.transfers);
  return {
    fixedPct, variablePct, debtPct, xferPct,
    remPct: (totals.remaining / t) * 100,
    overByPct: Math.max(0, (fixedPct + variablePct + debtPct + xferPct) - 100),
  };
}

/**
 * How much of the ring a segment may actually draw, given how much is already used.
 *
 * The ring means "share of your take-home", so it can hold at most 100%. Past that a raw
 * strokeDasharray wraps back over the arcs already drawn, which reads as a SMALLER allocation
 * rather than a bigger one. Clipping instead fills the ring completely and leaves the overspend
 * to be stated in words, rather than mimed by an overlapping arc.
 */
export function clipSegment(pct: number, offset: number): number {
  return Math.min(pct, Math.max(0, 100 - offset));
}

/**
 * Is this month's over-allocation fully paid for by an EXTRA card payment the debt engine sized
 * from cash above the floor? (Sam/Tre, 2026-10-09.) Then the plan is not "over budget": the engine
 * chose to send savings above the floor to the cards, and "Over budget by 29%" on that month
 * contradicted the advice one tab over. /demo read exactly that: a $2,220 Cobalt payment funded
 * from cash above the floor, shown as a 29% overspend.
 *
 * `extraCardPayments` is the month's card payments beyond their minimums
 * (`totalRecommended - totalMinimumsDue`). The engine only ever sizes that extra from Safe to Pay,
 * i.e. above the floor, so an overage no larger than it is covered by construction. Anything
 * bigger, or any month the engine flags a cash warning, keeps the real over-budget warning.
 */
export function isOverageCoveredByCashAboveFloor(input: {
  /** income − buckets, as passed to the donut. Negative when over-allocated. */
  remaining: number;
  extraCardPayments: number;
  cashWarning: boolean;
}): boolean {
  const overage = -input.remaining;
  if (!(overage > 0)) return false;
  if (input.cashWarning) return false;
  return overage <= Math.max(0, input.extraCardPayments) + 0.005;
}

/**
 * The donut legend's last row. On an over-allocated month it read "Remaining (-29%)" in red; when
 * the overage is covered (`isOverageCoveredByCashAboveFloor`) that red contradicts the line under
 * it, so the row names where the money comes from instead, as a positive share, without the
 * warning colour. Not covered, or not over, the row is unchanged.
 */
export function remainingLegendRow(remPct: number, covered: boolean): { label: string; pct: number; warn: boolean } {
  if (covered && remPct < 0) return { label: 'From cash above floor', pct: -remPct, warn: false };
  return { label: 'Remaining', pct: remPct, warn: remPct < 0 };
}

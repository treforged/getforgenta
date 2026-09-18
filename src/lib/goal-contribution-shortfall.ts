// WHEN THE FORECAST QUIETLY PAYS A GOAL LESS THAN ITS PLAN SAYS.
//
// Tre, 2026-09-17, about the move fund: "I can't do the move for the save up fund without
// sacrificing some other things." Measured on his real data the same week: the goal is configured
// at $510/month, and in November 2026 the engine contributes $279 - floor protection trimming the
// contribution so the month does not end below his cash floor. That is the sacrifice he is
// describing, it is the app making it on his behalf, and NOTHING ON SCREEN SAID SO. The Savings
// Goals page showed $510/mo and a completion date derived from it.
//
// ⚠️ THIS IS NOT A NUMBER THE PRODUCT COULD STAND BEHIND. A plan that states a monthly amount the
// engine does not intend to pay is a confident figure with a quieter figure underneath it, which
// this repo treats as never-ship regardless of how the screen looks.
//
// ⚠️ IT IS DELIBERATELY UNDER-REACHING, AND THE GAP IS STATED RATHER THAN HIDDEN. It reports only
// months where a contribution EXISTS and is SMALLER than planned. A month where the goal receives
// NOTHING has no row in `savingsGoalItems` at all - and an absent row is indistinguishable from
// "the contribution has not started yet", "the goal is already funded" and "trimmed to zero".
// Reporting absence as a shortfall would fire on every month after a goal completes, which is the
// cry-wolf shape that gets a warning switched off. Detecting the zeroed month needs the start
// date and the completion month as well, and that is a second slice.
//
// So: a reported shortfall is always real; an unreported month is not a guarantee.

/** One month where the engine paid less into a goal than the goal's own plan states. */
export interface ContributionShortfall {
  /** The engine's own month label, e.g. "Nov 2026" - not re-derived, so it cannot disagree. */
  month: string;
  /** The goal's configured monthly contribution. */
  planned: number;
  /** What the forecast actually allocated that month. */
  actual: number;
}

/** The shape this reads, kept minimal so callers can pass forecast rows directly. */
export interface ShortfallRow {
  month: string;
  savingsGoalItems?: { goalId?: string; amount: number }[];
}

/**
 * Months in which `goalId` receives less than `planned`.
 *
 * ⚠️ THE TOLERANCE IS HALF A CENT, NOT ZERO. These amounts come out of a convergence loop, so an
 * exact-equality comparison reports a one-thousandth-of-a-penny rounding artefact as the app
 * shortchanging somebody - a false alarm about money, which is the worst kind to raise.
 */
export function findContributionShortfalls(
  rows: readonly ShortfallRow[] | null | undefined,
  goalId: string | null | undefined,
  planned: number,
): ContributionShortfall[] {
  if (!rows || !goalId || !(planned > 0)) return [];
  const out: ContributionShortfall[] = [];
  for (const row of rows) {
    const item = row.savingsGoalItems?.find(g => g.goalId === goalId);
    // Absent is NOT zero here - see the header. Only a present-and-smaller amount counts.
    if (!item) continue;
    const actual = Number(item.amount);
    if (!Number.isFinite(actual)) continue;
    if (actual < planned - 0.005) out.push({ month: row.month, planned, actual });
  }
  return out;
}

/**
 * One sentence for the goal card, or null when there is nothing to say.
 *
 * It names the WORST month rather than the first, because that is the one that answers "how much
 * is this actually costing me", and it says WHY - a trimmed number with no reason reads as a bug.
 */
export function describeShortfall(shortfalls: readonly ContributionShortfall[]): string | null {
  if (shortfalls.length === 0) return null;
  const worst = shortfalls.reduce((a, b) => (b.actual < a.actual ? b : a));
  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
  return shortfalls.length === 1
    ? `Forecast trims this to ${money(worst.actual)} in ${worst.month} to hold your cash floor.`
    : `Forecast trims this in ${shortfalls.length} months, as low as ${money(worst.actual)} `
      + `in ${worst.month}, to hold your cash floor.`;
}

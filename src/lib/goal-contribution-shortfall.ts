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
  /** 585ec24a: a PACED goal's own schedule (index = row index). When given, each month is compared
   *  to ITS scheduled amount, not the flat `planned` - otherwise every deliberately small early
   *  month would be reported as a floor trim, which is the wrong reason. */
  plannedByIndex?: readonly number[],
): ContributionShortfall[] {
  if (!rows || !goalId || !(plannedByIndex || planned > 0)) return [];
  const out: ContributionShortfall[] = [];
  for (const [i, row] of rows.entries()) {
    const plannedHere = plannedByIndex ? (plannedByIndex[i] ?? 0) : planned;
    if (!(plannedHere > 0)) continue;
    const item = row.savingsGoalItems?.find(g => g.goalId === goalId);
    // Absent is NOT zero here - see the header. Only a present-and-smaller amount counts.
    if (!item) continue;
    const actual = Number(item.amount);
    if (!Number.isFinite(actual)) continue;
    if (actual < plannedHere - 0.005) out.push({ month: row.month, planned: plannedHere, actual });
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

/**
 * 585ec24a — the paced goal's plan, as one sentence for its card.
 *
 * Tre, 2026-09-18: "keep the date but we need to transfer less initially ... the goals is to save
 * on interest when there is credit card debt." His constraint 3 was that it MUST BE VISIBLE: a
 * schedule the card does not show is the "$510 on screen, $279 in the engine" defect made worse.
 * So it states THIS month's transfer (the amount to set a bank auto-transfer to), WHY it is low,
 * the LARGEST month ahead (constraint 4 - back-loading moves the risk later, so the worst month is
 * shown before he relies on it), and when the goal is fully saved.
 *
 * Month labels are the engine's own row labels, never re-derived. Null when there is no schedule.
 */
export function describePacedContribution(
  rows: readonly ShortfallRow[] | null | undefined,
  goalId: string | null | undefined,
  schedule: readonly number[] | null | undefined,
): string | null {
  if (!rows || rows.length === 0 || !goalId || !schedule) return null;
  let last = -1;
  let peak = -1;
  for (let i = 0; i < Math.min(schedule.length, rows.length); i++) {
    if (!(schedule[i] > 0.005)) continue;
    last = i;
    if (peak < 0 || schedule[i] > schedule[peak]) peak = i;
  }
  if (last < 0) return null;
  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const thisMonth = Number(rows[0].savingsGoalItems?.find(g => g.goalId === goalId)?.amount ?? 0);
  const why = 'It stays low while you carry card debt, so more goes to the card and you pay less interest';
  const rise = peak === last
    ? `It rises to ${money(schedule[peak])} in ${rows[peak].month}, when the goal is fully saved.`
    : `Largest month: ${money(schedule[peak])} in ${rows[peak].month}. Fully saved by ${rows[last].month}.`;
  return `Transfer ${money(thisMonth)} this month. ${why}. ${rise}`;
}

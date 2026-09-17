/**
 * A BACK-LOADED monthly pace for a dated goal — pure arithmetic, wired nowhere yet.
 *
 * Tre, 2026-09-17: *"weighted toward whichever has the nearest due date ... credit card should be
 * taken care of as soon as possible to reduce interest, and saving for the move fund since it's far
 * out can be delayed a little bit more to where it loads up more when necessary ... Just make sure
 * they both still hit their targets."*
 *
 * Today a dated goal is paced LEVEL: `remainingNeed / monthsLeft`, recomputed each month
 * (`goalMonthlyCeiling` for month 0, `monthlyCeilingFor` for months 1+). Level is the right default
 * and it is what he asked for in August. What it costs, when the goal shares a rank with a credit
 * card, is interest: every dollar the goal takes early is a dollar not killing a 29.99% balance,
 * and the goal's deadline is years out while the card's is this month.
 *
 * ── THE PROFILE, AND WHY THIS ONE ────────────────────────────────────────────
 * A linear ramp over the months that remain: with `n` months left the weights are 1, 2, … n, which
 * sum to n(n+1)/2, so THIS month's share is
 *
 *     need × 1 / (n(n+1)/2)  =  2 × need / (n × (n+1))
 *
 * Recomputed each month against the need that is actually left, that reproduces the whole ramp
 * without anyone having to store a schedule — the same shape as the level pace it replaces, which
 * is what keeps it honest under a mid-course change to the target or the date.
 *
 * ⚠️ IT ALWAYS FINISHES ON TIME, AND THAT IS THE PROPERTY TO TEST, NOT THE SHAPE. At n = 1 the
 * formula returns the whole remaining need (2×need/(1×2) = need), so the final month closes the
 * gap by construction however the earlier months went. A profile that is merely "smaller early"
 * without that identity would miss the date, which is the one thing he said must not happen.
 *
 * ⚠️ AND IT IS A CEILING, NOT A DEMAND. Like the level pace it replaces, it is the MOST the goal
 * may take in a month; a month with no surplus still gives it nothing, and the arithmetic above
 * then hands the shortfall to the months that follow rather than to the deadline.
 */

/** Half a cent. Below this a residual is rounding noise, not money. */
const CENT = 0.005;

/**
 * The most a dated goal may take THIS month under a back-loaded ramp.
 *
 * @param remainingNeed What this target still owes. Zero or less ⇒ 0.
 * @param monthsLeft    Whole months remaining INCLUDING this one. 1 ⇒ the whole need.
 *                      Zero, negative or non-finite ⇒ the whole need, because a deadline that has
 *                      arrived or cannot be read must never make the ceiling look generous.
 */
export function backLoadedMonthlyCeiling(remainingNeed: number, monthsLeft: number): number {
  if (!Number.isFinite(remainingNeed) || remainingNeed <= CENT) return 0;
  if (!Number.isFinite(monthsLeft) || monthsLeft <= 1) return remainingNeed;
  const n = Math.floor(monthsLeft);
  return (2 * remainingNeed) / (n * (n + 1));
}

/**
 * The level pace this would replace, stated here so the two can be compared in one place and in
 * one test rather than by reading two other files.
 */
export function levelMonthlyCeiling(remainingNeed: number, monthsLeft: number): number {
  if (!Number.isFinite(remainingNeed) || remainingNeed <= CENT) return 0;
  if (!Number.isFinite(monthsLeft) || monthsLeft <= 1) return remainingNeed;
  return remainingNeed / Math.floor(monthsLeft);
}

/**
 * Run a pace to its deadline and report what actually happened.
 *
 * Exists so "both still hit their targets" is an ASSERTION over the whole run rather than a claim
 * about one month. Returns the per-month amounts, the total paid, and what is still owed at the
 * end — which must be zero for any pace worth shipping.
 */
export function runPaceToDeadline(
  need: number,
  months: number,
  ceiling: (remaining: number, left: number) => number,
  /** Cash available each month. A short month is the interesting case, not the comfortable one. */
  availablePerMonth: (monthIndex: number) => number = () => Number.POSITIVE_INFINITY,
): { perMonth: number[]; paid: number; stillOwed: number } {
  let remaining = need;
  const perMonth: number[] = [];
  for (let i = 0; i < months; i += 1) {
    const cap = ceiling(remaining, months - i);
    const take = Math.max(0, Math.min(cap, remaining, availablePerMonth(i)));
    perMonth.push(take);
    remaining -= take;
  }
  return {
    perMonth,
    paid: need - remaining,
    stillOwed: remaining < CENT ? 0 : remaining,
  };
}

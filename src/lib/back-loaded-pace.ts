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
 * THE ONE DECISION: level pace, or back-loaded?
 *
 * Both wiring points call THIS - `goalMonthlyCeiling` for month 0 and `monthlyCeilingFor` for
 * months 1+ - so the two surfaces cannot come to disagree about a goal's first month, which is the
 * failure they are most exposed to, being different files computing the same month.
 *
 * ⚠️ IT TAKES THE LEVEL ALLOWANCE AND RETURNS IT UNCHANGED ON EVERY PATH IT DOES NOT OWN.
 * That is deliberate rather than defensive: an UNDATED goal must stay UNPACED, and the level
 * helper signals that with a non-finite allowance. Recomputing "unpaced" here from months-left
 * would be a second expression of the same rule, and the two would drift. A goal that is undated,
 * or that does not share its rank, comes back byte-identical to what shipped before.
 *
 * ⚠️ THE TRIGGER IS A SHARED RANK, NOT A DATE, AND THE SCOPE IS AN ASSUMPTION I STATED.
 * Tre, 2026-09-17: *"since it's splitting with prime visa, the interest-saving bones should be met
 * as much as possible."* The reason a goal should yield early is that the dollar it takes is a
 * dollar not killing a 29.99% balance - which only arises when it is SPLITTING with something
 * else. A lone dated goal has nothing to yield to, and back-loading it would delay the user's own
 * saving for no gain at all. So a stop with no `share` is untouched.
 *
 * ⚠️ THE RESIDUE, NAMED RATHER THAN IMPLIED: a stop sharing its rank with ANOTHER GOAL is
 * back-loaded too, and it should not be - neither is nearer-due, so there is no interest to save.
 * It is not distinguished here because the FORECAST ENGINE HOLDS NO CARD RANKS AT ALL (measured:
 * `cardsSortOrder`, `cardRanks` and `cardsShare` appear nowhere in `forecast-engine.ts`), so the
 * co-tenant's kind is knowable in `buildRankedTargets` and NOT in the months-1+ path. Splitting
 * the rule across the two would put month 0 and month 1 on different pace profiles, which is the
 * one failure this shared function exists to prevent. Closing it properly means threading card
 * ranks into the forecast engine - a change to a money engine's signature, not a guard.
 *
 * ⚠️ IT IS A RE-PROFILING, NEVER A RE-RANKING. The goal is delayed inside its own deadline
 * and never dropped: at one month left the back-loaded ceiling IS the whole remaining need, so the
 * date is met by construction. "Just make sure they both still hit their targets" is a property of
 * the whole RUN, so assert it with `runPaceToDeadline` and never from a single month.
 */
export function pacedMonthlyCeiling(p: {
  remainingNeed: number;
  /** Whole months remaining INCLUDING this one. */
  monthsLeft: number;
  /** What the level pace allows today. Returned unchanged wherever this function does not apply. */
  levelAllowance: number;
  /** This stop splits its rank with another target. */
  sharesRank: boolean;
}): number {
  if (!p.sharesRank) return p.levelAllowance;
  // Undated, or otherwise unpaced: leave it exactly as it was.
  if (!Number.isFinite(p.levelAllowance)) return p.levelAllowance;
  return backLoadedMonthlyCeiling(p.remainingNeed, p.monthsLeft);
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

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
 * ── ⚠️ WIRING WAS ATTEMPTED ON 2026-09-17 AND REVERTED. READ THIS BEFORE TRYING AGAIN. ──────
 *
 * Ada, ask `6237167a`. The wiring was built, gated and REVERTED on measurement — the arithmetic
 * below is sound and the two call sites are still the right ones, but wired as its own docstring
 * describes it REGRESSES Tre's real data. Three findings, in ascending cost:
 *
 * 1. `monthsLeft` HERE IS A PAYMENT COUNT, AND `monthsUntilTargetDate` IS NOT.
 *    That helper returns the months BETWEEN now and the date (0 = this month). Both pacers count
 *    the date's own month as a payment: `levelMonthlyToDate` divides by `months + 1`, and this
 *    file's `monthsLeft` is documented "INCLUDING this one". Passing the raw figure spread the
 *    ramp over 10 payments where the level pace uses 11 — it took MORE early, the opposite of the
 *    intent, and dumped the remainder a month early. Use `Math.max(1, trunc(months) + 1)`.
 *
 * 2. DO NOT HAND `Math.min(statutory, onTime)` IN AS `levelAllowance`. It looks like the obvious
 *    wiring and it silently blows the IRA annual cap. `pacedMonthlyCeiling` reads a FINITE
 *    allowance as "this goal is dated" and a non-finite `monthsLeft` as "the deadline is here,
 *    hand over everything" — and for an IRA-capped goal with NO target date both hold at once.
 *    MEASURED: remainingNeed 6000, monthsLeft Infinity, levelAllowance 583.33, sharesRank true
 *    ⇒ 6000. A year's legal allowance, ten times over, in one month, with nothing going red.
 *    Pace the DEADLINE half only, then re-apply `Math.min(statutory, paced)`.
 *
 * 3. 🚨 THE ONE THAT STOPPED IT SHIPPING: two real-data guards fail, in money-meaningful
 *    directions, identically under all three timezones. Measured with the feature ON and again
 *    with it OFF at both call sites — OFF, all 4 pass; ON, 2 fail. So it is this change, not drift.
 *      • `forecast-convergence.realData` — "payoff month regressed: expected 'Oct 2028' to be
 *        'Sep 2028'". The CARD is paid off a month LATER, which is against the very priority the
 *        feature exists to serve: "credit card should be taken care of as soon as possible to
 *        reduce interest".
 *      • `forecast-convergence.floorDeficit` — converged savings 5418.48 against a raw plan of
 *        5381.70, breaking that file's stated invariant that the savings line "MAY BACK OFF,
 *        NEVER INFLATE".
 *
 *    HYPOTHESIS, LABELLED AS ONE BECAUSE IT WAS NOT TESTED: the ramp recomputes from whatever is
 *    REMAINING each month, which is what lets it need no stored schedule — and that also makes it
 *    PATH-DEPENDENT in a way the level pace is not. Convergence re-runs the projection and moves
 *    those remainders, so the converged ramp and the raw ramp are different ramps. It would also
 *    explain the payoff slip: late in the run `2·need/(n(n+1))` approaches the whole need, so the
 *    goal soaks up the surplus exactly during the card's endgame.
 *
 *    ✅ TESTED 2026-09-22, AND HALF OF IT IS REFUTED. `back-loaded-pace.hypothesis.test.ts`.
 *    Measured on the pacers themselves, need 5730 over 11 payments, one month lost at a time -
 *    total absolute change across the months that FOLLOW:
 *
 *        month lost      level drift     ramp drift
 *            0             $520.91          $86.82
 *            2             $520.91         $123.12
 *            5             $520.91         $241.85
 *            8             $520.91         $677.18
 *
 *    BOTH pacers are path-dependent, and the ramp is markedly the STEADIER of the two for most
 *    of the run - it only overtakes near the deadline. The level pace's drift does not depend on
 *    WHEN the month was lost, because it simply re-divides what is left. So "path-dependent in a
 *    way the level pace is not" is FALSE; the true shape is "less sensitive early, more sensitive
 *    late". Neither pacer misses the date after a lost month.
 *
 *    🚨 AND THE REAL EXPLANATION IS ARITHMETIC, NOT CONVERGENCE. Back-loading is CASH-NEUTRAL:
 *    both pacers pay exactly `need` over the horizon, measured. **So it cannot save a penny of
 *    card interest on its own** - all it does is MOVE the goal's draw later. Over the first three
 *    months it frees $1,250.18; over the last three it takes $2,500.36 MORE than the level pace.
 *
 *    The reverted wiring deferred the goal's draw and left the freed cash as ordinary surplus for
 *    the engine to allocate by its own rules. If that surplus does not reach the CARD, the trade
 *    is: nothing gained early, and $2,500 more competition during the card's endgame - which is
 *    exactly a payoff month slipping from Sep to Oct 2028, and exactly the floorDeficit inflation.
 *
 *    **THE MISSING HALF IS REDIRECTION, NOT A BETTER RAMP**, and that matches Tre's own words:
 *    "the goals is to save on interest when there is credit card debt" names where the freed
 *    money must GO, which the wiring never implemented. Any future attempt has to move the
 *    deferred amount to card principal in the same step, or it is strictly worse than the level
 *    pace. That is still an engine change, so the "do not re-attempt as a wiring slice" below
 *    stands - but the reason is now measured rather than guessed.
 *
 *    WHAT A FIX PROBABLY NEEDS, and it is why this was not just pushed through: `sharesRank` is
 *    computed from static config (`stop.share != null`), so it stays true after the co-tenant card
 *    is paid off. Tre's words were "smaller now, larger once the CARDS ARE DOWN" — that is a
 *    condition on the card's live balance, which months 1+ cannot see. It is the residue already
 *    named below: closing it means threading card ranks into the forecast engine, a change to a
 *    money engine's signature rather than a guard. Do not re-attempt this as a wiring slice.
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

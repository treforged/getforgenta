/**
 * Privacy-preserving leaderboard metrics.
 *
 * All raw dollar amounts are kept on-device; only coarse buckets are ever
 * emitted. `null` indicates that there is no data to publish - it is *not*
 * the same as a zero bucket, which would falsely imply a failing metric.
 */

export type LeaderboardMetric = 'goal_progress' | 'savings_streak' | 'debt_payoff' | 'budget_adherence';

/**
 * WHICH METRICS THE APP CAN ACTUALLY PUBLISH TODAY — a switch nothing can fill must not be offered.
 *
 * ⚠️ MEASURED ON TRE'S ACCOUNT, 2026-09-13. He had all FOUR metrics switched on and a real, accepted
 * friendship, and only TWO rows had ever been written: `goal_progress` and `savings_streak`. The
 * other two published nothing because `Dashboard.tsx` passed `revolvingPeak`, `revolvingCurrent`
 * and `budgetCategories` as hardcoded `null` — honestly, and with a comment saying so. So two of
 * the four switches saved a preference the app could never act on, and he reported it the only way
 * it presents: "the data is not showing".
 *
 * ✅ `budget_adherence` WAS FIXED ON 2026-09-15 and left this list in the SAME commit as its
 * wiring. `Dashboard.tsx` now joins `budget_items` (the BUDGETED side) against
 * `expenseModel.byCategory` (the SPENT side) through `buildBudgetCategories` in
 * `leaderboard-budget.ts`. ⚠️ Neither source carries both halves — `budget_items` has no `spent`
 * column — and the helper PRO-RATES the budget to the day, because `byCategory` is month-to-date
 * and scoring it against a whole-month allowance would publish a flattering figure for most of
 * every month.
 * **Dropping a metric from this list and wiring it must always be ONE commit.** Split them and a
 * switch appears in front of somebody with nothing behind it — the exact defect this list exists
 * to prevent.
 *
 * ⚠️ `debt_payoff` STAYS, AND CANNOT BE RESCUED BY A PROXY. It is the share of your PEAK REVOLVING
 * balance you have cleared, and nothing in this database records a revolving balance over time —
 * no table in `public` matches `%balance%` or `%statement%` (re-checked against the database on
 * 2026-09-15 with a positive control, not assumed). `net_worth_snapshots.total_liabilities` is the
 * tempting stand-in and it is the wrong number: it includes the car loan, so every car payment
 * would inflate a "debt paid off" score on a board other people read. It needs balance history
 * captured first. Until then the honest state is UNAVAILABLE, said out loud, rather than a switch
 * that silently does nothing.
 *
 * ⚠️ ONE DECLARATION, READ BY BOTH THE SWITCHES AND THE BOARD. Two lists would drift within a
 * release and put a switch back in front of someone with nothing behind it.
 */
export const UNSOURCED_METRICS: ReadonlyArray<LeaderboardMetric> = ['debt_payoff'];

/** True when something in the app actually computes and publishes this metric. */
export function isMetricSourced(metric: LeaderboardMetric): boolean {
  return !UNSOURCED_METRICS.includes(metric);
}

/**
 * Convert a fraction to a privacy bucket.
 *
 * Returns an integer in {0,5,10,...,100}. Input is clamped to [0,1]; non-finite
 * values yield 0. The percentage is rounded half-up before being snapped to
 * the nearest multiple of 5.
 */
export function toBucket(fraction: number): number {
  if (!Number.isFinite(fraction)) {
    return 0;
  }
  // ⚠️ THE CLAMP IS DELIBERATELY DOUBLE, and a mutation run proved it is redundant rather than
  // load-bearing: deleting this first clamp leaves every one of the 32 tests green, because the
  // clamp on the return line produces the same answer for every input. It is kept anyway - this
  // function is the privacy boundary, the second clamp is one edit away from being "simplified"
  // out by someone who has not read this comment, and a redundant bound on a privacy gate is the
  // cheapest defence there is. Recorded as an EQUIVALENT MUTANT, not as a gap in the tests; a
  // test written specifically to kill it would be fitting the suite to the mutation.
  const clamped = Math.max(0, Math.min(1, fraction));
  const percent = Math.round(clamped * 100); // half-up rounding
  const bucket = Math.round(percent / 5) * 5;
  return Math.min(100, Math.max(0, bucket));
}

/**
 * Bucket the best goal-progress ratio.
 *
 * Returns null when no usable goal exists (so the absence is not reported as 0).
 */
export function goalProgressBucket(
  goals: ReadonlyArray<{ current_amount: number | null; target_amount: number | null }>
): number | null {
  let bestRatio: number | null = null;
  for (const g of goals) {
    // Bound to locals BEFORE testing them. `Number.isFinite` is not a type guard for `null`, so
    // testing the property in place forces a non-null assertion at the use site - and a `!` here
    // would be asserting the exact thing this function exists to be careful about.
    const current = g.current_amount;
    const target = g.target_amount;
    if (current === null || target === null) continue;
    if (!Number.isFinite(current) || !Number.isFinite(target) || target <= 0) continue;
    const ratio = current / target;
    if (bestRatio === null || ratio > bestRatio) {
      bestRatio = ratio;
    }
  }
  return bestRatio === null ? null : toBucket(bestRatio);
}

/**
 * Bucket the debt-payoff fraction.
 *
 * Returns null when no peak balance is recorded; a current balance above the
 * peak yields a 0 bucket, a negative current balance yields a 100 bucket.
 */
export function debtPayoffBucket(
  peakRevolvingBalance: number,
  currentRevolvingBalance: number
): number | null {
  if (!Number.isFinite(peakRevolvingBalance) || peakRevolvingBalance <= 0) {
    return null;
  }
  if (!Number.isFinite(currentRevolvingBalance)) {
    return null;
  }
  const fraction = (peakRevolvingBalance - currentRevolvingBalance) / peakRevolvingBalance;
  return toBucket(fraction);
}

/**
 * Bucket budget adherence across categories.
 *
 * Returns null when no category qualifies for the calculation.
 */
export function budgetAdherenceBucket(
  categories: ReadonlyArray<{ spent: number | null; budgeted: number | null }>
): number | null {
  let counted = 0;
  let onTrack = 0;
  for (const c of categories) {
    // Locals first, for the same reason as `goalProgressBucket` above.
    const spent = c.spent;
    const budgeted = c.budgeted;
    if (spent === null || budgeted === null) continue;
    if (!Number.isFinite(spent) || !Number.isFinite(budgeted) || budgeted <= 0) continue;
    counted++;
    if (spent <= budgeted) {
      onTrack++;
    }
  }
  return counted === 0 ? null : toBucket(onTrack / counted);
}

/**
 * Count consecutive non-negative weekly net-worth deltas ending at the most recent week.
 *
 * The result is capped (default 104 weeks) and never exceeds the cap.
 */
export function savingsStreakWeeks(
  weeklyNetWorthDeltas: ReadonlyArray<number>,
  cap: number = 104
): number {
  let streak = 0;
  for (let i = weeklyNetWorthDeltas.length - 1; i >= 0; i--) {
    const val = weeklyNetWorthDeltas[i];
    if (!Number.isFinite(val) || val < 0) {
      break;
    }
    streak++;
    if (streak >= cap) {
      return cap;
    }
  }
  return Math.min(streak, cap);
}

/**
 * Validate that a bucket value conforms to the database constraint for the given metric.
 *
 * Returns false for non-finite or non-integer values.
 */
export function isPublishableBucket(metric: LeaderboardMetric, value: number): boolean {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return false;
  }
  switch (metric) {
    case 'savings_streak':
      return value >= 0 && value <= 520;
    case 'goal_progress':
    case 'debt_payoff':
    case 'budget_adherence':
      return value >= 0 && value <= 100 && value % 5 === 0;
    default:
      return false;
  }
}

/**
 * Return the Monday of the week containing `now` as a `YYYY-MM-DD` string.
 *
 * Uses local date components; Sunday belongs to the week that started on the
 * previous Monday.
 */
export function weekStart(now: Date): string {
  const day = now.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
  const offset = (day + 6) % 7; // days since Monday; Sunday is 6, not 0
  // Built from LOCAL date parts at local midnight rather than by subtracting days from a copy of
  // `now`. Both give the right day almost always - but carrying the original time-of-day across a
  // DST boundary is exactly the shape that produces an off-by-one-day in one zone and not another,
  // and this repo runs its suite under three timezones because that bug has shipped before.
  // The Date constructor normalises a negative or overlarge day, so month and year roll correctly.
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

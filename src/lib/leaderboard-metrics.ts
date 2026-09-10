/**
 * Privacy-preserving leaderboard metrics.
 *
 * All raw dollar amounts are kept on-device; only coarse buckets are ever
 * emitted. `null` indicates that there is no data to publish - it is *not*
 * the same as a zero bucket, which would falsely imply a failing metric.
 */

export type LeaderboardMetric = 'goal_progress' | 'savings_streak' | 'debt_payoff' | 'budget_adherence';

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

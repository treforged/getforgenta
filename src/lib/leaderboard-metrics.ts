/**
 * Privacy-preserving leaderboard metrics.
 *
 * All raw dollar amounts are kept on-device; only coarse buckets are ever
 * emitted. `null` indicates that there is no data to publish - it is *not*
 * the same as a zero bucket, which would falsely imply a failing metric.
 */

/**
 * EVERY metric, as a value a test or a UI can iterate - and the SOURCE of the type below.
 *
 * ⚠️ **ONE DECLARATION, DELIBERATELY.** This file's header already records that two lists drift
 * within a release and put a switch in front of somebody with nothing behind it. A TS union is
 * not enumerable at runtime, so anything needing to iterate the metrics used to hand-write the
 * list again - and a hand-written list is blind to the metric nobody added to it. Adding
 * `achievements` on 2026-09-18 broke three assertions that had hardcoded `4`, which is that
 * defect announcing itself at the cheapest possible moment.
 */
export const ALL_LEADERBOARD_METRICS = [
  'goal_progress',
  'savings_streak',
  'debt_payoff',
  'budget_adherence',
  'achievements',
] as const;

export type LeaderboardMetric = (typeof ALL_LEADERBOARD_METRICS)[number];

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
 * ⚠️ `debt_payoff` STAYS, AND THE REASON RECORDED HERE UNTIL 2026-09-15 WAS FALSE. It is the
 * share of your PEAK REVOLVING balance you have cleared, so it needs a SERIES of dated balances per
 * card. The old header said no table in `public` matches `%balance%` or `%statement%`. Four do, and
 * `account_reconciliations` (`user_id, account_id, source_table, effective_date, actual_balance,
 * projected_balance`) is exactly the dated per-account balance history this metric was recorded as
 * lacking - AND IT ALREADY CARRIES DEBT ROWS, `source_table = 'debts'`.
 *
 * ⚠️ THE REFUSAL SURVIVES THE CORRECTION, FOR A DIFFERENT REASON: THERE IS NO HISTORY, ONLY
 * POINTS. Measured against the live database on 2026-09-15, with a positive control in the same
 * read (56 public tables, and the cash arm returns non-zero, so a zero here is a real absence):
 *
 *     select source_table, count(*), count(distinct user_id), count(distinct account_id),
 *            min(effective_date), max(effective_date)
 *       from public.account_reconciliations group by source_table;
 *
 *   accounts  33 rows / 2 users / 10 accounts / 2026-03-27 .. 2026-07-05
 *   debts      2 rows / 1 user  /  2 accounts / 2026-08-22 .. 2026-08-22
 *
 * and the discriminating count: accounts with MORE THAN ONE `effective_date` is **7 for `accounts`
 * and 0 for `debts`**. One dated point per card cannot yield a peak, and a peak computed from a
 * single sample is always 100% cleared or 0% - a flattering number on a board other people read.
 * This is sparse BY CONSTRUCTION, not by bad luck: rows are written only by a user-initiated
 * reconcile (`useAccountReconciliations().add`), never by an automatic capture.
 *
 * ⚠️ `net_worth_snapshots.total_liabilities` remains the tempting stand-in and remains the wrong
 * number: it includes the car loan, so every car payment would inflate a "debt paid off" score.
 *
 * SO THE WORK IS BALANCE CAPTURE FIRST - a second dated point per card, written without the user
 * remembering to reconcile - and the metric second. Until then the honest state is UNAVAILABLE,
 * said out loud, rather than a switch that silently does nothing. WHAT WOULD CHANGE THIS ANSWER:
 * the `debts` arm of that query showing accounts with more than one `effective_date`. Re-run it
 * rather than trusting this paragraph; it is a claim about data, and data moves.
 *
 * ✅ CAPTURE STARTED 2026-09-23: `net_worth_snapshots.revolving_balance`, the engine's month-0
 * revolving total, filled weekly on the newest row (src/lib/revolving-snapshot.ts). THE NEW
 * TEST FOR WIRING THIS METRIC: users with at least 3 non-null revolving_balance weeks.
 *   select count(*) from (select user_id from public.net_worth_snapshots
 *     where revolving_balance is not null group by user_id having count(*) >= 3) x;
 * Peak = max over that user's series, current = the newest value. Wire it and drop it from this
 * list in ONE commit, as budget_adherence was.
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
    // `achievements` is a COUNT, like the streak, so it shares the column's own 0..520 range
    // rather than the 5-multiple percentage bound the other three take. See
    // `achievementCountValue` for why a percentage is not available: there is no honest
    // denominator to divide by. The labels are adjacent deliberately - a comment between them
    // makes `no-fallthrough` read the first case as a non-empty body and the lint goes red.
    case 'savings_streak':
    case 'achievements':
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
 * How many badges this person holds, as a publishable value.
 *
 * ⚠️ **A COUNT, DELIBERATELY, AND NOT A PERCENTAGE.** `achievements.ts` records why: only lessons
 * are countable, because the social badges are a fixed pair and `og_founder` is a cohort nobody
 * can decide to join, so "a progress figure over the others would invent a denominator". A
 * percentage here would be a number nobody could stand behind, on somebody else's screen.
 *
 * ⚠️ **ZERO IS A REAL ANSWER AND `null` IS NOT.** Somebody who has earned nothing genuinely has
 * a count of zero, and publishing it is honest - the same call `savingsStreakWeeks` makes. Pass
 * `null` only when the badges have not been READ yet, so an unloaded query can never publish a 0
 * that a friend would read as "they have earned nothing".
 *
 * Caps at 520, the column's own bound, so a value that could not be stored is refused here rather
 * than as a 400 from Postgres.
 */
export function achievementCountValue(earnedCount: number, cap: number = 520): number | null {
  if (!Number.isFinite(earnedCount) || !Number.isInteger(earnedCount) || earnedCount < 0) {
    return null;
  }
  return Math.min(earnedCount, cap);
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

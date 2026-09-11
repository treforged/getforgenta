import {
  goalProgressBucket,
  savingsStreakWeeks,
  debtPayoffBucket,
  budgetAdherenceBucket,
  isPublishableBucket,
  type LeaderboardMetric,
} from './leaderboard-metrics';

/**
 * Deciding WHAT to publish to `leaderboard_snapshots`, as pure functions.
 *
 * The hook that writes is deliberately thin; everything that could be wrong lives here, where it
 * can be tested without a database.
 *
 * ⚠️ **THE RULE THIS FILE ENFORCES: A METRIC WHOSE INPUT IS MISSING IS NOT PUBLISHED AT ALL.**
 * Not published as 0, not published as last week's figure. `null` in, nothing out. The same
 * discipline `useNotificationCheck` follows for the signals it cannot source truthfully - and here
 * it matters more, because the number lands on somebody ELSE's screen, where they have no way to
 * tell a real 0 from a missing input.
 *
 * ⚠️ **AND A METRIC THAT IS NOT OPTED IN IS NEVER PUBLISHED**, whatever the caller passes. The
 * opt-in list is checked here rather than at the call site, so there is exactly one place that
 * decides and no way to forget it.
 */

export interface LeaderboardPublishInputs {
  /** Savings goals, as the app already holds them. `null` when they have not loaded. */
  goals: ReadonlyArray<{ current_amount: number | null; target_amount: number | null }> | null;
  /** Weekly net-worth deltas, OLDEST FIRST. `null` when they cannot be derived. */
  weeklyNetWorthDeltas: ReadonlyArray<number> | null;
  /** Highest revolving balance ever recorded, and the current one. `null` when unknown. */
  revolvingPeak: number | null;
  revolvingCurrent: number | null;
  /** Budget categories for this month. `null` when they have not loaded. */
  budgetCategories: ReadonlyArray<{ spent: number | null; budgeted: number | null }> | null;
}

export interface LeaderboardPublishRow {
  metric: LeaderboardMetric;
  bucketValue: number;
  week: string;
}

/**
 * Turn dated net-worth snapshots into one delta per week, oldest first.
 *
 * ⚠️ **A WEEK WITH NO SNAPSHOT BREAKS THE RUN RATHER THAN COUNTING AS FLAT.** Somebody who did not
 * open the app for a fortnight has no reading for those weeks, and treating "we do not know" as
 * "it did not fall" would award a streak nobody earned - the absent-rendered-as-a-value defect,
 * pointed at a claim about themselves that a friend then sees.
 *
 * Returns `null` when there are fewer than two snapshots, because a delta needs two readings and a
 * single snapshot is not a streak of one.
 */
export function weeklyNetWorthDeltas(
  snapshots: ReadonlyArray<{ snapshot_date: string; net_worth: number }>,
  weekStartOf: (d: Date) => string,
): number[] | null {
  const usable = snapshots.filter(
    (s) => typeof s.snapshot_date === 'string' && Number.isFinite(s.net_worth),
  );
  if (usable.length < 2) return null;

  // Last snapshot in each week wins - the week's closing reading.
  const byWeek = new Map<string, { date: string; value: number }>();
  for (const s of usable) {
    const parsed = new Date(`${s.snapshot_date}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) continue;
    const wk = weekStartOf(parsed);
    const held = byWeek.get(wk);
    if (!held || s.snapshot_date > held.date) {
      byWeek.set(wk, { date: s.snapshot_date, value: s.net_worth });
    }
  }

  const weeks = [...byWeek.keys()].sort();
  if (weeks.length < 2) return null;

  const deltas: number[] = [];
  for (let i = 1; i < weeks.length; i++) {
    const prevWeek = weeks[i - 1];
    const thisWeek = weeks[i];
    // A gap means an unmeasured stretch, and NaN is the honest value for it: `savingsStreakWeeks`
    // treats a non-finite entry as unknown and breaks the run on it.
    //
    // ⚠️ The change across a gap is pushed as NaN INSTEAD of as a delta, not as well as. It spans
    // several weeks, so publishing it as one week's movement would let a long unmeasured stretch
    // that happened to end higher count as a good week - a multi-week change wearing a weekly
    // label, which is the same category error as a counter whose meaning changes with context.
    if (!isConsecutiveWeek(prevWeek, thisWeek)) {
      deltas.push(NaN);
      continue;
    }
    const a = byWeek.get(prevWeek);
    const b = byWeek.get(thisWeek);
    if (!a || !b) continue;
    deltas.push(b.value - a.value);
  }
  return deltas;
}

/** Whether `later` is exactly seven days after `earlier`, both `YYYY-MM-DD` Mondays. */
function isConsecutiveWeek(earlier: string, later: string): boolean {
  const a = new Date(`${earlier}T00:00:00`);
  const b = new Date(`${later}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return false;
  // Compare by calendar days rather than by milliseconds: a DST boundary inside the week makes the
  // elapsed time 7 days plus or minus an hour, and an exact-milliseconds test would call a normal
  // week a gap twice a year.
  const days = Math.round((b.getTime() - a.getTime()) / 86_400_000);
  return days === 7;
}

/**
 * What should be written this week, given what the caller could source and what the user opted in
 * to. Returns only rows that are both enabled and computable, each already validated against the
 * database CHECK so a bad value fails here rather than as a 400 from Postgres.
 */
export function buildPublishPlan(
  inputs: LeaderboardPublishInputs,
  enabledMetrics: ReadonlyArray<LeaderboardMetric>,
  week: string,
): LeaderboardPublishRow[] {
  const enabled = new Set(enabledMetrics);
  const rows: LeaderboardPublishRow[] = [];

  const add = (metric: LeaderboardMetric, value: number | null) => {
    if (!enabled.has(metric)) return;
    if (value === null) return; // missing input: publish NOTHING, never a zero
    if (!isPublishableBucket(metric, value)) return;
    rows.push({ metric, bucketValue: value, week });
  };

  add('goal_progress', inputs.goals === null ? null : goalProgressBucket(inputs.goals));

  add(
    'savings_streak',
    inputs.weeklyNetWorthDeltas === null ? null : savingsStreakWeeks(inputs.weeklyNetWorthDeltas),
  );

  add(
    'debt_payoff',
    inputs.revolvingPeak === null || inputs.revolvingCurrent === null
      ? null
      : debtPayoffBucket(inputs.revolvingPeak, inputs.revolvingCurrent),
  );

  add(
    'budget_adherence',
    inputs.budgetCategories === null ? null : budgetAdherenceBucket(inputs.budgetCategories),
  );

  return rows;
}

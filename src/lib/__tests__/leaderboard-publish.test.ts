import { describe, it, expect } from 'vitest';
import { weeklyNetWorthDeltas, buildPublishPlan } from '../leaderboard-publish';
import { weekStart } from '../leaderboard-metrics';
import type { LeaderboardMetric } from '../leaderboard-metrics';

const WEEK = '2026-09-07';
const ALL: LeaderboardMetric[] = ['goal_progress', 'savings_streak', 'debt_payoff', 'budget_adherence'];

const EMPTY = {
  goals: null,
  weeklyNetWorthDeltas: null,
  revolvingPeak: null,
  revolvingCurrent: null,
  budgetCategories: null,
};

describe('buildPublishPlan - a missing input publishes NOTHING, never a zero', () => {
  it('publishes nothing at all when nothing could be sourced, even with every metric opted in', () => {
    expect(buildPublishPlan(EMPTY, ALL, WEEK)).toEqual([]);
  });

  it('publishes only the metrics whose inputs exist', () => {
    const plan = buildPublishPlan(
      { ...EMPTY, goals: [{ current_amount: 50, target_amount: 100 }] },
      ALL,
      WEEK,
    );
    expect(plan).toEqual([{ metric: 'goal_progress', bucketValue: 50, week: WEEK }]);
  });

  it('publishes nothing for a user with no usable goal, rather than a 0 a friend would read', () => {
    const plan = buildPublishPlan({ ...EMPTY, goals: [] }, ALL, WEEK);
    expect(plan).toEqual([]);
  });

  it('publishes nothing for debt when only one side of the pair is known', () => {
    expect(buildPublishPlan({ ...EMPTY, revolvingPeak: 1000, revolvingCurrent: null }, ALL, WEEK)).toEqual([]);
    expect(buildPublishPlan({ ...EMPTY, revolvingPeak: null, revolvingCurrent: 500 }, ALL, WEEK)).toEqual([]);
  });

  it('publishes a real 0, which is a reading and not an absence', () => {
    const plan = buildPublishPlan(
      { ...EMPTY, goals: [{ current_amount: 0, target_amount: 100 }] },
      ALL,
      WEEK,
    );
    expect(plan).toEqual([{ metric: 'goal_progress', bucketValue: 0, week: WEEK }]);
  });
});

describe('buildPublishPlan - opt-in is checked here, so no caller can forget', () => {
  it('publishes nothing when nothing is opted in, however much is computable', () => {
    const plan = buildPublishPlan(
      {
        goals: [{ current_amount: 50, target_amount: 100 }],
        weeklyNetWorthDeltas: [1, 1, 1],
        revolvingPeak: 1000,
        revolvingCurrent: 250,
        budgetCategories: [{ spent: 1, budgeted: 10 }],
      },
      [],
      WEEK,
    );
    expect(plan).toEqual([]);
  });

  it('publishes only the opted-in metric, not its computable neighbours', () => {
    const plan = buildPublishPlan(
      {
        goals: [{ current_amount: 50, target_amount: 100 }],
        weeklyNetWorthDeltas: [1, 1, 1],
        revolvingPeak: 1000,
        revolvingCurrent: 250,
        budgetCategories: [{ spent: 1, budgeted: 10 }],
      },
      ['debt_payoff'],
      WEEK,
    );
    expect(plan).toEqual([{ metric: 'debt_payoff', bucketValue: 75, week: WEEK }]);
  });

  it('stamps every row with the week it was asked for', () => {
    const plan = buildPublishPlan(
      { ...EMPTY, goals: [{ current_amount: 1, target_amount: 4 }] },
      ALL,
      '2026-01-05',
    );
    expect(plan[0].week).toBe('2026-01-05');
  });
});

describe('weeklyNetWorthDeltas', () => {
  const w = (d: string, v: number) => ({ snapshot_date: d, net_worth: v });

  it('is null for fewer than two readings - a delta needs two', () => {
    expect(weeklyNetWorthDeltas([], weekStart)).toBeNull();
    expect(weeklyNetWorthDeltas([w('2026-09-07', 100)], weekStart)).toBeNull();
  });

  it('is null when every reading falls in the same week', () => {
    expect(weeklyNetWorthDeltas([w('2026-09-07', 100), w('2026-09-09', 120)], weekStart)).toBeNull();
  });

  it('takes the last reading in each week and differences consecutive weeks', () => {
    // 08-31, 09-07 and 09-14 are consecutive Mondays.
    const out = weeklyNetWorthDeltas(
      [w('2026-08-31', 100), w('2026-09-02', 110), w('2026-09-07', 130), w('2026-09-14', 125)],
      weekStart,
    );
    expect(out).toEqual([20, -5]); // 110 -> 130 -> 125
  });

  /**
   * The case that stops a streak being awarded for weeks nobody measured.
   */
  it('breaks the run with NaN across a gap, instead of counting it as a good week', () => {
    const out = weeklyNetWorthDeltas([w('2026-08-31', 100), w('2026-09-21', 500)], weekStart);
    expect(out).toHaveLength(1);
    expect(Number.isNaN(out?.[0])).toBe(true);
  });

  it('does NOT also publish the cross-gap change as a weekly delta', () => {
    const out = weeklyNetWorthDeltas([w('2026-08-31', 100), w('2026-09-21', 500)], weekStart);
    // A naive implementation would emit [NaN, 400] and hand a 400 rise to the streak counter.
    expect(out).not.toContain(400);
  });

  it('ignores readings that are not numbers rather than treating them as zero', () => {
    const out = weeklyNetWorthDeltas(
      [w('2026-08-31', 100), { snapshot_date: '2026-09-07', net_worth: NaN }, w('2026-09-14', 150)],
      weekStart,
    );
    // The NaN row is dropped, leaving 08-31 and 09-14 two weeks apart - a gap, so NaN.
    expect(out).toHaveLength(1);
    expect(Number.isNaN(out?.[0])).toBe(true);
  });

  it('ignores an unparseable date rather than producing a bogus week', () => {
    const out = weeklyNetWorthDeltas(
      [w('2026-08-31', 100), w('not-a-date', 999), w('2026-09-07', 140)],
      weekStart,
    );
    expect(out).toEqual([40]);
  });

  it('treats a week spanning a DST change as consecutive, not as a gap', () => {
    // US DST ends 2026-11-01, inside the week beginning Monday 2026-10-26.
    const out = weeklyNetWorthDeltas([w('2026-10-26', 100), w('2026-11-02', 130)], weekStart);
    expect(out).toEqual([30]);
  });
});

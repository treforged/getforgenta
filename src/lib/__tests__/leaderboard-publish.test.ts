import { describe, it, expect } from 'vitest';
import { weeklyNetWorthDeltas, buildPublishPlan } from '../leaderboard-publish';
import { weekStart } from '../leaderboard-metrics';
import type { LeaderboardMetric } from '../leaderboard-metrics';

const WEEK = '2026-09-07';
const ALL: LeaderboardMetric[] = [
  'goal_progress',
  'savings_streak',
  'debt_payoff',
  'budget_adherence',
  'achievements',
];

const EMPTY = {
  goals: null,
  weeklyNetWorthDeltas: null,
  revolvingPeak: null,
  revolvingCurrent: null,
  budgetCategories: null,
  achievementsEarned: null,
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
        achievementsEarned: 7,
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
        achievementsEarned: 7,
      },
      ['debt_payoff'],
      WEEK,
    );
    expect(plan).toEqual([{ metric: 'debt_payoff', bucketValue: 75, week: WEEK }]);
  });

  it('excludes a computable achievement count when that metric is not opted in', () => {
    // The neighbour test above covers the other four. This one names `achievements` explicitly,
    // because it is the metric whose data lives in a table NO friend can read - so an accidental
    // publish here is the one that would put a number on a screen RLS deliberately keeps closed.
    // ⚠️ IT ASSERTS ONLY AN ABSENCE, so it is satisfied by the metric being DEAD - measured:
    // deleting the `add('achievements', ...)` call leaves this one GREEN while three others go
    // red. Its partner in the describe block below is what makes it non-vacuous; do not delete
    // that one thinking this covers the ground.
    const plan = buildPublishPlan({ ...EMPTY, achievementsEarned: 7 }, ['goal_progress'], WEEK);
    expect(plan).toEqual([]);
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

describe('buildPublishPlan - the achievement COUNT, ask 07150518 part 3', () => {
  it('publishes the raw count rather than a percentage, because there is no honest denominator', () => {
    const plan = buildPublishPlan({ ...EMPTY, achievementsEarned: 7 }, ALL, WEEK);
    expect(plan).toEqual([{ metric: 'achievements', bucketValue: 7, week: WEEK }]);
  });

  it('publishes a genuine ZERO, because nobody-has-earned-anything is a true answer', () => {
    // ⚠️ THE DISCRIMINATING PAIR WITH THE TEST BELOW. A count of 0 and an unread query are
    // different facts, and the whole point of the `null` is that they must not collapse into one.
    const plan = buildPublishPlan({ ...EMPTY, achievementsEarned: 0 }, ALL, WEEK);
    expect(plan).toEqual([{ metric: 'achievements', bucketValue: 0, week: WEEK }]);
  });

  it('publishes NOTHING while the badges are still loading', () => {
    // `null` is what Dashboard passes until `useAchievements` resolves. Were it to pass the empty
    // array's length instead, every friend would briefly read "0 badges" about somebody who has
    // earned plenty - a false claim about another person, which this repo has already shipped once
    // as a card falling through to "Private".
    const plan = buildPublishPlan({ ...EMPTY, achievementsEarned: null }, ALL, WEEK);
    expect(plan).toEqual([]);
  });

  it('refuses a fractional or negative count rather than rounding it', () => {
    expect(buildPublishPlan({ ...EMPTY, achievementsEarned: 2.5 }, ALL, WEEK)).toEqual([]);
    expect(buildPublishPlan({ ...EMPTY, achievementsEarned: -1 }, ALL, WEEK)).toEqual([]);
  });

  it('caps at the column bound so an absurd count fails here, not as a 400 from Postgres', () => {
    const plan = buildPublishPlan({ ...EMPTY, achievementsEarned: 99_999 }, ALL, WEEK);
    expect(plan).toEqual([{ metric: 'achievements', bucketValue: 520, week: WEEK }]);
  });
});

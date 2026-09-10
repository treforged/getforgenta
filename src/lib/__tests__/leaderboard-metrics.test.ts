import { describe, it, expect } from 'vitest';
import {
  toBucket,
  goalProgressBucket,
  debtPayoffBucket,
  budgetAdherenceBucket,
  savingsStreakWeeks,
  isPublishableBucket,
  weekStart,
  type LeaderboardMetric,
} from '../leaderboard-metrics';

/**
 * Phase 2 of the friends/leaderboard plan. These are the functions that decide what a FRIEND can
 * see, so the assertions below are deliberately about the privacy boundary rather than about
 * arithmetic convenience.
 *
 * Two properties are load-bearing and each has its own block:
 *   1. **Absent is not zero.** Every bucket function returns `null` when it has nothing to say.
 *      Returning 0 would tell a friend "this person has a goal and is at 0% of it", which is a
 *      confident wrong answer about someone else's money - the `?? 0` family this repo keeps
 *      finding.
 *   2. **No output is finer than a bucket.** A one-dollar change must never be visible.
 */

describe('toBucket - the privacy boundary', () => {
  it('only ever emits multiples of 5 in 0..100, across the whole input range', () => {
    for (let i = -50; i <= 150; i++) {
      const out = toBucket(i / 100);
      expect(out % 5, `input ${i / 100} produced ${out}`).toBe(0);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThanOrEqual(100);
      expect(Number.isInteger(out)).toBe(true);
    }
  });

  it('clamps rather than extrapolating', () => {
    expect(toBucket(-5)).toBe(0);
    expect(toBucket(0)).toBe(0);
    expect(toBucket(1)).toBe(100);
    expect(toBucket(99)).toBe(100);
  });

  it('returns 0 for values that are not numbers at all', () => {
    expect(toBucket(NaN)).toBe(0);
    expect(toBucket(Infinity)).toBe(0);
    expect(toBucket(-Infinity)).toBe(0);
  });

  it('rounds half-up', () => {
    expect(toBucket(0.025)).toBe(5);
    expect(toBucket(0.125)).toBe(15);
  });

  /**
   * The actual anti-inference property, and the reason buckets exist at all. A friend who watches
   * the number must not be able to read a small change out of it.
   */
  it('moves by at most one bucket for a one-dollar change on a $10,000 goal', () => {
    for (let dollars = 0; dollars <= 10_000; dollars += 1) {
      const a = toBucket(dollars / 10_000);
      const b = toBucket((dollars + 1) / 10_000);
      expect(Math.abs(b - a), `a $1 step at ${dollars} moved ${a} -> ${b}`).toBeLessThanOrEqual(5);
    }
  });
});

describe('goalProgressBucket', () => {
  it('is null - NOT 0 - when there is no usable goal', () => {
    expect(goalProgressBucket([])).toBeNull();
    expect(goalProgressBucket([{ current_amount: null, target_amount: null }])).toBeNull();
    expect(goalProgressBucket([{ current_amount: 10, target_amount: 0 }])).toBeNull();
    expect(goalProgressBucket([{ current_amount: 10, target_amount: -100 }])).toBeNull();
    expect(goalProgressBucket([{ current_amount: null, target_amount: 100 }])).toBeNull();
  });

  it('picks the BEST goal, not the first or the last', () => {
    expect(
      goalProgressBucket([
        { current_amount: 10, target_amount: 100 },
        { current_amount: 80, target_amount: 100 },
        { current_amount: 30, target_amount: 100 },
      ]),
    ).toBe(80);
  });

  it('ignores unusable goals rather than letting them drag the number down', () => {
    expect(
      goalProgressBucket([
        { current_amount: 50, target_amount: 100 },
        { current_amount: 5, target_amount: 0 },
        { current_amount: null, target_amount: 100 },
      ]),
    ).toBe(50);
  });

  it('clamps an over-funded goal to 100 rather than reporting above target', () => {
    expect(goalProgressBucket([{ current_amount: 500, target_amount: 100 }])).toBe(100);
  });

  it('reports a real zero as 0, which is different from having no goal', () => {
    expect(goalProgressBucket([{ current_amount: 0, target_amount: 100 }])).toBe(0);
  });
});

describe('debtPayoffBucket', () => {
  it('is null - NOT 0 - when no peak balance was ever recorded', () => {
    expect(debtPayoffBucket(0, 0)).toBeNull();
    expect(debtPayoffBucket(-1, 0)).toBeNull();
    expect(debtPayoffBucket(NaN, 0)).toBeNull();
  });

  it('is null when the current balance is unreadable, rather than guessing', () => {
    expect(debtPayoffBucket(1000, NaN)).toBeNull();
  });

  it('buckets the share paid down', () => {
    expect(debtPayoffBucket(1000, 500)).toBe(50);
    expect(debtPayoffBucket(1000, 0)).toBe(100);
    expect(debtPayoffBucket(1000, 1000)).toBe(0);
  });

  it('clamps a balance that grew past its previous peak to 0, not to a negative', () => {
    expect(debtPayoffBucket(1000, 4000)).toBe(0);
  });
});

describe('budgetAdherenceBucket', () => {
  it('is null - NOT 0 - when no category qualifies', () => {
    expect(budgetAdherenceBucket([])).toBeNull();
    expect(budgetAdherenceBucket([{ spent: 10, budgeted: 0 }])).toBeNull();
    expect(budgetAdherenceBucket([{ spent: null, budgeted: 100 }])).toBeNull();
  });

  it('counts at-or-under as on track, so spending exactly the budget is not a failure', () => {
    expect(budgetAdherenceBucket([{ spent: 100, budgeted: 100 }])).toBe(100);
    expect(budgetAdherenceBucket([{ spent: 101, budgeted: 100 }])).toBe(0);
  });

  it('is a share of the categories that COUNT, not of all rows supplied', () => {
    expect(
      budgetAdherenceBucket([
        { spent: 50, budgeted: 100 },
        { spent: 150, budgeted: 100 },
        { spent: 10, budgeted: 0 },
        { spent: null, budgeted: 100 },
      ]),
    ).toBe(50);
  });
});

describe('savingsStreakWeeks', () => {
  it('counts back from the MOST RECENT week and stops at the first fall', () => {
    expect(savingsStreakWeeks([1, 1, 1])).toBe(3);
    expect(savingsStreakWeeks([-1, 1, 1])).toBe(2);
    expect(savingsStreakWeeks([1, 1, -1])).toBe(0);
  });

  it('treats a flat week as continuing the streak', () => {
    expect(savingsStreakWeeks([0, 0, 0])).toBe(3);
  });

  it('breaks on an unknown week rather than claiming it', () => {
    expect(savingsStreakWeeks([1, NaN, 1])).toBe(1);
    expect(savingsStreakWeeks([1, 1, NaN])).toBe(0);
  });

  it('is 0 for no data', () => {
    expect(savingsStreakWeeks([])).toBe(0);
  });

  it('never exceeds the cap', () => {
    const long = new Array(500).fill(1);
    expect(savingsStreakWeeks(long)).toBe(104);
    expect(savingsStreakWeeks(long, 10)).toBe(10);
  });
});

describe('isPublishableBucket - mirrors the database CHECK', () => {
  const pctMetrics: LeaderboardMetric[] = ['goal_progress', 'debt_payoff', 'budget_adherence'];

  it('accepts what the bucket functions actually produce', () => {
    for (const m of pctMetrics) {
      for (let v = 0; v <= 100; v += 5) {
        expect(isPublishableBucket(m, v), `${m} ${v}`).toBe(true);
      }
    }
  });

  it('rejects a percentage that is not on a bucket boundary', () => {
    for (const m of pctMetrics) {
      expect(isPublishableBucket(m, 7)).toBe(false);
      expect(isPublishableBucket(m, 101)).toBe(false);
      expect(isPublishableBucket(m, -5)).toBe(false);
    }
  });

  it('allows a streak past 100 but not past the column constraint', () => {
    expect(isPublishableBucket('savings_streak', 104)).toBe(true);
    expect(isPublishableBucket('savings_streak', 520)).toBe(true);
    expect(isPublishableBucket('savings_streak', 521)).toBe(false);
    expect(isPublishableBucket('savings_streak', -1)).toBe(false);
  });

  it('rejects non-integers and non-numbers', () => {
    expect(isPublishableBucket('goal_progress', 7.5)).toBe(false);
    expect(isPublishableBucket('savings_streak', NaN)).toBe(false);
    expect(isPublishableBucket('savings_streak', Infinity)).toBe(false);
  });

  /**
   * Every bucket function's output must pass its own publish gate. Without this, the two could
   * drift and the mismatch would only surface as a 400 from Postgres in production.
   */
  it('accepts every value the bucket functions can emit', () => {
    for (let i = -50; i <= 150; i++) {
      expect(isPublishableBucket('goal_progress', toBucket(i / 100))).toBe(true);
    }
    expect(isPublishableBucket('savings_streak', savingsStreakWeeks(new Array(500).fill(1)))).toBe(
      true,
    );
  });
});

describe('weekStart', () => {
  /**
   * ⚠️ These run under UTC, America/New_York and Asia/Tokyo via `npm run test:tz`. A
   * `toISOString()`-based implementation passes under UTC and FAILS in New York for any evening
   * timestamp, which is exactly how a date bug has reached production in this repo before.
   */
  it('returns the Monday of the week for every day of that week', () => {
    // 2026-09-07 is a Monday.
    for (let d = 7; d <= 13; d++) {
      expect(weekStart(new Date(2026, 8, d, 12, 0, 0))).toBe('2026-09-07');
    }
  });

  it('puts Sunday in the week that STARTED on the previous Monday', () => {
    // 2026-09-13 is a Sunday.
    expect(weekStart(new Date(2026, 8, 13, 23, 59, 59))).toBe('2026-09-07');
    // 2026-09-14 is the next Monday.
    expect(weekStart(new Date(2026, 8, 14, 0, 0, 0))).toBe('2026-09-14');
  });

  it('is stable late in the evening, when a UTC-based implementation rolls over', () => {
    expect(weekStart(new Date(2026, 8, 13, 20, 30, 0))).toBe('2026-09-07');
    expect(weekStart(new Date(2026, 8, 13, 21, 0, 0))).toBe('2026-09-07');
    expect(weekStart(new Date(2026, 8, 14, 0, 30, 0))).toBe('2026-09-14');
  });

  it('rolls back across a month and a year boundary', () => {
    // 2027-01-01 is a Friday; its Monday is 2026-12-28.
    expect(weekStart(new Date(2027, 0, 1, 9, 0, 0))).toBe('2026-12-28');
    // 2026-03-04 is a Wednesday; its Monday is 2026-03-02.
    expect(weekStart(new Date(2026, 2, 4, 9, 0, 0))).toBe('2026-03-02');
  });

  it('always returns a zero-padded YYYY-MM-DD', () => {
    expect(weekStart(new Date(2026, 0, 8, 9, 0, 0))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(weekStart(new Date(2026, 8, 9, 9, 0, 0))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

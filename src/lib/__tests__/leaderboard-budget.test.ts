import { describe, it, expect } from 'vitest';
import { buildBudgetCategories, monthElapsedFraction } from '../leaderboard-budget';
import { budgetAdherenceBucket } from '../leaderboard-metrics';

describe('monthElapsedFraction', () => {
  it('counts the current day as whole', () => {
    // 2026-01-01 of a 31-day month.
    expect(monthElapsedFraction(new Date(2026, 0, 1))).toBeCloseTo(1 / 31, 10);
    expect(monthElapsedFraction(new Date(2026, 0, 31))).toBe(1);
  });

  it('uses the real length of each month, including a leap February', () => {
    expect(monthElapsedFraction(new Date(2026, 1, 14))).toBeCloseTo(14 / 28, 10);
    expect(monthElapsedFraction(new Date(2024, 1, 14))).toBeCloseTo(14 / 29, 10);
    expect(monthElapsedFraction(new Date(2026, 3, 15))).toBeCloseTo(15 / 30, 10);
  });

  it('is always within (0, 1]', () => {
    for (let m = 0; m < 12; m++) {
      const last = new Date(2026, m + 1, 0).getDate();
      for (const d of [1, Math.ceil(last / 2), last]) {
        const f = monthElapsedFraction(new Date(2026, m, d));
        expect(f).toBeGreaterThan(0);
        expect(f).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('buildBudgetCategories', () => {
  const LAST_DAY = new Date(2026, 0, 31); // elapsed = 1, so budgets pass through unscaled

  it('returns null rather than an empty list when there is nothing to report', () => {
    expect(buildBudgetCategories(null, { Food: 10 }, LAST_DAY)).toBeNull();
    expect(buildBudgetCategories([], { Food: 10 }, LAST_DAY)).toBeNull();
    // Present but unusable: a zero budget cannot be adhered to or overrun.
    expect(buildBudgetCategories([{ category: 'Food', amount: 0 }], { Food: 10 }, LAST_DAY)).toBeNull();
    expect(buildBudgetCategories([{ category: null, amount: 100 }], {}, LAST_DAY)).toBeNull();
    expect(buildBudgetCategories([{ category: 'Food', amount: null }], {}, LAST_DAY)).toBeNull();
  });

  it('sums several items sharing one category', () => {
    const rows = buildBudgetCategories(
      [
        { category: 'Food', amount: 100 },
        { category: 'Food', amount: 50 },
      ],
      { Food: 120 },
      LAST_DAY,
    );
    expect(rows).toEqual([{ spent: 120, budgeted: 150 }]);
  });

  it('treats a budgeted category with NO spend row as spend 0, not as a missing row', () => {
    const rows = buildBudgetCategories(
      [
        { category: 'Food', amount: 100 },
        { category: 'Transport', amount: 80 },
      ],
      { Food: 20 }, // Transport never appears in byCategory
      LAST_DAY,
    );
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({ spent: 0, budgeted: 80 });
    // Both on track, so the bucket is 100 - dropping Transport would also give 100 and hide the bug.
    // The length assertion above is what actually discriminates.
    expect(budgetAdherenceBucket(rows!)).toBe(100);
  });

  it('PRO-RATES the budget to the day, which is the reason this helper exists', () => {
    // Day 15 of a 30-day month: half the budget has been earned.
    const midApril = new Date(2026, 3, 15);
    const rows = buildBudgetCategories([{ category: 'Food', amount: 300 }], { Food: 200 }, midApril);
    expect(rows).toEqual([{ spent: 200, budgeted: 150 }]);
    // $200 spent against $150 earned budget is OVER, and the un-prorated comparison
    // ($200 against $300) would have called it on track. That inversion is the whole point.
    expect(budgetAdherenceBucket(rows!)).toBe(0);
    expect(budgetAdherenceBucket([{ spent: 200, budgeted: 300 }])).toBe(100);
  });

  it('tolerates a missing or non-finite spend map without inventing a figure', () => {
    expect(buildBudgetCategories([{ category: 'Food', amount: 100 }], null, LAST_DAY))
      .toEqual([{ spent: 0, budgeted: 100 }]);
    expect(buildBudgetCategories([{ category: 'Food', amount: 100 }], { Food: NaN }, LAST_DAY))
      .toEqual([{ spent: 0, budgeted: 100 }]);
  });

  it('maps an empty-string category to Other, matching the expense model', () => {
    const rows = buildBudgetCategories([{ category: '', amount: 100 }], { Other: 40 }, LAST_DAY);
    expect(rows).toEqual([{ spent: 40, budgeted: 100 }]);
  });
});

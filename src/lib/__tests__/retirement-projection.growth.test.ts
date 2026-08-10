// Finding 3 (N10 audit): the retirement milestones panel froze today's contribution
// flat for 20 years while the forecast chart on the same page scaled pct deductions
// with raises and promotions. These tests pin the panel-side math: pct-mode
// contributions scale with the income multiplier series (which mirrors the engine's
// promotion-snap + annual-raise-step rules), flat contributions do not, and with no
// growth the new path reproduces the old closed-form projection exactly.
import { describe, it, expect } from 'vitest';
import {
  projectBalance,
  projectMilestones,
  projectMilestonesWithGrowth,
  incomeMultipliersByMonth,
  monthlyContribForAccount,
  monthlyContribSplitForAccount,
  type IncomeGrowthAssumptions,
} from '../retirement-projection';

const NO_GROWTH: IncomeGrowthAssumptions = {
  incomeGrowthEnabled: false,
  incomeGrowth: 0,
  raiseMonth: 1,
  raiseMode: 'pct',
  promotions: [],
};

// Start in January so raise-month arithmetic is easy to reason about.
const START = new Date(2026, 0, 1);
const ANNUAL_BASE = 52000; // weeklyGross 1000 * 52

describe('incomeMultipliersByMonth', () => {
  it('is all 1s with growth disabled and no promotions', () => {
    const m = incomeMultipliersByMonth(NO_GROWTH, ANNUAL_BASE, START, 240);
    expect(m).toHaveLength(240);
    expect(m.every((x) => x === 1)).toBe(true);
  });

  it('steps ×(1+g) at each raise month and compounds yearly, skipping month 0', () => {
    const a: IncomeGrowthAssumptions = {
      ...NO_GROWTH,
      incomeGrowthEnabled: true,
      incomeGrowth: 10,
      raiseMonth: 1, // January — same as the start month, so the i>0 guard is exercised
    };
    const m = incomeMultipliersByMonth(a, ANNUAL_BASE, START, 30);
    expect(m[0]).toBe(1); // raise month at i=0 must NOT fire (engine's i>0 guard)
    expect(m[11]).toBe(1); // Dec 2026, before the first anniversary step
    expect(m[12]).toBeCloseTo(1.1, 10); // Jan 2027
    expect(m[24]).toBeCloseTo(1.21, 10); // Jan 2028 compounds
  });

  it('flat raise mode adds a flat annual amount relative to the current annual', () => {
    const a: IncomeGrowthAssumptions = {
      ...NO_GROWTH,
      incomeGrowthEnabled: true,
      incomeGrowth: 5200, // +$5,200/yr on a $52,000 base = ×1.1 at the first step
      raiseMonth: 1,
      raiseMode: 'flat',
    };
    const m = incomeMultipliersByMonth(a, ANNUAL_BASE, START, 26);
    expect(m[12]).toBeCloseTo(1.1, 10);
    // Second step adds 5200 against the NEW annual (57,200): 1.1 * (1 + 5200/57200)
    expect(m[24]).toBeCloseTo(1.1 * (1 + 5200 / 57200), 10);
  });

  it('a promotion snaps the multiplier to newSalary/base from its effective month', () => {
    const a: IncomeGrowthAssumptions = {
      ...NO_GROWTH,
      promotions: [{ effectiveDate: '2026-07-15', newAnnualSalary: 78000 }],
    };
    const m = incomeMultipliersByMonth(a, ANNUAL_BASE, START, 12);
    expect(m[5]).toBe(1); // Jun 2026
    expect(m[6]).toBeCloseTo(1.5, 10); // Jul 2026 onward
    expect(m[11]).toBeCloseTo(1.5, 10);
  });

  it('a past-dated promotion applies immediately at month 0', () => {
    const a: IncomeGrowthAssumptions = {
      ...NO_GROWTH,
      promotions: [{ effectiveDate: '2025-03-01', newAnnualSalary: 104000 }],
    };
    const m = incomeMultipliersByMonth(a, ANNUAL_BASE, START, 3);
    expect(m[0]).toBeCloseTo(2, 10);
  });

  it('ignores promotions when the base salary is zero (engine parity)', () => {
    const a: IncomeGrowthAssumptions = {
      ...NO_GROWTH,
      promotions: [{ effectiveDate: '2026-01-01', newAnnualSalary: 78000 }],
    };
    const m = incomeMultipliersByMonth(a, 0, START, 3);
    expect(m.every((x) => x === 1)).toBe(true);
  });
});

describe('projectMilestonesWithGrowth', () => {
  it('reproduces projectMilestones exactly when every multiplier is 1', () => {
    const flat = 200;
    const pct = 300;
    const ones = new Array(240).fill(1);
    const grown = projectMilestonesWithGrowth(10000, flat, pct, 7, ones);
    const legacy = projectMilestones(10000, flat + pct, 7);
    expect(grown.year1).toBeCloseTo(legacy.year1, 6);
    expect(grown.year5).toBeCloseTo(legacy.year5, 6);
    expect(grown.year10).toBeCloseTo(legacy.year10, 5);
    expect(grown.year20).toBeCloseTo(legacy.year20, 5);
  });

  it('scales only the pct share: with raises the pct account outgrows the flat one', () => {
    const a: IncomeGrowthAssumptions = {
      ...NO_GROWTH,
      incomeGrowthEnabled: true,
      incomeGrowth: 10,
      raiseMonth: 1,
    };
    const multipliers = incomeMultipliersByMonth(a, ANNUAL_BASE, START, 240);
    const pctGrown = projectMilestonesWithGrowth(0, 0, 500, 7, multipliers);
    const pctFlatBaseline = projectMilestones(0, 500, 7);
    expect(pctGrown.year1).toBeCloseTo(pctFlatBaseline.year1, 6); // no raise inside year 1
    expect(pctGrown.year20).toBeGreaterThan(pctFlatBaseline.year20 * 2); // 19 compounding raises

    // A purely flat contribution is untouched by the same multiplier series.
    const flatGrown = projectMilestonesWithGrowth(0, 500, 0, 7, multipliers);
    expect(flatGrown.year20).toBeCloseTo(pctFlatBaseline.year20, 5);
  });

  it('matches a hand-walked loop for a mid-window promotion', () => {
    const a: IncomeGrowthAssumptions = {
      ...NO_GROWTH,
      promotions: [{ effectiveDate: '2026-07-01', newAnnualSalary: 104000 }],
    };
    const multipliers = incomeMultipliersByMonth(a, ANNUAL_BASE, START, 240);
    const got = projectMilestonesWithGrowth(1000, 100, 250, 6, multipliers);
    const r = 6 / 100 / 12;
    let bal = 1000;
    for (let m = 0; m < 12; m++) {
      bal = bal * (1 + r) + 100 + 250 * (m >= 6 ? 2 : 1);
    }
    expect(got.year1).toBeCloseTo(bal, 8);
  });
});

describe('monthlyContribSplitForAccount', () => {
  const deductions = [
    { value: 5, mode: 'pct' as const, accountId: 'acct-1' }, // 5% of gross
    { value: 100, mode: 'flat' as const, accountId: 'acct-1' },
    { value: 50, mode: 'flat' as const, accountId: 'acct-2' }, // other account: excluded
  ];

  it('splits flat and pct shares and sums to the legacy total', () => {
    const split = monthlyContribSplitForAccount(deductions, 'acct-1', 2000, 26);
    expect(split.pct).toBeCloseTo(2000 * 0.05 * (26 / 12), 10);
    expect(split.flat).toBeCloseTo(100 * (26 / 12), 10);
    const legacy = monthlyContribForAccount(deductions, 'acct-1', 2000, 26);
    expect(split.flat + split.pct).toBeCloseTo(legacy, 10);
  });

  it('returns zeros for an account with no deductions', () => {
    const split = monthlyContribSplitForAccount(deductions, 'acct-3', 2000, 26);
    expect(split).toEqual({ flat: 0, pct: 0 });
  });
});

// Sanity pin on the untouched closed form, so a refactor of projectBalance that
// breaks the annuity math fails loudly here too.
describe('projectBalance', () => {
  it('zero rate degenerates to balance + contrib×months', () => {
    expect(projectBalance(1000, 100, 0, 24)).toBe(1000 + 2400);
  });
});

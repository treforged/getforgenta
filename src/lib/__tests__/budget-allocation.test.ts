import { describe, it, expect } from 'vitest';
import { getBudgetAllocationShares, clipSegment, isOverageCoveredByCashAboveFloor, remainingLegendRow, type BudgetAllocationTotals } from '../budget-allocation';

// Site walk §4.2. The Budget Allocation legend clamped its Remaining share at 0%, so an
// over-allocated month printed five shares summing to 146% with the overspend — the one number
// the user needed — showing as "Remaining (0%)".

const totals = (o: Partial<BudgetAllocationTotals> & { income: number }): BudgetAllocationTotals => {
  const fixed = o.fixed ?? 0, variable = o.variable ?? 0, debt = o.debt ?? 0, transfers = o.transfers ?? 0;
  return {
    income: o.income, fixed, variable, debt, transfers,
    remaining: o.remaining ?? o.income - (fixed + variable + debt + transfers),
  };
};

describe('getBudgetAllocationShares', () => {
  it('partitions a within-budget month into shares that sum to 100%', () => {
    const s = getBudgetAllocationShares(totals({ income: 10000, fixed: 3000, variable: 2200, debt: 2300, transfers: 1700 }));
    expect(s.fixedPct).toBeCloseTo(30);
    expect(s.variablePct).toBeCloseTo(22);
    expect(s.debtPct).toBeCloseTo(23);
    expect(s.xferPct).toBeCloseTo(17);
    expect(s.remPct).toBeCloseTo(8);
    expect(s.fixedPct + s.variablePct + s.debtPct + s.xferPct + s.remPct).toBeCloseTo(100);
    expect(s.overByPct).toBe(0);
  });

  it('reports the overspend as a NEGATIVE remaining share, not 0%', () => {
    // The exact §4.2 shape: 30 + 22 + 77 + 17 = 146% allocated.
    const s = getBudgetAllocationShares(totals({ income: 10000, fixed: 3000, variable: 2200, debt: 7700, transfers: 1700 }));
    expect(s.debtPct).toBeCloseTo(77);
    expect(s.remPct).toBeCloseTo(-46);
    expect(s.overByPct).toBeCloseTo(46);
  });

  it('keeps the five shares summing to 100% even when over budget', () => {
    const s = getBudgetAllocationShares(totals({ income: 10000, fixed: 3000, variable: 2200, debt: 7700, transfers: 1700 }));
    expect(s.fixedPct + s.variablePct + s.debtPct + s.xferPct + s.remPct).toBeCloseTo(100);
  });

  it('flags overspend exactly when remaining is negative', () => {
    const exact = getBudgetAllocationShares(totals({ income: 10000, fixed: 10000 }));
    expect(exact.remPct).toBeCloseTo(0);
    expect(exact.overByPct).toBe(0);

    const overByADollar = getBudgetAllocationShares(totals({ income: 10000, fixed: 10001 }));
    expect(overByADollar.remPct).toBeLessThan(0);
    expect(overByADollar.overByPct).toBeGreaterThan(0);
  });

  it('draws nothing and reports no overspend when there is no income', () => {
    for (const income of [0, -500]) {
      const s = getBudgetAllocationShares(totals({ income, fixed: 1200 }));
      expect(s).toEqual({ fixedPct: 0, variablePct: 0, debtPct: 0, xferPct: 0, remPct: 0, overByPct: 0 });
    }
  });
});

describe('clipSegment', () => {
  it('passes a segment through untouched while the ring has room', () => {
    expect(clipSegment(30, 0)).toBe(30);
    expect(clipSegment(22, 30)).toBe(22);
  });

  it('clips the segment that crosses 100% instead of letting it wrap', () => {
    // Debt at 77% starting from 52% used would wrap 29 points back over Fixed and Variable.
    expect(clipSegment(77, 52)).toBe(48);
  });

  it('draws nothing once the ring is full', () => {
    expect(clipSegment(17, 100)).toBe(0);
    expect(clipSegment(17, 146)).toBe(0);
  });

  it('never returns a positive width for a negative share', () => {
    expect(clipSegment(-46, 100)).toBeLessThanOrEqual(0);
    expect(clipSegment(-46, 0)).toBeLessThanOrEqual(0);
  });
});

describe('isOverageCoveredByCashAboveFloor (Plan banner, 2026-10-09)', () => {
  it('COVERED: the overage is an extra card payment funded above the floor (the /demo month)', () => {
    // 129% allocated: $1,355.46 over, while the engine sends $2,215.30 beyond the minimums.
    expect(isOverageCoveredByCashAboveFloor({ remaining: -1355.46, extraCardPayments: 2215.30, cashWarning: false })).toBe(true);
  });

  it('NOT COVERED: bills alone over-run income and the cards get only minimums', () => {
    expect(isOverageCoveredByCashAboveFloor({ remaining: -400, extraCardPayments: 0, cashWarning: false })).toBe(false);
  });

  it('NOT COVERED: the overage is bigger than the extra card payment', () => {
    expect(isOverageCoveredByCashAboveFloor({ remaining: -900, extraCardPayments: 500, cashWarning: false })).toBe(false);
  });

  it('NOT COVERED: the engine flags a cash warning, whatever the extra', () => {
    expect(isOverageCoveredByCashAboveFloor({ remaining: -100, extraCardPayments: 2000, cashWarning: true })).toBe(false);
  });

  it('exactly equal is covered; within budget is never "covered"', () => {
    expect(isOverageCoveredByCashAboveFloor({ remaining: -500, extraCardPayments: 500, cashWarning: false })).toBe(true);
    expect(isOverageCoveredByCashAboveFloor({ remaining: 0, extraCardPayments: 500, cashWarning: false })).toBe(false);
    expect(isOverageCoveredByCashAboveFloor({ remaining: 250, extraCardPayments: 500, cashWarning: false })).toBe(false);
  });
});

describe('remainingLegendRow (donut legend, 2026-10-09)', () => {
  it('covered month: names the source, positive share, no warning colour', () => {
    expect(remainingLegendRow(-29.4, true)).toEqual({ label: 'From cash above floor', pct: 29.4, warn: false });
  });

  it('uncovered overage: keeps the red "Remaining" with its negative share', () => {
    expect(remainingLegendRow(-29.4, false)).toEqual({ label: 'Remaining', pct: -29.4, warn: true });
  });

  it('within budget: plain "Remaining", covered flag or not', () => {
    expect(remainingLegendRow(12, false)).toEqual({ label: 'Remaining', pct: 12, warn: false });
    expect(remainingLegendRow(12, true)).toEqual({ label: 'Remaining', pct: 12, warn: false });
  });
});

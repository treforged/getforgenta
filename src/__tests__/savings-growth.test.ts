import { describe, it, expect } from 'vitest';
import { buildSavingsGrowthData, type GrowthGoalInput } from '@/lib/savings-growth';

const TODAY = new Date(2026, 0, 15); // Jan 2026, fixed so the suite is date-independent

const goal = (over: Partial<GrowthGoalInput> = {}): GrowthGoalInput => ({
  id: 'g1',
  name: 'Emergency Fund',
  currentAmount: 1000,
  monthlyContribution: 100,
  annualApyPercent: 0,
  contributionStartDate: null,
  lumpSums: [],
  ...over,
});

describe('buildSavingsGrowthData', () => {
  it('starts at the current balance and adds one contribution per month', () => {
    const { rows, series } = buildSavingsGrowthData([goal()], { months: 4, today: TODAY });
    const k = series[0].key;
    expect(rows.map(r => r[k])).toEqual([1000, 1100, 1200, 1300]);
    expect(rows.map(r => r.month)).toEqual(['Jan 26', 'Feb 26', 'Mar 26', 'Apr 26']);
  });

  it('accrues interest on the existing balance even before contributions start', () => {
    const { rows, series } = buildSavingsGrowthData(
      [goal({ monthlyContribution: 0, annualApyPercent: 12, contributionStartDate: '2026-06-01' })],
      { months: 3, today: TODAY },
    );
    const k = series[0].key;
    // 1% per month compounding from month 0, despite contributions starting in June
    expect(rows.map(r => r[k])).toEqual([1000, 1010, 1020.1]);
  });

  it('withholds contributions until the start month, then applies them', () => {
    const { rows, series } = buildSavingsGrowthData(
      [goal({ contributionStartDate: '2026-03-01' })],
      { months: 5, today: TODAY },
    );
    const k = series[0].key;
    // Mar 2026 is offset 2: first contribution lands there
    expect(rows.map(r => r[k])).toEqual([1000, 1000, 1100, 1200, 1300]);
  });

  it('applies planned lump sums in the month they are dated', () => {
    const { rows, series } = buildSavingsGrowthData(
      [goal({ monthlyContribution: 0, lumpSums: [{ date: '2026-03-10', amount: 7000 }] })],
      { months: 5, today: TODAY },
    );
    const k = series[0].key;
    expect(rows.map(r => r[k])).toEqual([1000, 1000, 8000, 8000, 8000]);
  });

  it('ignores lump sums already in the past (they are baked into the balance)', () => {
    const { rows, series } = buildSavingsGrowthData(
      [goal({ monthlyContribution: 0, lumpSums: [{ date: '2025-11-01', amount: 500 }, { date: '2026-01-05', amount: 500 }] })],
      { months: 3, today: TODAY },
    );
    const k = series[0].key;
    expect(rows.map(r => r[k])).toEqual([1000, 1000, 1000]);
  });

  it('keeps goals with identical names on separate series', () => {
    const { rows, series } = buildSavingsGrowthData(
      [goal({ id: 'a', currentAmount: 100 }), goal({ id: 'b', currentAmount: 500 })],
      { months: 2, today: TODAY },
    );
    expect(series[0].key).not.toBe(series[1].key);
    expect(rows[0][series[0].key]).toBe(100);
    expect(rows[0][series[1].key]).toBe(500);
  });

  it('does not cap the projection at the target amount', () => {
    const { rows, series } = buildSavingsGrowthData(
      [goal({ currentAmount: 5000, monthlyContribution: 1000 })],
      { months: 3, today: TODAY },
    );
    const k = series[0].key;
    expect(rows[2][k]).toBe(7000);
  });
});

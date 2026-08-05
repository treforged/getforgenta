import { describe, it, expect } from 'vitest';
import { buildSavingsGrowthData, estimateGoalCompletionMonths, getGoalEffectiveApyPercent, goalCompletionMonthLabel, GROWTH_MONTHS, type GrowthGoalInput } from '@/lib/savings-growth';

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

  it('projects a full 5 years by default', () => {
    const { rows } = buildSavingsGrowthData([goal()], { today: TODAY });
    expect(GROWTH_MONTHS).toBe(60);
    expect(rows).toHaveLength(60);
    expect(rows[0].month).toBe('Jan 26');
    expect(rows[59].month).toBe('Dec 30');
  });

  it('shows a contribution that only starts in a later year', () => {
    // The case that looked broken on the 12-month chart: nothing happens for
    // 18 months, then the transfer rule kicks in and the line climbs.
    const { rows, series } = buildSavingsGrowthData(
      [goal({ currentAmount: 0, monthlyContribution: 500, contributionStartDate: '2027-07-01' })],
      { today: TODAY },
    );
    const k = series[0].key;
    expect(rows[17][k]).toBe(0);   // Jun 27, still nothing
    expect(rows[18][k]).toBe(500); // Jul 27, first contribution
    expect(rows[24][k]).toBe(3500);
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

describe('estimateGoalCompletionMonths', () => {
  it('returns 0 when the goal is already funded', () => {
    expect(estimateGoalCompletionMonths(goal({ currentAmount: 5000 }), 5000, { today: TODAY })).toBe(0);
  });

  it('counts plain monthly contributions', () => {
    // 1000 now, 100/mo, no interest -> 2000 after 10 months
    expect(estimateGoalCompletionMonths(goal(), 2000, { today: TODAY })).toBe(10);
  });

  it('pushes the date out when contributions start later', () => {
    const later = goal({ contributionStartDate: '2027-01-01' }); // 12 months out
    expect(estimateGoalCompletionMonths(later, 2000, { today: TODAY })).toBe(21);
  });

  it('pulls the date in when interest and lump sums are counted', () => {
    const withLump = goal({ lumpSums: [{ date: '2026-03-01', amount: 900 }] });
    expect(estimateGoalCompletionMonths(withLump, 2000, { today: TODAY })).toBe(2);
    const withApy = goal({ annualApyPercent: 12 });
    expect(estimateGoalCompletionMonths(withApy, 2000, { today: TODAY })).toBeLessThan(10);
  });

  it('reaches the target on interest alone with no contributions', () => {
    const idle = goal({ monthlyContribution: 0, annualApyPercent: 12 });
    expect(estimateGoalCompletionMonths(idle, 1100, { today: TODAY })).toBe(10);
  });

  it('returns null when nothing can ever fund the goal', () => {
    const stalled = goal({ monthlyContribution: 0, annualApyPercent: 0 });
    expect(estimateGoalCompletionMonths(stalled, 5000, { today: TODAY })).toBeNull();
  });
});

// Extracted in b80b381d (site walk §2.5) so the Goals page's "Est. completion" and the Forecast
// "<goal> Complete!" milestone price a goal identically. It was a pure extraction with no test.
describe('getGoalEffectiveApyPercent', () => {
  it('prefers the account\'s own rate, apy_rate before apr', () => {
    expect(getGoalEffectiveApyPercent({ apy_rate: 4.5, account_type: 'savings' })).toBe(4.5);
    expect(getGoalEffectiveApyPercent({ apr: 3.25, account_type: 'checking' })).toBe(3.25);
    expect(getGoalEffectiveApyPercent({ apy_rate: 4.5, apr: 9, account_type: 'savings' })).toBe(4.5);
  });

  it('falls back to a per-type default only when the account carries no rate', () => {
    expect(getGoalEffectiveApyPercent({ account_type: 'savings' })).toBe(4.5);
    expect(getGoalEffectiveApyPercent({ account_type: 'high_yield_savings' })).toBe(4.5);
    expect(getGoalEffectiveApyPercent({ account_type: 'brokerage' })).toBe(7);
    expect(getGoalEffectiveApyPercent({ account_type: 'roth_ira' })).toBe(7);
    expect(getGoalEffectiveApyPercent({ apy_rate: 0, account_type: 'savings' })).toBe(4.5);
  });

  it('earns nothing without a linked account, or in a non-earning account type', () => {
    expect(getGoalEffectiveApyPercent(null)).toBe(0);
    expect(getGoalEffectiveApyPercent(undefined)).toBe(0);
    expect(getGoalEffectiveApyPercent({ account_type: 'checking' })).toBe(0);
  });
});

describe('goalCompletionMonthLabel', () => {
  it('names the same month the forecast engine labels for that index', () => {
    // The engine builds each row as new Date(y, m + i, 1) (forecast-engine.ts). The label for a
    // completion at month index i must match, or the two surfaces name different months for the
    // same month — which is §2.5 all over again.
    const engineLabel = (i: number, today: Date) =>
      new Date(today.getFullYear(), today.getMonth() + i, 1)
        .toLocaleString('en', { month: 'short', year: 'numeric' });

    // The 31st is the case that used to break: date.setMonth(getMonth() + 6) from Aug 31 overflows
    // February and lands in March.
    const monthEnd = new Date(2026, 7, 31);
    expect(goalCompletionMonthLabel(6, monthEnd)).toBe('Feb 2027');
    expect(goalCompletionMonthLabel(6, monthEnd)).toBe(engineLabel(6, monthEnd));

    for (const today of [new Date(2026, 7, 5), new Date(2026, 0, 31), new Date(2026, 11, 31)]) {
      for (const i of [0, 1, 6, 12, 29, 40]) {
        expect(goalCompletionMonthLabel(i, today)).toBe(engineLabel(i, today));
      }
    }
  });
});

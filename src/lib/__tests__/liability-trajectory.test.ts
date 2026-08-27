import { describe, it, expect } from 'vitest';
import { buildLiabilityTrajectory } from '../liability-trajectory';

const NOW = new Date(2026, 7, 1); // Aug 2026

describe('buildLiabilityTrajectory', () => {
  it('adds back the month\'s own extra so both lines mean "owed entering this month"', () => {
    // The engine subtracts month 1's $500 extra from entry 1 itself. Plotted raw, the accelerated
    // line would sit BELOW the scheduled one by a whole month's principal — the bug /vehicles hit.
    const { rows, series } = buildLiabilityTrajectory([{
      id: 'acct-1',
      name: 'Student Loan',
      balances: [10_000, 9_400, 8_800],
      extrasByMonth: [0, 500, 0],
      scheduled: [10_000, 9_900, 9_800],
    }], 3, NOW);

    expect(series).toHaveLength(1);
    expect(rows.map(r => r['Student Loan'])).toEqual([10_000, 9_900, 8_800]);
    expect(rows.map(r => r['Student Loan (no extra)'])).toEqual([10_000, 9_900, 9_800]);
    expect(rows[0].month).toBe('Aug 2026');
  });

  it('draws no companion line when the scheduled walk is the same walk', () => {
    const { series, rows } = buildLiabilityTrajectory([{
      id: 'acct-1',
      name: 'Student Loan',
      balances: [10_000, 9_500, 9_000],
      scheduled: [10_000, 9_500, 9_000],
    }], 3, NOW);

    expect(series[0].scheduledKey).toBeNull();
    expect(rows[0]['Student Loan (no extra)']).toBeUndefined();
  });

  it('leaves a gap past the end of the projection instead of drawing a $0 line', () => {
    const { rows } = buildLiabilityTrajectory([{
      id: 'acct-1', name: 'Loan', balances: [500, 250],
    }], 4, NOW);

    expect(rows.map(r => r.Loan)).toEqual([500, 250, null, null]);
  });

  it('keeps a debt that reaches zero inside the horizon, at zero', () => {
    const { rows, series } = buildLiabilityTrajectory([{
      id: 'acct-1', name: 'Loan', balances: [300, 0, 0],
    }], 3, NOW);

    expect(series).toHaveLength(1);
    expect(rows.map(r => r.Loan)).toEqual([300, 0, 0]);
  });

  it('drops a debt with nothing to draw rather than giving it a legend entry', () => {
    const { series } = buildLiabilityTrajectory([
      { id: 'a', name: 'Paid Off', balances: [0, 0, 0] },
      { id: 'b', name: 'Unprojected', balances: null },
      { id: 'c', name: 'Real', balances: [100, 50, 0] },
    ], 3, NOW);

    expect(series.map(s => s.name)).toEqual(['Real']);
  });

  it('gives two debts sharing a name distinct keys', () => {
    const { series, rows } = buildLiabilityTrajectory([
      { id: 'a', name: 'Loan', balances: [100, 50] },
      { id: 'b', name: 'Loan', balances: [900, 800] },
    ], 2, NOW);

    expect(series.map(s => s.key)).toEqual(['Loan', 'Loan (2)']);
    expect(rows[0]).toMatchObject({ Loan: 100, 'Loan (2)': 900 });
  });
});

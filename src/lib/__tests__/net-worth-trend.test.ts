import { describe, it, expect } from 'vitest';
import {
  buildNetWorthTrend,
  monthlyNetWorthChange,
  MONTHLY_CHANGE_MIN_DAYS,
  type TrendSnapshotRow,
} from '../net-worth-trend';

const row = (date: string, net: number | string): TrendSnapshotRow => ({
  snapshot_date: date,
  net_worth: net,
});

describe('buildNetWorthTrend', () => {
  it('falls back to a single point at the live net worth when nothing has been recorded', () => {
    const trend = buildNetWorthTrend([], 12_345, new Date('2026-08-20T12:00:00Z'));
    expect(trend).toHaveLength(1);
    expect(trend[0].value).toBe(12_345);
  });

  it('never invents a second point, so the caller can tell "one reading" from "a trend"', () => {
    expect(buildNetWorthTrend([], 0).length).toBe(1);
    expect(buildNetWorthTrend([row('2026-08-01', 100)], 999).length).toBe(1);
  });

  it('ignores the live figure once snapshots exist — the chart is history, not a projection', () => {
    const trend = buildNetWorthTrend([row('2026-08-01', 100), row('2026-08-08', 200)], 99_999);
    expect(trend.map(p => p.value)).toEqual([100, 200]);
  });

  it('coerces the numeric strings Postgres returns', () => {
    const trend = buildNetWorthTrend([row('2026-08-01', '1234.56'), row('2026-08-08', '2000')], 0);
    expect(trend.map(p => p.value)).toEqual([1234.56, 2000]);
  });

  it('keeps snapshot order, oldest first', () => {
    const trend = buildNetWorthTrend(
      [row('2026-06-01', 1), row('2026-07-01', 2), row('2026-08-01', 3)],
      0,
    );
    expect(trend.map(p => p.value)).toEqual([1, 2, 3]);
  });
});

describe('monthlyNetWorthChange', () => {
  it('is null with fewer than two snapshots — an em dash, never a confident $0', () => {
    expect(monthlyNetWorthChange([])).toBeNull();
    expect(monthlyNetWorthChange([row('2026-08-01', 500)])).toBeNull();
  });

  it('is null when every pair is closer together than a month', () => {
    // The recorder writes WEEKLY. Differencing the last two rows here would label a
    // seven-day change as a monthly one.
    const weekly = [
      row('2026-08-01', 1000),
      row('2026-08-08', 1100),
      row('2026-08-15', 1200),
    ];
    expect(monthlyNetWorthChange(weekly)).toBeNull();
  });

  it('reaches back past the intervening weekly rows to the first genuinely month-old one', () => {
    const rows = [
      row('2026-07-04', 1000), // 47 days back — older than needed
      row('2026-07-18', 1400), // 33 days back — the closest row still >= 25 days
      row('2026-08-13', 1900), // 7 days back
      row('2026-08-20', 2000),
    ];
    expect(monthlyNetWorthChange(rows)).toBe(600);
  });

  it('reports a fall as a negative number', () => {
    expect(monthlyNetWorthChange([row('2026-07-01', 5000), row('2026-08-20', 4200)])).toBe(-800);
  });

  it('accepts a gap of exactly the minimum and rejects one day under', () => {
    const latest = new Date('2026-08-20T00:00:00Z');
    const at = (daysBack: number) =>
      new Date(latest.getTime() - daysBack * 86_400_000).toISOString().split('T')[0];

    expect(monthlyNetWorthChange([row(at(MONTHLY_CHANGE_MIN_DAYS), 100), row(at(0), 175)])).toBe(75);
    expect(monthlyNetWorthChange([row(at(MONTHLY_CHANGE_MIN_DAYS - 1), 100), row(at(0), 175)])).toBeNull();
  });

  it('coerces numeric strings rather than concatenating them', () => {
    expect(monthlyNetWorthChange([row('2026-07-01', '1000.50'), row('2026-08-20', '1500.75')])).toBe(500.25);
  });

  it('skips an unparseable date instead of returning NaN', () => {
    const rows = [row('2026-07-01', 1000), row('not-a-date', 9999), row('2026-08-20', 1500)];
    expect(monthlyNetWorthChange(rows)).toBe(500);
  });
});

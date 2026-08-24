// `getRuleOccurrenceDatesInMonth` must format LOCAL dates in local time.
//
// THE BUG. Three of its four branches built a Date from local parts (`new Date(year, month, dueDay)`)
// and then formatted it with `toISOString().split('T')[0]`, which is UTC. East of Greenwich that
// subtracts a day from EVERY due day: measured under `TZ=Europe/Berlin`, a rule due 2026-09-01
// emitted "2026-08-31" and one due the 15th emitted the 14th. The branch's `>= monthStart` guard did
// not catch it, because it compares the Date object while the string is what gets pushed — so
// September's occurrence list carried an August date. The biweekly branch was already correct,
// having borrowed `scheduling.ts`'s `toLocalDateStr`; the other three had been quietly wrong for
// every UTC+ user since they were written.
//
// ⚠️ THESE ASSERTIONS ONLY DISCRIMINATE UNDER A POSITIVE UTC OFFSET, and that is stated here rather
// than hidden. `TZ` is read by Node before the test process starts, so a test cannot move itself
// into Berlin; run from `America/New_York` (this machine, and CI) all four pass with the bug still
// in place. They are still worth committing: they pin the invariant that a returned date lands on
// the day and in the month it was asked for, they cost nothing, and they go red the moment the suite
// runs anywhere east of Greenwich. Verified directly — against the pre-fix code under
// `TZ=Europe/Berlin` all four FAIL, and against the fixed code all four pass.

import { describe, it, expect } from 'vitest';
import { getRuleOccurrenceDatesInMonth } from '../pay-schedule';
import { toLocalDateStr } from '../scheduling';
import type { RuleRow } from '@/hooks/useSupabaseData';

const rule = (over: Partial<RuleRow> = {}): RuleRow => ({
  id: 'r1', name: 'Rent', amount: 1600, rule_type: 'expense', frequency: 'monthly',
  active: true, start_date: '2020-01-01', end_date: null, category: 'Bills',
  due_day: 1, due_month: null, created_at: '2020-01-01T00:00:00Z',
  ...over,
});

describe('getRuleOccurrenceDatesInMonth — local, not UTC', () => {
  it('a monthly rule due the 1st lands on the 1st of the month asked for, all twelve months', () => {
    for (let month = 0; month < 12; month++) {
      const dates = getRuleOccurrenceDatesInMonth(rule(), 2026, month);
      expect(dates).toEqual([toLocalDateStr(new Date(2026, month, 1))]);
      expect(dates[0].slice(8)).toBe('01');
      expect(Number(dates[0].slice(5, 7))).toBe(month + 1);
    }
  });

  it('a yearly rule due January 1st lands in January, not the previous December', () => {
    const dates = getRuleOccurrenceDatesInMonth(
      rule({ frequency: 'yearly', due_month: 1, due_day: 1 }), 2026, 0,
    );
    expect(dates).toEqual(['2026-01-01']);
  });

  it('every weekly occurrence stays inside the month asked for', () => {
    // Saturday. August 2026 opens on one, so the first occurrence is the 1st — the day the UTC
    // formatting pushed back into July.
    const dates = getRuleOccurrenceDatesInMonth(rule({ frequency: 'weekly', due_day: 6 }), 2026, 7);
    expect(dates.length).toBeGreaterThan(3);
    expect(dates[0]).toBe('2026-08-01');
    for (const d of dates) expect(d.slice(0, 7)).toBe('2026-08');
  });

  it('is unchanged for a mid-month due day — the fix is a no-op west of Greenwich', () => {
    expect(getRuleOccurrenceDatesInMonth(rule({ due_day: 15 }), 2026, 7)).toEqual(['2026-08-15']);
    expect(getRuleOccurrenceDatesInMonth(rule({ due_day: 31 }), 2026, 8)).toEqual(['2026-09-30']);
  });
});

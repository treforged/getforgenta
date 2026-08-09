// Commit 2 of the biweekly anchor work: the rule editor lets a user PIN the phase instead of
// living with the derived one. `describeBiweeklyAnchor` is what the editor shows them, so it has
// to say three things honestly: which date the cycle will actually run from, whether that came
// from the user or was derived, and whether we moved the date they typed.
//
// The last one matters more than it looks. `resolveBiweeklyAnchor` advances the base date to the
// first `due_day` weekday on or after it, so someone who types "my first paycheck was Thursday
// the 1st" on a Wednesday rule gets a schedule starting the 7th. Silently is not acceptable —
// telling them is the whole reason this helper is separate from the resolver.

import { describe, it, expect } from 'vitest';
import { describeBiweeklyAnchor, resolveBiweeklyAnchor, toLocalDateStr } from '@/lib/scheduling';

describe('describeBiweeklyAnchor', () => {
  it('derives from created_at when no start_date is pinned (Tre real Fuel row)', () => {
    // Created Sun 2026-03-22, bills Fridays -> the cycle runs from Fri 2026-03-27.
    const d = describeBiweeklyAnchor({ due_day: 5, start_date: null, created_at: '2026-03-22T05:16:36.288328+00:00' });
    expect(d.anchor).toBe('2026-03-27');
    expect(d.pinned).toBe(false);
    expect(d.shiftedFromInput).toBe(false);
  });

  it('reports a pinned start_date that already lands on due_day as pinned and unshifted', () => {
    const d = describeBiweeklyAnchor({ due_day: 3, start_date: '2026-01-07', created_at: '2026-04-25T00:00:00Z' });
    expect(d.anchor).toBe('2026-01-07');
    expect(d.pinned).toBe(true);
    expect(d.shiftedFromInput).toBe(false);
  });

  it('FLAGS a pinned start_date whose weekday disagrees with due_day', () => {
    // Thu 2026-01-01 typed on a Wednesday (due_day 3) rule -> schedule really starts Wed 01-07.
    const d = describeBiweeklyAnchor({ due_day: 3, start_date: '2026-01-01', created_at: '2026-04-25T00:00:00Z' });
    expect(d.anchor).toBe('2026-01-07');
    expect(d.pinned).toBe(true);
    expect(d.shiftedFromInput).toBe(true);
  });

  it('falls back to today when the rule carries neither date (a brand-new unsaved rule)', () => {
    const today = new Date(2026, 7, 9, 12); // Sun 2026-08-09
    const d = describeBiweeklyAnchor({ due_day: 5, start_date: null, created_at: null }, today);
    expect(d.anchor).toBe('2026-08-14'); // next Friday
    expect(d.pinned).toBe(false);
  });

  it('never disagrees with the resolver it describes', () => {
    const rules = [
      { due_day: 5, start_date: null, created_at: '2026-03-22T05:16:36Z' },
      { due_day: 3, start_date: '2026-01-01', created_at: '2026-04-25T00:00:00Z' },
      { due_day: 0, start_date: null, created_at: '2026-04-04T00:00:00Z' },
      { due_day: 4, start_date: '2026-05-01', created_at: '2026-05-19T00:00:00Z' },
    ];
    for (const r of rules) {
      expect(describeBiweeklyAnchor(r).anchor).toBe(toLocalDateStr(resolveBiweeklyAnchor(r)));
    }
  });

  it('terminates on a DAY-OF-MONTH due_day instead of hanging the tab', () => {
    // The editor calls this on every keystroke, and switching a monthly rule (due_day 15) to
    // biweekly leaves the two inputs disagreeing for as long as it takes to fix the second one.
    // Before the clamp, the resolver's "advance to the first due_day weekday" loop searched for
    // weekday 15 forever — an unrecoverable freeze reachable from a two-click UI path.
    for (const bad of [15, 31, -1, 7, 1.5, NaN]) {
      const d = describeBiweeklyAnchor({ due_day: bad, start_date: null, created_at: '2026-03-22T00:00:00Z' });
      // Falls back to the module's Friday default rather than inventing a weekday.
      expect(d.anchor).toBe('2026-03-27');
    }
  });

  it('returns a LOCAL calendar date, so the string cannot slip a day in a UTC+ timezone', () => {
    // toLocalDateStr, not toISOString: the latter would render 2026-03-27T12:00 local as 03-26
    // for any viewer east of UTC.
    const d = describeBiweeklyAnchor({ due_day: 5, start_date: '2026-03-27', created_at: null });
    expect(d.anchor).toBe('2026-03-27');
    expect(d.anchor).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

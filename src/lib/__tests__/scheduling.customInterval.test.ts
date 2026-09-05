import { describe, it, expect } from 'vitest';
import {
  ruleCustomInterval,
  getCustomIntervalDatesInMonth,
  countRuleOccurrencesInMonth,
  generateScheduledEvents,
  toLocalDateStr,
} from '../scheduling';
import { getRuleOccurrenceDatesInMonth } from '../pay-schedule';

/**
 * Tre, 2026-09-05: a planned item must repeat on a USER-CHOSEN interval — every other month, every
 * three weeks, every five weeks — not only on the closed `frequency` vocabulary.
 *
 * The whole risk in this change is the OTHER 435 rules. `interval_unit` and `interval_count` are
 * null on every one of them, and null must mean "nothing changed at all", not "nearly nothing".
 * The first block below is that guarantee, pinned against Tre's own Supplements rule, which is the
 * acceptance test he named.
 */

const baseRule = {
  id: 'r1', name: 'Supplements', amount: 106, rule_type: 'expense' as const,
  frequency: 'monthly', active: true, due_day: 28, due_month: null,
  start_date: '2026-10-01', end_date: null, category: 'Health',
  created_at: '2026-09-01T00:00:00Z',
};

describe('a rule with NO custom interval is untouched', () => {
  it('reads as having none — both columns absent, one column absent, or a bad value', () => {
    expect(ruleCustomInterval({})).toBeNull();
    expect(ruleCustomInterval({ interval_unit: 'week', interval_count: null })).toBeNull();
    expect(ruleCustomInterval({ interval_unit: null, interval_count: 3 })).toBeNull();
    // A half-row or a hand-edited value falls back to `frequency` rather than inventing a cadence.
    expect(ruleCustomInterval({ interval_unit: 'fortnight', interval_count: 2 })).toBeNull();
    expect(ruleCustomInterval({ interval_unit: 'week', interval_count: 0 })).toBeNull();
    expect(ruleCustomInterval({ interval_unit: 'week', interval_count: 61 })).toBeNull();
    expect(ruleCustomInterval({ interval_unit: 'week', interval_count: 2.5 })).toBeNull();
  });

  it('ACCEPTANCE — the Supplements rule round-trips through the new shape unchanged', () => {
    // Monthly, due day 28, from 2026-10-01. Every month it has always fired, it still fires once.
    for (const [y, m] of [[2026, 9], [2026, 10], [2027, 0], [2027, 5]] as const) {
      expect(countRuleOccurrencesInMonth(baseRule, y, m)).toBe(1);
    }
    expect(getRuleOccurrenceDatesInMonth(baseRule, 2026, 10)).toEqual(['2026-11-28']);
    expect(getRuleOccurrenceDatesInMonth(baseRule, 2027, 1)).toEqual(['2027-02-28']);
  });

  it('carrying the columns explicitly as NULL is identical to not carrying them', () => {
    const withNulls = { ...baseRule, interval_unit: null, interval_count: null };
    expect(countRuleOccurrencesInMonth(withNulls, 2027, 3)).toBe(countRuleOccurrencesInMonth(baseRule, 2027, 3));
    expect(getRuleOccurrenceDatesInMonth(withNulls, 2027, 3)).toEqual(getRuleOccurrenceDatesInMonth(baseRule, 2027, 3));
  });
});

describe('every other month', () => {
  const everyOtherMonth = { ...baseRule, name: 'Water bill', interval_unit: 'month', interval_count: 2 };

  it('fires in the anchor month and every second month after it, and NOT in between', () => {
    // start_date 2026-10-01 → October, December, February, April …
    expect(countRuleOccurrencesInMonth(everyOtherMonth, 2026, 9)).toBe(1);  // Oct
    expect(countRuleOccurrencesInMonth(everyOtherMonth, 2026, 10)).toBe(0); // Nov
    expect(countRuleOccurrencesInMonth(everyOtherMonth, 2026, 11)).toBe(1); // Dec
    expect(countRuleOccurrencesInMonth(everyOtherMonth, 2027, 0)).toBe(0);  // Jan
    expect(countRuleOccurrencesInMonth(everyOtherMonth, 2027, 1)).toBe(1);  // Feb
  });

  it('lands on the due day, and never before the anchor month', () => {
    expect(getRuleOccurrenceDatesInMonth(everyOtherMonth, 2026, 11)).toEqual(['2026-12-28']);
    expect(getRuleOccurrenceDatesInMonth(everyOtherMonth, 2026, 8)).toEqual([]);
  });

  it('is exactly what monthly is NOT — the same rule as monthly fires every month', () => {
    const monthly = { ...everyOtherMonth, interval_unit: null, interval_count: null };
    expect(countRuleOccurrencesInMonth(monthly, 2026, 10)).toBe(1);
    expect(countRuleOccurrencesInMonth(everyOtherMonth, 2026, 10)).toBe(0);
  });

  it('clamps a day-31 rule to the short month instead of overflowing into the next one', () => {
    const r = { ...baseRule, due_day: 31, start_date: '2026-12-01', interval_unit: 'month', interval_count: 2 };
    expect(getRuleOccurrenceDatesInMonth(r, 2026, 11)).toEqual(['2026-12-31']);
    expect(getRuleOccurrenceDatesInMonth(r, 2027, 1)).toEqual(['2027-02-28']); // not 2027-03-03
    expect(getRuleOccurrenceDatesInMonth(r, 2027, 2)).toEqual([]);             // March is off the grid
  });
});

describe('every three and every five weeks', () => {
  const everyThreeWeeks = {
    ...baseRule, name: 'Lawn service', frequency: 'weekly',
    start_date: '2026-09-07', interval_unit: 'week', interval_count: 3,
  };

  it('walks a 21-day grid phased on start_date, across a month boundary', () => {
    expect(getRuleOccurrenceDatesInMonth(everyThreeWeeks, 2026, 8)).toEqual(['2026-09-07', '2026-09-28']);
    expect(getRuleOccurrenceDatesInMonth(everyThreeWeeks, 2026, 9)).toEqual(['2026-10-19']);
    expect(getRuleOccurrenceDatesInMonth(everyThreeWeeks, 2026, 10)).toEqual(['2026-11-09', '2026-11-30']);
  });

  it('never re-phases: every occurrence is a whole multiple of 21 days from the anchor', () => {
    const all = [8, 9, 10, 11].flatMap(m => getRuleOccurrenceDatesInMonth(everyThreeWeeks, 2026, m));
    const anchor = new Date('2026-09-07T12:00:00').getTime();
    expect(all.length).toBeGreaterThan(3);
    for (const iso of all) {
      const days = Math.round((new Date(`${iso}T12:00:00`).getTime() - anchor) / 86400000);
      expect(days % 21).toBe(0);
    }
  });

  it('every five weeks is a 35-day grid, not a monthly one', () => {
    const r = { ...everyThreeWeeks, interval_count: 5 };
    expect(getRuleOccurrenceDatesInMonth(r, 2026, 8)).toEqual(['2026-09-07']);
    expect(getRuleOccurrenceDatesInMonth(r, 2026, 9)).toEqual(['2026-10-12']);
    expect(getRuleOccurrenceDatesInMonth(r, 2026, 10)).toEqual(['2026-11-16']);
    // Five weeks is longer than February, so a month can legitimately hold none.
    expect(getRuleOccurrenceDatesInMonth(r, 2027, 1)).toEqual([]);
  });

  it('honours end_date per occurrence, not per month', () => {
    const r = { ...everyThreeWeeks, end_date: '2026-11-10' };
    expect(getRuleOccurrenceDatesInMonth(r, 2026, 10)).toEqual(['2026-11-09']);
    expect(countRuleOccurrencesInMonth(r, 2026, 10)).toBe(1);
    expect(countRuleOccurrencesInMonth(r, 2026, 11)).toBe(0);
  });

  it('does not back-fill before start_date inside its own first month', () => {
    const r = { ...everyThreeWeeks, start_date: '2026-09-21' };
    expect(getRuleOccurrenceDatesInMonth(r, 2026, 8)).toEqual(['2026-09-21']);
  });
});

describe('the timeline and the per-month count cannot disagree', () => {
  it('generateScheduledEvents emits exactly what getRuleOccurrenceDatesInMonth says it should', () => {
    const rule = {
      ...baseRule, id: 'lawn', name: 'Lawn service', frequency: 'weekly',
      start_date: '2026-09-07', interval_unit: 'week', interval_count: 3,
      payment_source: null, deposit_account: null,
    };
    const from = new Date(2026, 8, 1, 12);
    const events = generateScheduledEvents([rule], [], 4, from)
      .filter(e => e.ruleId === 'lawn')
      .map(e => e.date);
    const expected = [8, 9, 10, 11]
      .flatMap(m => getRuleOccurrenceDatesInMonth(rule, 2026, m))
      .filter(iso => iso >= toLocalDateStr(from));
    expect(events).toEqual(expected);
    expect(events.length).toBeGreaterThan(0);
  });

  it('an every-other-month bill contributes nothing to its off months on the timeline', () => {
    const rule = {
      ...baseRule, id: 'water', name: 'Water bill',
      start_date: '2026-10-01', interval_unit: 'month', interval_count: 2,
      payment_source: null, deposit_account: null,
    };
    const events = generateScheduledEvents([rule], [], 6, new Date(2026, 9, 1, 12))
      .filter(e => e.ruleId === 'water')
      .map(e => e.date);
    expect(events).toEqual(['2026-10-28', '2026-12-28', '2027-02-28']);
  });
});

describe('getCustomIntervalDatesInMonth on its own', () => {
  it('returns nothing when the rule has no date to phase on', () => {
    expect(getCustomIntervalDatesInMonth({ due_day: 5 }, { unit: 'week', count: 3 }, 2026, 8)).toEqual([]);
  });

  it('falls back to created_at when start_date is absent', () => {
    const dates = getCustomIntervalDatesInMonth(
      { due_day: 5, created_at: '2026-09-07T00:00:00Z' }, { unit: 'week', count: 3 }, 2026, 8,
    );
    expect(dates.map(toLocalDateStr)).toEqual(['2026-09-07', '2026-09-28']);
  });
});

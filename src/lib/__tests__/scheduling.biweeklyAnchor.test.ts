// Biweekly phase anchoring — the fix for the drift measured in session 126b.
//
// THE BUG. Every biweekly generator in the app restarted its 14-day cycle from scratch, either at
// the first matching weekday of EACH MONTH (`getRuleOccurrenceDatesInMonth`) or at
// `max(today, start_date)` (`generateScheduledEvents`, `countRuleOccurrencesInMonth`). Neither is a
// phase: the first drops a fresh cycle in whenever a month ends on an occurrence (four times a year,
// +2 occurrences = +7.7%), and the second silently re-phases the whole schedule every calendar day,
// so the same rule generated different dates depending on when the app happened to be loaded.
//
// ⚠️ WHY THIS MATTERS MORE THAN TRE'S $65 FUEL RULE. For a biweekly EXPENSE, over-counting reads
// cash LOW — the safe direction. For a biweekly INCOME rule it reads cash HIGH, and biweekly is the
// most common US pay cadence: a customer on a $2,000 biweekly paycheck was being shown ~$4,000/yr of
// income that never arrives. This is an income-correctness fix, not a rounding fix.
//
// ⚠️ WEEKLY IS DELIBERATELY UNTOUCHED. Every Friday is a Friday no matter which month it falls in,
// so a monthly restart is harmless at a 7-day step — 126b verified a weekly rule generates 52
// occurrences a year with every gap exactly 7 days. Anchoring it would only risk moving a correct
// schedule, and would change the weekday outright whenever the anchor's weekday differs from
// `due_day`. Pinned below.

import { describe, it, expect } from 'vitest';
import {
  resolveBiweeklyAnchor,
  getBiweeklyDatesInMonth,
  generateScheduledEvents,
  countRuleOccurrencesInMonth,
  toLocalDateStr,
} from '../scheduling';
import { getRuleOccurrenceDatesInMonth } from '../pay-schedule';

/** Tre's real `Fuel` rule: biweekly, Friday (`due_day` 5), NO `start_date`, created on a SUNDAY. */
const FUEL = {
  id: 'fuel',
  name: 'Fuel',
  amount: 65,
  rule_type: 'expense',
  frequency: 'biweekly',
  active: true,
  due_day: 5,
  start_date: null,
  created_at: '2026-03-22T05:16:36.288328+00:00',
};

const DAY_MS = 86400000;
const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / DAY_MS);

/** Every occurrence the rule generates in `year`, via the per-month generator. */
const allDatesIn = (rule: typeof FUEL, year: number, today = new Date(2026, 0, 1)) =>
  Array.from({ length: 12 }, (_, m) => getBiweeklyDatesInMonth(rule, year, m, today))
    .flat()
    .map(toLocalDateStr);

describe('resolveBiweeklyAnchor', () => {
  // The whole point: `created_at` is a Sunday but the rule bills on Fridays. Anchoring on the raw
  // created_at would move every occurrence to a Sunday, silently overriding the user's `due_day`.
  it('respects due_day when the anchor date falls on a different weekday', () => {
    const anchor = resolveBiweeklyAnchor(FUEL);
    expect(toLocalDateStr(anchor)).toBe('2026-03-27'); // first Friday on/after Sun Mar 22
    expect(anchor.getDay()).toBe(5);
  });

  it('prefers an explicit start_date over created_at', () => {
    const anchor = resolveBiweeklyAnchor({ ...FUEL, start_date: '2026-06-01' }); // a Monday
    expect(toLocalDateStr(anchor)).toBe('2026-06-05'); // first Friday on/after
  });

  // A rule row always has created_at (verified non-null for every row in the live DB), so this is
  // the shape test doubles take, not a state the app can reach.
  it('falls back to today when the rule carries neither date', () => {
    const anchor = resolveBiweeklyAnchor(
      { ...FUEL, start_date: null, created_at: null },
      new Date(2026, 7, 1), // Sat Aug 1
    );
    expect(toLocalDateStr(anchor)).toBe('2026-08-07'); // the following Friday
  });
});

describe('getBiweeklyDatesInMonth — the drift is gone', () => {
  // 126b measured the OLD generator producing 28 occurrences with 4 gaps of only 7 days.
  it('generates a true 14-day cadence across a whole year', () => {
    const dates = allDatesIn(FUEL, 2026);
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
    expect(new Set(gaps)).toEqual(new Set([14]));
  });

  it('yields 26-27 occurrences a year, not the 28 the monthly restart invented', () => {
    // 365 / 14 = 26.07, so a true biweekly cadence gives 26 in most years and 27 when the year
    // opens on-phase (2027 starts with an occurrence on Jan 1). 28 is only reachable by inventing
    // a cycle, which is exactly what the old monthly restart did. The gap invariant above is the
    // real law; this pins that the count sits in the honest range.
    expect(allDatesIn(FUEL, 2026)).toHaveLength(20); // anchored Mar 27, so 2026 is a part year
    expect(allDatesIn(FUEL, 2027)).toHaveLength(27);
    expect(allDatesIn(FUEL, 2028)).toHaveLength(26);
  });

  // The old `max(today, start_date)` anchor re-phased the entire schedule every calendar day.
  it('produces the same dates no matter what day the app is loaded', () => {
    const jan = allDatesIn(FUEL, 2027, new Date(2027, 0, 3));
    const jul = allDatesIn(FUEL, 2027, new Date(2027, 6, 19));
    expect(jan).toEqual(jul);
  });

  it('never bills before the rule exists', () => {
    expect(getBiweeklyDatesInMonth(FUEL, 2026, 1)).toEqual([]); // Feb, before Mar 27
    expect(allDatesIn(FUEL, 2025)).toEqual([]);
  });

  it('honours an end_date', () => {
    const ending = { ...FUEL, end_date: '2026-04-30' };
    expect(allDatesIn(ending, 2026).map(String)).toEqual(['2026-03-27', '2026-04-10', '2026-04-24']);
  });
});

// The two-copies danger: a writer that disagrees with the generator by one day stores an
// `occurrence_date` no occurrence has, and the confirmation suppresses nothing while looking
// perfectly correct in the database. All three generators must agree, month by month.
describe('all three biweekly generators agree', () => {
  const months = Array.from({ length: 14 }, (_, i) => i);

  it('getRuleOccurrenceDatesInMonth matches getBiweeklyDatesInMonth', () => {
    for (const m of months) {
      const year = 2026 + Math.floor(m / 12);
      const mi = m % 12;
      expect(getRuleOccurrenceDatesInMonth(FUEL, year, mi))
        .toEqual(getBiweeklyDatesInMonth(FUEL, year, mi).map(toLocalDateStr));
    }
  });

  it('countRuleOccurrencesInMonth matches the generated count', () => {
    for (const m of months) {
      const year = 2026 + Math.floor(m / 12);
      const mi = m % 12;
      expect(countRuleOccurrencesInMonth(FUEL, year, mi))
        .toBe(getBiweeklyDatesInMonth(FUEL, year, mi).length);
    }
  });

  it('generateScheduledEvents lands on the same dates from any load date', () => {
    const from = new Date(2026, 9, 14); // an arbitrary Wednesday
    const events = generateScheduledEvents([FUEL], [], 6, from)
      .filter(e => e.ruleId === 'fuel')
      .map(e => e.date);
    // Every emitted date must be an occurrence the per-month generator also produces.
    const expected = Array.from({ length: 7 }, (_, i) =>
      getBiweeklyDatesInMonth(FUEL, 2026, 9 + i).map(toLocalDateStr)).flat()
      .filter(d => d >= toLocalDateStr(from));
    expect(events).toEqual(expected.slice(0, events.length));
    expect(events.length).toBeGreaterThan(10);
  });
});

describe('weekly rules are untouched', () => {
  const weekly = { ...FUEL, frequency: 'weekly', due_day: 1 }; // Mondays

  it('still emits every matching weekday, ignoring the anchor entirely', () => {
    // August 2026 starts on a Saturday, so the Mondays are the 3rd, 10th, 17th, 24th and 31st.
    expect(getRuleOccurrenceDatesInMonth(weekly, 2026, 7))
      .toEqual(['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31']);
  });

  it('keeps a 7-day cadence with 52 occurrences a year', () => {
    const dates = Array.from({ length: 12 }, (_, m) =>
      getRuleOccurrenceDatesInMonth(weekly, 2027, m)).flat();
    expect(dates).toHaveLength(52);
    const gaps = dates.slice(1).map((d, i) => daysBetween(dates[i], d));
    expect(new Set(gaps)).toEqual(new Set([7]));
  });
});

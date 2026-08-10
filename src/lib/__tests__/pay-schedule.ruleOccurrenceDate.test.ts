// §1B — naming WHICH occurrence of a rule a bank charge settled.
//
// These pin two things that are easy to break independently:
//   1. `getRuleOccurrenceDatesInMonth` is the ONE definition of where a rule's occurrences land, now
//      shared by the transaction generator and the link writer. A drift of one day between them
//      would store an `occurrence_date` no generated occurrence has, and the confirmation would
//      suppress nothing while looking perfectly correct in the database.
//   2. `resolveRuleOccurrenceDate` never leaves the charge's own month, because `occurrence_date`
//      refines `occurrence_month` and the two must not disagree.

import { describe, it, expect } from 'vitest';
import {
  getRuleOccurrenceDatesInMonth,
  resolveRuleOccurrenceDate,
  generateMonthTransactionsFromRules,
} from '../pay-schedule';
import type { RuleRow } from '@/hooks/useSupabaseData';

const rule = (over: Partial<RuleRow> = {}): RuleRow => ({
  id: 'r1',
  name: 'Fuel',
  amount: 65,
  rule_type: 'expense',
  frequency: 'biweekly',
  active: true,
  start_date: null,
  category: 'Transportation',
  // Monday. `due_day` is a DAY OF THE WEEK for weekly/biweekly rules — the existing convention.
  due_day: 1,
  // Biweekly is phase-anchored on `start_date ?? created_at` (see `resolveBiweeklyAnchor`), so a
  // fixture without either would anchor on TODAY and make every expectation below time-dependent.
  // Mon 2026-01-05 is 210 days before Mon 2026-08-03 — a whole number of 14-day cycles — so the
  // August dates these tests have always asserted are unchanged by the anchoring fix.
  created_at: '2026-01-05T00:00:00Z',
  ...over,
});

// August 2026 starts on a Saturday, so the Mondays are the 3rd, 10th, 17th, 24th and 31st.
const AUG_MONDAYS = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'];

describe('getRuleOccurrenceDatesInMonth', () => {
  it('steps a biweekly rule by 14 days from the first matching weekday', () => {
    expect(getRuleOccurrenceDatesInMonth(rule(), 2026, 7))
      .toEqual(['2026-08-03', '2026-08-17', '2026-08-31']);
  });

  it('steps a weekly rule by 7', () => {
    expect(getRuleOccurrenceDatesInMonth(rule({ frequency: 'weekly' }), 2026, 7)).toEqual(AUG_MONDAYS);
  });

  it('gives a monthly rule exactly one date, clamped to the last day of a short month', () => {
    const monthly = rule({ frequency: 'monthly', due_day: 31 });
    expect(getRuleOccurrenceDatesInMonth(monthly, 2026, 7)).toEqual(['2026-08-31']);
    expect(getRuleOccurrenceDatesInMonth(monthly, 2026, 8)).toEqual(['2026-09-30']);
  });

  it('gives a yearly rule a date only in its due month', () => {
    const yearly = rule({ frequency: 'yearly', due_month: 8, due_day: 12 });
    expect(getRuleOccurrenceDatesInMonth(yearly, 2026, 7)).toEqual(['2026-08-12']);
    expect(getRuleOccurrenceDatesInMonth(yearly, 2026, 8)).toEqual([]);
  });

  it('yields nothing for a month before the rule starts', () => {
    expect(getRuleOccurrenceDatesInMonth(rule({ start_date: '2026-10-10' }), 2026, 7)).toEqual([]);
  });

  // The refactor's real risk: the generator used to own this arithmetic inline.
  it('agrees with generateMonthTransactionsFromRules, which now consumes it', () => {
    const generated = generateMonthTransactionsFromRules([rule()], [], 2026, 7);
    expect(generated.map(t => t.date)).toEqual(getRuleOccurrenceDatesInMonth(rule(), 2026, 7));
    expect(generated.map(t => t.id)).toEqual([
      'gen:r1:2026-08-03', 'gen:r1:2026-08-17', 'gen:r1:2026-08-31',
    ]);
  });
});

describe('resolveRuleOccurrenceDate — which fill-up did this charge pay for?', () => {
  it('picks the occurrence the charge settles, not the first one in the month', () => {
    expect(resolveRuleOccurrenceDate(rule(), '2026-08-04')).toBe('2026-08-03');
    expect(resolveRuleOccurrenceDate(rule(), '2026-08-19')).toBe('2026-08-17');
    expect(resolveRuleOccurrenceDate(rule(), '2026-08-31')).toBe('2026-08-31');
  });

  // Bills usually settle on or after the obligation, but paying two days early is ordinary, and an
  // on-or-before rule would return null and silently fall back to suppressing the whole month.
  it('handles a charge that lands BEFORE its occurrence', () => {
    expect(resolveRuleOccurrenceDate(rule(), '2026-08-01')).toBe('2026-08-03');
    expect(resolveRuleOccurrenceDate(rule(), '2026-08-16')).toBe('2026-08-17');
  });

  it('breaks a tie toward the EARLIER occurrence — the obligation already passed', () => {
    // Aug 10 is exactly 7 days from both Aug 3 and Aug 17.
    expect(resolveRuleOccurrenceDate(rule(), '2026-08-10')).toBe('2026-08-03');
  });

  // `occurrence_date` refines `occurrence_month`; pointing into a neighbouring month would leave the
  // row asserting a month whose occurrences it does not suppress (and the DB CHECK rejects it).
  it('NEVER returns a date outside the charge\'s own month', () => {
    const monthly = rule({ frequency: 'monthly', due_day: 25 });
    // Paid five days early: the nearest occurrence overall is July's 25th, but only August's counts.
    expect(resolveRuleOccurrenceDate(monthly, '2026-08-20')).toBe('2026-08-25');
  });

  it('returns null when the rule bills nothing that month — the caller keeps month-keying', () => {
    expect(resolveRuleOccurrenceDate(rule({ start_date: '2026-10-10' }), '2026-08-04')).toBeNull();
    expect(resolveRuleOccurrenceDate(rule({ frequency: 'yearly', due_month: 3 }), '2026-08-04')).toBeNull();
  });

  it('is inert on a malformed charge date rather than throwing', () => {
    expect(resolveRuleOccurrenceDate(rule(), '')).toBeNull();
    expect(resolveRuleOccurrenceDate(rule(), 'not-a-date')).toBeNull();
  });
});

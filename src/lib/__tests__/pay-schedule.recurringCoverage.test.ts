// Coverage audit (2026-08-11): does every recurring-rule occurrence that CAN exist actually get
// generated, for every month, with `end_date` and month-length edge cases honoured?
//
// The audit's answer: for `getRuleOccurrenceDatesInMonth` — the ONE definition of where a rule's
// occurrences land (its own doc comment, above) — `end_date` is honoured for `biweekly` only, via
// `getBiweeklyDatesInMonth`'s own clamp. The `weekly`, `monthly`, and `yearly` branches never read
// `rule.end_date` at all, even though the function's own parameter type includes it. A rule that has
// ended keeps producing occurrences in every later month for those three frequencies.
//
// Not a live bug on real data TODAY only because `getRuleOccurrenceDatesInMonth` is currently only
// ever asked about the CURRENT month (via `mergeWithGeneratedTransactions` /
// `generateCurrentMonthTransactionsFromRules`) — an ended rule stops mattering the month after it
// ends anyway, and by then `active` is typically flipped false by hand. It becomes a real bug the
// moment anything asks this function about a future month, which is exactly the shape of "does the
// Transactions tab cover all 60 months" — see `transactions-horizon-coverage.test.ts`.
//
// These pin the CORRECT behaviour and are expected to fail until the three branches gain the same
// `end_date` guard biweekly already has.

import { describe, it, expect } from 'vitest';
import { getRuleOccurrenceDatesInMonth } from '../pay-schedule';
import type { RuleRow } from '@/hooks/useSupabaseData';

const rule = (over: Partial<RuleRow> = {}): RuleRow => ({
  id: 'r1',
  name: 'Rule',
  amount: 100,
  rule_type: 'expense',
  frequency: 'monthly',
  active: true,
  start_date: '2026-01-01',
  end_date: null,
  category: 'Bills',
  due_day: 1,
  due_month: null,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

describe('getRuleOccurrenceDatesInMonth — end_date (KNOWN GAP)', () => {
  it('gives a monthly rule no occurrence in a month after its end_date', () => {
    const monthly = rule({ frequency: 'monthly', due_day: 1, end_date: '2026-06-15' });
    // The rule ended in June; August must be empty.
    expect(getRuleOccurrenceDatesInMonth(monthly, 2026, 7)).toEqual([]);
  });

  it('gives a weekly rule no occurrences past its end_date, not even a partial month', () => {
    // Mondays in August 2026: 3, 10, 17, 24, 31. The rule ends after the first one.
    const weekly = rule({ frequency: 'weekly', due_day: 1, end_date: '2026-08-05' });
    expect(getRuleOccurrenceDatesInMonth(weekly, 2026, 7)).toEqual(['2026-08-03']);
  });

  it('gives a yearly rule no occurrence in its due month once end_date has passed', () => {
    const yearly = rule({ frequency: 'yearly', due_month: 8, due_day: 12, end_date: '2025-08-12' });
    expect(getRuleOccurrenceDatesInMonth(yearly, 2026, 7)).toEqual([]);
  });
});

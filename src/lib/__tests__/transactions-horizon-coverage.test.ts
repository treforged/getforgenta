// Coverage audit (2026-08-11), requested as: "verify that every planned/recurring transaction from
// budget control appears in ALL months of the transactions tab... Transactions.tsx already merges
// [the six sources] over the 60-month horizon, so the mechanism exists — this is a COVERAGE check,
// not a build."
//
// That premise does not hold for two of the six sources. `Transactions.tsx`'s own month filter
// (`monthOptions`, line ~230) offers all `PROJECTION_MONTHS` (60) months, implying every source is
// covered — but the recurring-rule and debt-payment rows it actually renders come from
// `mergeWithGeneratedTransactions` / `createDebtPaymentTransactions`, both of which are hard-pinned
// to the CURRENT calendar month:
//   - `mergeWithGeneratedTransactions` calls `generateCurrentMonthTransactionsFromRules`, which pins
//     `(year, month)` to `new Date()`.
//   - `createDebtPaymentTransactions` has no month parameter at all — it reads a single current-month
//     snapshot (`cardProjection.month0`) and always dates its rows into the current month.
// Selecting a future or past month in the tab therefore shows ONLY hand-entered transactions for
// those two sources — never a generated occurrence — even though the rule or the card payment will
// unquestionably recur then.
//
// `generatePaymentPlanTransactions` and `generateCarLoanTransactions` are the two sources that DO
// cover the full horizon, and a real 60-month rule engine (`generateScheduledEvents` in
// scheduling.ts) already exists and drives Forecast/Dashboard/Debt Payoff — it is simply never
// called from Transactions.tsx.
//
// These tests characterize the CURRENT behavior (they pass today) so the gap is pinned down and
// visible in the diff, rather than fixed silently — wiring the 60-month engine into the ledger view
// is a build, which this task was explicitly scoped not to do.

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  mergeWithGeneratedTransactions,
  generateMonthTransactionsFromRules,
  createDebtPaymentTransactions,
} from '../pay-schedule';
import type { RuleRow } from '@/hooks/useSupabaseData';

const rule = (over: Partial<RuleRow> = {}): RuleRow => ({
  id: 'r1',
  name: 'Rent',
  amount: 1600,
  rule_type: 'expense',
  frequency: 'monthly',
  active: true,
  start_date: '2026-01-01',
  end_date: null,
  category: 'Bills',
  due_day: 15,
  due_month: null,
  created_at: '2026-01-01T00:00:00Z',
  ...over,
});

afterEach(() => vi.useRealTimers());

describe('mergeWithGeneratedTransactions — horizon coverage', () => {
  it('does generate the current month\'s occurrence of an active rule', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-11T12:00:00'));

    const merged = mergeWithGeneratedTransactions([], [rule()], []);
    expect(merged.map(t => t.date)).toContain('2026-08-15');
  });

  it('COVERAGE GAP: does not generate next month\'s occurrence, even though the same rule ' +
     'would produce one if the underlying generator were asked directly for that month', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-11T12:00:00'));

    // The rule DOES bill in September — the occurrence genuinely exists.
    const septemberOccurrence = generateMonthTransactionsFromRules([rule()], [], 2026, 8);
    expect(septemberOccurrence.map(t => t.date)).toEqual(['2026-09-15']);

    // But `mergeWithGeneratedTransactions` — what Transactions.tsx actually renders — never asks
    // for September, only ever the current month.
    const merged = mergeWithGeneratedTransactions([], [rule()], []);
    expect(merged.map(t => t.date)).not.toContain('2026-09-15');
  });
});

describe('createDebtPaymentTransactions — horizon coverage', () => {
  it('COVERAGE GAP: has no month parameter, so it can only ever describe the current month\'s ' +
     'recommended payment — there is no way to ask it for a future month\'s row', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-11T12:00:00'));

    const rows = createDebtPaymentTransactions(
      [{ cardId: 'c1', cardName: 'Visa', payment: 200, dueDay: 20 }],
      null,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].date.startsWith('2026-08')).toBe(true);
  });
});

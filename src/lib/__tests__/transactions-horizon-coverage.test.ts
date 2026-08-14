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

// 2026-08-13 — THE GAP THE HEADER DESCRIBES IS NOW CLOSED AT THE PAGE LEVEL, and this is the build
// the audit scoped itself not to do. `mergeWithGeneratedTransactions` is UNCHANGED (the
// characterization tests above still pass and still must); `Transactions.tsx` now calls
// `mergeWithGeneratedTransactionsForHorizon`, which layers future months on top for that one
// consumer. The engines keep the current-month function — they project future months themselves,
// and handing them generated occurrences twice was the whole reason not to widen it in place.
import { mergeWithGeneratedTransactionsForHorizon } from '../pay-schedule';

describe('mergeWithGeneratedTransactionsForHorizon', () => {
  it('generates rule occurrences in future months, not only the current one', () => {
    const merged = mergeWithGeneratedTransactionsForHorizon([], [rule()], [], 4);
    const months = new Set(merged.filter(t => t.isGenerated).map(t => t.date.slice(0, 7)));
    expect(months.size).toBe(4);
  });

  it('is exactly the current-month merge when the horizon is 1', () => {
    const horizon = mergeWithGeneratedTransactionsForHorizon([], [rule()], [], 1);
    const current = mergeWithGeneratedTransactions([], [rule()], []);
    expect(horizon).toEqual(current);
  });

  it('never generates into past months', () => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const merged = mergeWithGeneratedTransactionsForHorizon([], [rule()], [], 6);
    for (const t of merged.filter(t => t.isGenerated)) {
      expect(t.date.slice(0, 7) >= thisMonth).toBe(true);
    }
  });

  it('a real future row substitutes its generated twin — same date, note and amount', () => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    const r = rule({ due_day: 15 });
    const twin = {
      id: 'real-1', date: `${nextMonth}-15`, type: 'expense' as const,
      amount: Number(r.amount), category: 'Bills', note: r.name, payment_source: '',
    };
    const merged = mergeWithGeneratedTransactionsForHorizon([twin], [r], [], 3);
    const inNextMonth = merged.filter(t => t.date.startsWith(nextMonth) && t.note === r.name);
    expect(inNextMonth).toHaveLength(1);
    expect(inNextMonth[0].isGenerated).toBeUndefined();
  });

  it('an income rule reaches future months — the shape Tre asked for by name', () => {
    const income = rule({ id: 'inc', name: 'Paycheck', rule_type: 'income', due_day: 5 });
    const merged = mergeWithGeneratedTransactionsForHorizon([], [income], [], 3);
    const futureIncome = merged.filter(t => t.isGenerated && t.type === 'income');
    expect(futureIncome.length).toBeGreaterThanOrEqual(2);
  });
});

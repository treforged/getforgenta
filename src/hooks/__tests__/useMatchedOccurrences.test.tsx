// @vitest-environment jsdom
//
// Trap T9: four surfaces (Dashboard, Budget Control, Vehicles, the credit-card engine) built a
// CONFIRMED-ONLY occurrence set while `useForecastEngineInputs` and `CardProjectionContext` unioned
// in the automatic matches as well. So the forecast could treat a bill as already paid while the
// page the user was looking at went on charging it against remaining cash.
//
// This pins the union those four now take, and the FIRST assertion is the RED one: the same reviews
// through `buildConfirmedOccurrences` alone produce a set that does NOT contain the bank-proved
// occurrence. That is exactly the gap, executed rather than described.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { buildConfirmedOccurrences } from '@/lib/confirmed-capture';

const RULE = {
  id: 'rule-rent', user_id: 'u1', name: 'Rent', amount: 1600, rule_type: 'expense',
  frequency: 'monthly', due_day: 28, due_month: null, category: 'Bills',
  payment_source: 'acc-1', deposit_account: null, start_date: null, end_date: null,
  notes: null, active: true, created_at: '2026-01-01T00:00:00Z',
};

// The bank row that pays it, three days into the settle window and $8.42 over the rule.
const SETTLED = {
  id: 'stx-1', account_id: 'acc-1', amount: 1608.42, date: '2026-08-26',
  pending: false, name: 'GREYSTAR RENT', merchant_name: 'Greystar',
};

// A manual confirmation of a DIFFERENT rule, so the two halves of the union are distinguishable.
const REVIEW = {
  status: 'linked_rule', rule_id: 'rule-power', occurrence_month: '2026-08',
  occurrence_date: '2026-08-12', synced_transaction_id: 'stx-2',
};

const POWER_TXN = {
  id: 'stx-2', account_id: 'acc-1', amount: 132.05, date: '2026-08-12',
  pending: false, name: 'CITY UTILITIES', merchant_name: 'City Utilities',
};

vi.mock('@/hooks/useSupabaseData', () => ({
  useRecurringRules: () => ({ data: [RULE] }),
  useSyncedTransactions: () => ({ data: [SETTLED, POWER_TXN] }),
  useSyncedTransactionReviewsQuery: () => ({ data: [REVIEW] }),
}));

import { useMatchedOccurrences } from '../useMatchedOccurrences';

afterEach(() => { cleanup(); vi.useRealTimers(); });

function inAugust2026() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 25, 9, 0, 0));
}

describe('useMatchedOccurrences', () => {
  it('WOULD-FAIL PROOF: the confirmed-only set the four surfaces used has no bank-proved occurrence', () => {
    const confirmedOnly = buildConfirmedOccurrences([REVIEW]);
    expect(confirmedOnly.has('rule-power|2026-08-12')).toBe(true);
    expect(confirmedOnly.has('rule-rent|2026-08-28')).toBe(false);
  });

  it('unions the bank-proved occurrence with the confirmed one', () => {
    inAugust2026();
    const { result } = renderHook(() => useMatchedOccurrences());

    expect(result.current.occurrences.has('rule-rent|2026-08-28')).toBe(true);
    expect(result.current.occurrences.has('rule-power|2026-08-12')).toBe(true);
    expect(result.current.monthKey).toBe('2026-08');
  });

  it('derives the suppression set FROM the index, so the two cannot drift', () => {
    inAugust2026();
    const { result } = renderHook(() => useMatchedOccurrences());

    expect([...result.current.occurrences].sort()).toEqual([...result.current.index.keys()].sort());
  });

  it('keeps the real date and amount on the bank-proved entry, not the rule’s prediction', () => {
    inAugust2026();
    const { result } = renderHook(() => useMatchedOccurrences());

    const entry = result.current.index.get('rule-rent|2026-08-28');
    expect(entry).toBeDefined();
    if (!entry || entry.suppressOnly) throw new Error('expected a valued entry');
    expect(entry.actualDate).toBe('2026-08-26');
    expect(entry.actualAmount).toBe(1608.42);
    expect(entry.merchantName).toBe('Greystar');
    expect(entry.source).toBe('auto');
  });
});

import { describe, expect, it } from 'vitest';
import {
  aggregateSpend,
  monthRange,
  parseMonth,
  type SpendRow,
} from '../../../supabase/functions/spend-by-category/aggregate';

const NOW = new Date('2026-10-04T13:00:00Z');
const row = (over: Partial<SpendRow>): SpendRow => ({
  amount: 10, date: '2026-10-02', category: 'FOOD_AND_DRINK', pending: false,
  provider_transaction_id: null, pending_transaction_id: null, ...over,
});

describe('spend-by-category aggregate (ask fbc5671a)', () => {
  it('sums each category in cents, largest first, with exactly three top-level keys', () => {
    const body = aggregateSpend([
      row({ amount: 10.91 }),
      row({ amount: 4.1 }),
      row({ amount: 54.07, category: 'GENERAL_SERVICES' }),
    ], '2026-10', NOW);
    expect(Object.keys(body).sort()).toEqual(['categories', 'computed_at', 'month']);
    expect(body.month).toBe('2026-10');
    expect(body.computed_at).toBe('2026-10-04T13:00:00.000Z');
    expect(body.categories).toEqual([
      { name: 'GENERAL_SERVICES', spent_cents: 5407 },
      { name: 'FOOD_AND_DRINK', spent_cents: 1501 },
    ]);
  });

  it('leaves out transfers, card and loan payments, borrowing and income', () => {
    const body = aggregateSpend([
      row({ amount: 941.01, category: 'LOAN_PAYMENTS' }),
      row({ amount: 200, category: 'TRANSFER_OUT' }),
      row({ amount: -200.43, category: 'TRANSFER_IN' }),
      row({ amount: -814.97, category: 'INCOME' }),
      row({ amount: 500, category: 'LOAN_DISBURSEMENTS' }),
      row({ amount: 3 }),
    ], '2026-10', NOW);
    expect(body.categories).toEqual([{ name: 'FOOD_AND_DRINK', spent_cents: 300 }]);
  });

  it('nets a refund and drops a category whose net is not spending', () => {
    const body = aggregateSpend([
      row({ amount: 30 }),
      row({ amount: -12.5 }),
      row({ amount: 20, category: 'GENERAL_MERCHANDISE' }),
      row({ amount: -25, category: 'GENERAL_MERCHANDISE' }),
    ], '2026-10', NOW);
    expect(body.categories).toEqual([{ name: 'FOOD_AND_DRINK', spent_cents: 1750 }]);
  });

  it('counts only rows inside the month, December rolling to January', () => {
    const body = aggregateSpend([
      row({ amount: 1, date: '2026-11-30' }),
      row({ amount: 2, date: '2026-12-01' }),
      row({ amount: 4, date: '2026-12-31' }),
      row({ amount: 8, date: '2027-01-01' }),
      row({ amount: 16, date: null }),
    ], '2026-12', NOW);
    expect(body.categories).toEqual([{ name: 'FOOD_AND_DRINK', spent_cents: 600 }]);
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
  });

  it('counts a pending row once when its posted copy is also present', () => {
    const body = aggregateSpend([
      row({ amount: 10.91, pending: true, provider_transaction_id: 'p1' }),
      row({ amount: 10.91, pending: false, provider_transaction_id: 'x1', pending_transaction_id: 'p1' }),
      row({ amount: 5, pending: true, provider_transaction_id: 'p2' }),
    ], '2026-10', NOW);
    expect(body.categories).toEqual([{ name: 'FOOD_AND_DRINK', spent_cents: 1591 }]);
  });

  it('folds legacy spellings onto one key and ignores a non-numeric amount', () => {
    const body = aggregateSpend([
      row({ amount: 2, category: 'Food and Drink' }),
      row({ amount: 3, category: 'FOOD_AND_DRINK' }),
      row({ amount: 'abc' }),
      row({ amount: null }),
      row({ amount: 7, category: 'Transfer' }),
      row({ amount: 1, category: null }),
    ], '2026-10', NOW);
    expect(body.categories).toEqual([
      { name: 'FOOD_AND_DRINK', spent_cents: 500 },
      { name: 'OTHER', spent_cents: 100 },
    ]);
  });

  it('answers an empty month with an empty list, never an error', () => {
    expect(aggregateSpend([], '2026-10', NOW).categories).toEqual([]);
  });

  it('accepts only YYYY-MM', () => {
    expect(parseMonth('2026-10')).toBe('2026-10');
    for (const bad of ['2026-13', '2026-1', '26-10', '2026-10-01', '', null, "2026-10' or 1=1"]) {
      expect(parseMonth(bad)).toBeNull();
    }
  });
});

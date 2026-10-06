import { describe, it, expect } from 'vitest';
import { averageMonthlySpentCents, buildSpentRows, computeMonthSpent, resolveBankCategory, type MonthSpentInput, type SpentBankRow, type SpentLedgerRow } from '../budget-spent';

// Drafted by the free tier (groq gpt-oss-120b), corrected in review: 4, 7 and 8 were rewritten.
const base: MonthSpentInput = {
  from: '2026-10-01', to: '2026-10-31',
  matchedCategory: new Map(), overrides: new Map(), transferLegIds: new Set(),
  bank: [], ledger: [],
};
const b = (id: string, date: string, amount: number | string, category: string | null, extra: Partial<SpentBankRow> = {}): SpentBankRow =>
  ({ id, date, amount, category, ...extra });
const EMPTY = { totalCents: 0, byCategory: {}, countedRows: 0 };

describe('computeMonthSpent', () => {
  it('1. empty input', () => {
    expect(computeMonthSpent(base)).toEqual(EMPTY);
  });

  it('2. a numeric-string amount on FOOD_AND_DRINK lands in Dining', () => {
    expect(computeMonthSpent({ ...base, bank: [b('1', '2026-10-15', '12.34', 'FOOD_AND_DRINK')] }))
      .toEqual({ totalCents: 1234, byCategory: { Dining: 1234 }, countedRows: 1 });
  });

  it('3. a day either side of the range is excluded, the edges are included', () => {
    const r = computeMonthSpent({ ...base, bank: [
      b('1', '2026-09-30', 100, 'FOOD_AND_DRINK'), b('2', '2026-11-01', 100, 'FOOD_AND_DRINK'),
      b('3', '2026-10-01', 1, 'FOOD_AND_DRINK'), b('4', '2026-10-31', 2, 'FOOD_AND_DRINK'),
    ] });
    expect(r).toEqual({ totalCents: 300, byCategory: { Dining: 300 }, countedRows: 2 });
  });

  it('4. pending, transfer legs and non-spending provider categories are excluded', () => {
    const r = computeMonthSpent({ ...base,
      bank: [
        b('p', '2026-10-15', 100, 'FOOD_AND_DRINK', { pending: true }),
        b('leg', '2026-10-15', 100, 'GENERAL_MERCHANDISE'),
        b('t', '2026-10-15', 100, 'TRANSFER_OUT'),
        b('l', '2026-10-15', 100, 'LOAN_PAYMENTS'),
        b('i', '2026-10-15', 100, 'income'),
        b('keep', '2026-10-15', 5, 'FOOD_AND_DRINK', { pending: false }),
      ],
      transferLegIds: new Set(['leg']) });
    expect(r).toEqual({ totalCents: 500, byCategory: { Dining: 500 }, countedRows: 1 });
  });

  it('5. the matched rule beats the user override, which beats the provider', () => {
    const r = computeMonthSpent({ ...base,
      bank: [b('1', '2026-10-15', 100, 'RENT_AND_UTILITIES'), b('2', '2026-10-15', 100, 'RENT_AND_UTILITIES'), b('3', '2026-10-15', 100, 'RENT_AND_UTILITIES')],
      matchedCategory: new Map([['1', 'Rent']]),
      overrides: new Map([['1', 'Groceries'], ['2', 'Groceries']]) });
    expect(r).toEqual({ totalCents: 30000, byCategory: { Rent: 10000, Groceries: 10000, Utilities: 10000 }, countedRows: 3 });
  });

  it('6. a LOAN_PAYMENTS row counts only when matched to a spending rule; Debt Payments never counts', () => {
    const r = computeMonthSpent({ ...base,
      bank: [b('1', '2026-10-15', 100, 'LOAN_PAYMENTS'), b('2', '2026-10-15', 7, 'LOAN_PAYMENTS'), b('3', '2026-10-15', 9, 'FOOD_AND_DRINK')],
      matchedCategory: new Map([['1', 'Car'], ['2', 'Debt Payments']]),
      overrides: new Map([['3', 'Debt Payments']]) });
    expect(r).toEqual({ totalCents: 10000, byCategory: { Car: 10000 }, countedRows: 1 });
  });

  it('7. an override to Savings is not spending', () => {
    const r = computeMonthSpent({ ...base,
      bank: [b('1', '2026-10-15', 100, 'FOOD_AND_DRINK')], overrides: new Map([['1', 'Savings']]) });
    expect(r).toEqual(EMPTY);
  });

  it('8. a refund nets against its category, and never drives it below zero', () => {
    expect(computeMonthSpent({ ...base, bank: [b('1', '2026-10-15', 50, 'GENERAL_MERCHANDISE'), b('2', '2026-10-16', -20, 'GENERAL_MERCHANDISE')] }))
      .toEqual({ totalCents: 3000, byCategory: { Shopping: 3000 }, countedRows: 2 });
    const over = computeMonthSpent({ ...base, bank: [
      b('1', '2026-10-15', 50, 'GENERAL_MERCHANDISE'), b('2', '2026-10-16', -80, 'GENERAL_MERCHANDISE'), b('3', '2026-10-16', 7, 'FOOD_AND_DRINK'),
    ] });
    expect(over.byCategory).toEqual({ Dining: 700 });
    expect(over.totalCents).toBe(700);
  });

  it('9. ledger: manual and null-origin expenses count; synced copies and income do not', () => {
    const r = computeMonthSpent({ ...base, ledger: [
      { date: '2026-10-15', amount: 100, category: 'Shopping', type: 'expense', origin: 'manual' },
      { date: '2026-10-15', amount: 200, category: 'Shopping', type: 'expense', origin: 'synced' },
      { date: '2026-10-15', amount: 300, category: 'Income', type: 'income' },
      { date: '2026-10-15', amount: 400, category: 'Car', type: 'expense', origin: null },
      { date: '2027-01-20', amount: 2000, category: 'Gifts', type: 'expense', origin: 'manual' },
    ] });
    expect(r).toEqual({ totalCents: 50000, byCategory: { Shopping: 10000, Car: 40000 }, countedRows: 2 });
  });

  it('10. three rows of 0.1 sum to exactly 30 cents', () => {
    const r = computeMonthSpent({ ...base, bank: ['1', '2', '3'].map(id => b(id, '2026-10-15', 0.1, 'FOOD_AND_DRINK')) });
    expect(r).toEqual({ totalCents: 30, byCategory: { Dining: 30 }, countedRows: 3 });
  });

  it('11. frozen inputs are not mutated', () => {
    const bank = Object.freeze([Object.freeze(b('1', '2026-10-15', 100, 'FOOD_AND_DRINK'))]);
    const ledger = Object.freeze([Object.freeze({ date: '2026-10-15', amount: 1, category: 'Car', type: 'expense' })]);
    expect(computeMonthSpent({ ...base, bank, ledger }).totalCents).toBe(10100);
  });
});

describe('resolveBankCategory', () => {
  const ctx = { matchedCategory: new Map<string, string>(), overrides: new Map<string, string>() };
  it('returns null for a transfer and the mapped category otherwise', () => {
    expect(resolveBankCategory(b('1', '2026-10-01', 1, ' transfer_in '), ctx)).toBeNull();
    expect(resolveBankCategory(b('1', '2026-10-01', 1, 'TRANSPORTATION'), ctx)).toBe('Car');
  });
});

describe('buildSpentRows', () => {
  it('empty', () => {
    expect(buildSpentRows([], {})).toEqual({ rows: [], plannedCents: 0, spentCents: 0 });
  });

  it('sum same category', () => {
    const planned = [
      { category: 'food', amount: 10.1 },
      { category: 'food', amount: 0.2 },
    ];
    const spentByCategory = {};
    expect(buildSpentRows(planned, spentByCategory)).toEqual({
      rows: [{ category: 'food', plannedCents: 1030, spentCents: 0 }],
      plannedCents: 1030,
      spentCents: 0,
    });
  });

  it('zero/negative planned with no spend dropped', () => {
    const planned = [{ category: 'travel', amount: -50 }, { category: 'nan', amount: Number.NaN }];
    const spentByCategory = {};
    expect(buildSpentRows(planned, spentByCategory)).toEqual({ rows: [], plannedCents: 0, spentCents: 0 });
  });

  it('unplanned spend appears after planned rows', () => {
    const planned = [{ category: 'entertainment', amount: 100 }];
    const spentByCategory = { 'food': 1000 };
    expect(buildSpentRows(planned, spentByCategory)).toEqual({
      rows: [
        { category: 'entertainment', plannedCents: 10000, spentCents: 0 },
        { category: 'food', plannedCents: 0, spentCents: 1000 },
      ],
      plannedCents: 10000,
      spentCents: 1000,
    });
  });

  it('sort order with tie', () => {
    const planned = [
      { category: 'a', amount: 1 },
      { category: 'b', amount: 1 },
    ];
    const spentByCategory = {};
    expect(buildSpentRows(planned, spentByCategory)).toEqual({
      rows: [
        { category: 'a', plannedCents: 100, spentCents: 0 },
        { category: 'b', plannedCents: 100, spentCents: 0 },
      ],
      plannedCents: 200,
      spentCents: 0,
    });
  });

  it('totals', () => {
    const planned = [
      { category: 'x', amount: 2 },
      { category: 'y', amount: 3 },
    ];
    const spentByCategory = { 'x': 100, 'z': 200 };
    expect(buildSpentRows(planned, spentByCategory)).toEqual({
      rows: [
        { category: 'y', plannedCents: 300, spentCents: 0 },
        { category: 'x', plannedCents: 200, spentCents: 100 },
        { category: 'z', plannedCents: 0, spentCents: 200 },
      ],
      plannedCents: 500,
      spentCents: 300,
    });
  });
});

describe('averageMonthlySpentCents', () => {
  it('no rows and fallback 0', () => {
    const bank: SpentBankRow[] = []
    const ledger: SpentLedgerRow[] = []
    const result = averageMonthlySpentCents({
      bank,
      ledger,
      now: new Date(2026, 9, 5),
      months: 5,
      overrides: new Map(),
      transferLegIds: new Set(),
      ledgerOnlyCents: () => 0,
    })
    expect(result).toEqual({ averageCents: 0, bankMonths: 0 })
  })

  it('one bank row Sep 2026, months 5', () => {
    const bank = [b('1', '2026-09-15', 100, 'FOOD_AND_DRINK')]
    const result = averageMonthlySpentCents({
      bank,
      ledger: [],
      now: new Date(2026, 9, 5),
      months: 5,
      overrides: new Map(),
      transferLegIds: new Set(),
      ledgerOnlyCents: () => 0,
    })
    expect(result).toEqual({ averageCents: 2000, bankMonths: 1 })
  })

  it('fallback used for months without bank rows', () => {
    const bank = [b('1', '2026-09-15', 100, 'FOOD_AND_DRINK')]
    const result = averageMonthlySpentCents({
      bank,
      ledger: [],
      now: new Date(2026, 9, 5),
      months: 5,
      overrides: new Map(),
      transferLegIds: new Set(),
      ledgerOnlyCents: (monthKey) => monthKey === '2026-08' ? 5000 : 0,
    })
    expect(result).toEqual({ averageCents: 3000, bankMonths: 1 })
  })

  it('row in current month ignored', () => {
    const bank = [b('1', '2026-10-01', 100, 'FOOD_AND_DRINK')]
    const result = averageMonthlySpentCents({
      bank,
      ledger: [],
      now: new Date(2026, 9, 5),
      months: 5,
      overrides: new Map(),
      transferLegIds: new Set(),
      ledgerOnlyCents: () => 0,
    })
    expect(result).toEqual({ averageCents: 0, bankMonths: 0 })
  })

  it('TRANSFER_OUT-only month counts as bank month', () => {
    const bank = [b('1', '2026-09-15', 40, 'TRANSFER_OUT')]
    const result = averageMonthlySpentCents({
      bank,
      ledger: [],
      now: new Date(2026, 9, 5),
      months: 1,
      overrides: new Map(),
      transferLegIds: new Set(),
      ledgerOnlyCents: () => 99999,
    })
    expect(result).toEqual({ averageCents: 0, bankMonths: 1 })
  })

  it('year boundary: bank row in Dec 2026', () => {
    const bank = [b('1', '2026-12-31', 50, 'FOOD_AND_DRINK')]
    const result = averageMonthlySpentCents({
      bank,
      ledger: [],
      now: new Date(2027, 0, 10),
      months: 1,
      overrides: new Map(),
      transferLegIds: new Set(),
      ledgerOnlyCents: () => 0,
    })
    expect(result).toEqual({ averageCents: 5000, bankMonths: 1 })
  })
})

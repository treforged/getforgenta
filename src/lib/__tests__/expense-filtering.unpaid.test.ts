// A bill due TODAY is not a bill already paid.
//
// `getUnpaidExpenses` used to parse `t.date` with `new Date('2026-09-03')`, which is UTC
// midnight — the evening of the 2nd at any negative offset. Compared against a LOCAL midnight
// "today", an expense dated today sorted as past and was dropped from "unpaid" every single day
// in US Eastern. That understates remaining expenses, which overstates spare cash: the unsafe
// direction, on money that has not left the account.
//
// Both functions are currently UNREFERENCED — this pins the behaviour so the next caller to
// import them gets the fixed version rather than reintroducing the defect that, in
// scheduling.ts, moved Tre's projected CC payoff by three months.
//
// Would-fail check: restore `new Date(t.date) >= today` and "an expense dated TODAY still counts
// as unpaid" fails under TZ=America/New_York while passing under TZ=UTC — which is exactly how
// the original survived.

import { describe, it, expect } from 'vitest';
import { getUnpaidExpenses, getRemainingMonthExpenses } from '../expense-filtering';

type Tx = Parameters<typeof getUnpaidExpenses>[0][number];

const tx = (date: string, amount = 100): Tx => ({
  id: `t-${date}-${amount}`, date, type: 'expense', amount, category: 'Bills',
} as unknown as Tx);

// Late evening local — the time of day the bug actually bit, since that is when a negative
// offset has already rolled the UTC date forward.
const REFERENCE = new Date(2026, 8, 3, 22, 30, 0); // 3 Sep 2026, 22:30 LOCAL

describe('getUnpaidExpenses', () => {
  it('AN EXPENSE DATED TODAY STILL COUNTS AS UNPAID', () => {
    // The whole bug in one assertion. Rent due today has not been paid because it is late.
    const out = getUnpaidExpenses([tx('2026-09-03', 1915)], REFERENCE);
    expect(out).toHaveLength(1);
    expect(out[0].amount).toBe(1915);
  });

  it('drops an expense dated yesterday', () => {
    expect(getUnpaidExpenses([tx('2026-09-02')], REFERENCE)).toHaveLength(0);
  });

  it('keeps an expense dated tomorrow', () => {
    expect(getUnpaidExpenses([tx('2026-09-04')], REFERENCE)).toHaveLength(1);
  });

  it('handles a full timestamp, not just a bare date', () => {
    expect(getUnpaidExpenses([tx('2026-09-03T14:00:00Z')], REFERENCE)).toHaveLength(1);
  });

  it('counts an undated expense as unpaid — the safe direction', () => {
    const undated = { id: 'u', type: 'expense', amount: 50 } as unknown as Tx;
    expect(getUnpaidExpenses([undated], REFERENCE)).toHaveLength(1);
  });

  it('ignores income', () => {
    const income = { id: 'i', date: '2026-09-04', type: 'income', amount: 500 } as unknown as Tx;
    expect(getUnpaidExpenses([income], REFERENCE)).toHaveLength(0);
  });

  it('is stable across a month boundary at 23:59 local', () => {
    // 30 Sep late evening is 1 Oct in UTC. An expense dated the 30th must still be today's.
    const monthEnd = new Date(2026, 8, 30, 23, 59, 0);
    expect(getUnpaidExpenses([tx('2026-09-30')], monthEnd)).toHaveLength(1);
    expect(getUnpaidExpenses([tx('2026-09-29')], monthEnd)).toHaveLength(0);
  });
});

describe('getRemainingMonthExpenses', () => {
  it('sums what is still owed, today included', () => {
    // Uses the live clock, so build the dates from it rather than hardcoding.
    const now = new Date();
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const total = getRemainingMonthExpenses([tx(iso(now), 200), tx(iso(yesterday), 999)]);
    expect(total).toBe(200);
  });
});

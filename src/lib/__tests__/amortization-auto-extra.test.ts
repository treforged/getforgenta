// THE AMORTIZATION SCHEDULE, WITH THE RANKED EXTRA PAYMENTS IN IT.
//
// Tre, 2026-08-26: "for auto loan, the amortization schedule should be updated with the extra
// payments" and "on the garage tab under active loans, the auto generated extra payments should
// show and the chart should update". The CHART gained its extra-aware line in `6e676601`; the table
// under it was still built from the fund's own lump sums alone, so a user who had ranked the loan
// read a table that contradicted the line directly above it.
//
// The inertness test is the one that matters most here: this function draws the payoff date on
// every vehicle in the app, and a schedule with no ranked extra is every existing user.

import { describe, it, expect } from 'vitest';
import { buildAmortizationSchedule } from '../vehicle-loan-engine';

const AS_OF = new Date('2026-08-27T12:00:00');

const loan = (over: Record<string, unknown> = {}) => ({
  loanAmount: 20_000,
  apr: 6,
  termMonths: 60,
  loanStartDate: '2026-01-01',
  paymentStartDate: '2026-01-01',
  interestStartDate: '2026-01-01',
  actualMonthlyPayment: 0,
  lumpSumPayments: [],
  ...over,
});

describe('buildAmortizationSchedule — ranked extras', () => {
  it('is INERT with no map: every row byte-identical apart from the new zeroed column', () => {
    const before = buildAmortizationSchedule(loan(), AS_OF);
    const after = buildAmortizationSchedule(loan({ autoExtraByMonth: {} }), AS_OF);
    expect(after.payoffMonth).toBe(before.payoffMonth);
    expect(after.totalInterest).toBeCloseTo(before.totalInterest, 6);
    expect(after.totalPaid).toBeCloseTo(before.totalPaid, 6);
    expect(after.schedule.map(r => [r.payment, r.principal, r.interest, r.endBalance]))
      .toEqual(before.schedule.map(r => [r.payment, r.principal, r.interest, r.endBalance]));
    expect(before.schedule.every(r => r.autoExtra === 0)).toBe(true);
  });

  it('applies a month\'s extra as further principal, and reports it on the row', () => {
    const withExtra = buildAmortizationSchedule(
      loan({ autoExtraByMonth: { '2026-03': 500 } }), AS_OF,
    );
    const march = withExtra.schedule.find(r => r.date.startsWith('2026-03'))!;
    const plain = buildAmortizationSchedule(loan(), AS_OF)
      .schedule.find(r => r.date.startsWith('2026-03'))!;
    expect(march.autoExtra).toBe(500);
    expect(march.payment).toBeCloseTo(plain.payment + 500, 2);
    expect(march.endBalance).toBeCloseTo(plain.endBalance - 500, 2);
  });

  it('retires the loan sooner and cheaper, which is the whole point', () => {
    const every = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => {
        const d = new Date(2026, i, 1);
        return [`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 300];
      }),
    );
    const before = buildAmortizationSchedule(loan(), AS_OF);
    const after = buildAmortizationSchedule(loan({ autoExtraByMonth: every }), AS_OF);
    expect(after.payoffMonth).toBeLessThan(before.payoffMonth);
    expect(after.totalInterest).toBeLessThan(before.totalInterest);
  });

  it('NEVER drives the balance below zero, however big the extra', () => {
    const after = buildAmortizationSchedule(
      loan({ autoExtraByMonth: { '2026-02': 999_999 } }), AS_OF,
    );
    expect(after.schedule.every(r => r.endBalance >= 0)).toBe(true);
    const feb = after.schedule.find(r => r.date.startsWith('2026-02'))!;
    expect(feb.endBalance).toBe(0);
    // It may only take what is actually owed, not the whole 999,999.
    expect(feb.autoExtra).toBeLessThan(20_000);
    expect(after.schedule[after.schedule.length - 1].month).toBe(feb.month);
  });

  it('shares one month with a LUMP SUM without either overshooting the balance', () => {
    const after = buildAmortizationSchedule(loan({
      lumpSumPayments: [{ id: 'l', date: '2026-02-10', amount: 999_999 }],
      autoExtraByMonth: { '2026-02': 999_999 },
    }), AS_OF);
    const feb = after.schedule.find(r => r.date.startsWith('2026-02'))!;
    expect(feb.endBalance).toBe(0);
    // The lump sum is capped first and takes what is left, so the ranked extra takes nothing —
    // three sources of principal against one balance, and the balance wins.
    expect(feb.autoExtra).toBe(0);
    expect(feb.payment).toBeCloseTo(feb.startBalance + feb.interest, 2);
  });

  it('joins on the CALENDAR month, so an extra dated outside the schedule changes nothing', () => {
    const before = buildAmortizationSchedule(loan(), AS_OF);
    const after = buildAmortizationSchedule(loan({ autoExtraByMonth: { '2099-01': 5_000 } }), AS_OF);
    expect(after.payoffMonth).toBe(before.payoffMonth);
    expect(after.totalInterest).toBeCloseTo(before.totalInterest, 6);
  });
});

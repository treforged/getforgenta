import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildCardData, simulateVariablePayoff, type CardData } from '../credit-card-engine';
import type { AccountRow } from '@/hooks/useSupabaseData';

// Q5 — manual interest-saving balance semantics (see .claude/plan/interest-saving-balance-semantics.md).
//
// accounts.statement_balance is the amount due at the card's NEXT due date only — not a
// replacement for the card's balance. The engine models it as:
//   - months before the due month pay $0 (that cycle's statement was already paid),
//   - the due month pays the entered amount CAPPED BY CASH above the floor — a front-of-cascade
//     target, not an unconditional pin; the uncovered remainder accrues at the standard rate
//     via graceUnpaid (partial-ISB model), and the floor is never drained to fund the ISB,
//   - later months revert to normal statement-preference behavior.
// The due month is 0 when the due day hasn't passed yet this month, else 1. Grace holds in
// full only when the ISB is fully covered; a shortfall accrues on the shortfall alone.
// A user payment override stays unconditional — a command, not a reported bill.

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'card', name: 'Card', balance: 0, apr: 24, creditLimit: 20000,
    minPayment: 25, minPaymentIsManual: true, targetPayment: 25,
    monthlyNewPurchases: 0, monthlyRepayments: 0,
    color: '#000', paymentPreference: null, autopayFullBalance: false,
    dueDay: 1, statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}

// Positional args 9-20 unused by these scenarios.
const PAD = [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined] as const;

const flatEvents = (n: number, income: number, expenses: number) =>
  Array.from({ length: n }, () => ({ income, expenses }));

// Statement-pref card with a manual ISB whose due day (7) has passed on the frozen clock (the 14th).
const pv = () => makeCard({
  id: 'pv', name: 'PV', balance: 6004, apr: 28, minPayment: 40,
  paymentPreference: 'statement', statementBalance: 1164.79, dueDay: 7,
  monthlyNewPurchases: 400,
});
// Zero-balance cycling card competing for the same monthly cash.
const disc = () => makeCard({
  id: 'disc', name: 'Disc', balance: 0, apr: 22, autopayFullBalance: true,
  paymentPreference: 'statement', monthlyNewPurchases: 1200, dueDay: 1,
});

describe('simulateVariablePayoff — manual interest-saving balance', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-14T12:00:00'));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  // liquidCash 3800, floor 3500, +1000/mo net: month-1 cash above floor = 2300, so the
  // ISB (1164.79) and the cycling card's 1200 statement can't BOTH be fully funded.
  const run = (cards: CardData[], overrides?: { [cardId: string]: Record<number, number> }) =>
    simulateVariablePayoff(
      cards, 3800, 3500, 'avalanche', 0, 0, 3, flatEvents(3, 2000, 1000),
      ...PAD, overrides,
    );

  it('due day passed → month 0 pays $0, month 1 pays what cash allows toward the ISB', () => {
    const sim = run([pv(), disc()]);
    expect(sim.monthlyPayments.get('pv')![0]).toBe(0);
    // Month-1 cash above floor+cushion = 2300 − 2 = 2298. The cycling mandatory pool takes
    // 1135.21 (2300 − the 1164.79 ISB reservation), leaving 1162.79; minimums come first
    // (PV 40 + Disc's same-month backlog min 25 = 65), and the ISB target collects the
    // cascade remainder: 40 + 1097.79 = 1137.79. The old engine paid 1164.79 here by
    // draining cash below the floor; the $27.00 shortfall now accrues instead (next test).
    expect(sim.monthlyPayments.get('pv')![1]).toBeCloseTo(1137.79, 2);
  });

  it('the ISB is funded first — the competing cycling card pulls back its statement payment, floor holds', () => {
    const sim = run([pv(), disc()]);
    // Month-1 cash above floor = 2300; PV's 1164.79 ISB reservation comes off the top, leaving
    // 1135.21 for Disc's 1200 statement — pulled back, not fully paid. The ISB never eats
    // Disc's contract minimum, and Disc's payments are identical to the old pin model.
    expect(sim.monthlyMandatoryCyclingPayment.get('disc')![1]).toBeCloseTo(1135.21, 2);
    // The 64.79 shortfall becomes backlog the same month; its $25 contract minimum is paid
    // from the Step-5 pool AHEAD of the ISB's cascade draw (minimums outrank the ISB target).
    expect(sim.monthlyPayments.get('disc')![1]).toBeCloseTo(1160.21, 2);
    // The old pin drained cash $25 below the floor to do this; the cash-capped ISB holds it.
    expect(sim.projectedCashByMonth[1]).toBeGreaterThanOrEqual(3500 - 0.01);
  });

  it('the uncovered ISB remainder accrues at the standard rate — not the whole balance', () => {
    const sim = run([pv(), disc()]);
    expect(sim.monthlyInterest.get('pv')![0]).toBe(0);
    expect(sim.monthlyInterest.get('pv')![1]).toBe(0);
    // Month 1 covered 1137.79 of the 1164.79 ISB (first test). Partial-ISB grace: only the
    // $27.00 shortfall accrues, at the standard rate → 27.00 × 28%/12 = $0.63. Grace-or-nothing
    // would have charged the whole ~$6,400 carry-over (~$150); the old unconditional pin
    // charged $0 by spending cash the month did not have above the floor.
    expect(sim.monthlyInterest.get('pv')![2]).toBeCloseTo(0.63, 2);
  });

  it('balance keeps walking from the REAL balance, not the ISB', () => {
    const sim = run([pv(), disc()]);
    // End of month 1 = 6004 + month-1 purchases (400) − 1137.79 (cash-capped ISB payment).
    expect(sim.monthlyBalances.get('pv')![1]).toBeCloseTo(6004 + 400 - 1137.79, 2);
  });

  it('due day NOT yet passed → the ISB is paid in month 0', () => {
    const sim = run([{ ...pv(), dueDay: 20 }, disc()]);
    expect(sim.monthlyPayments.get('pv')![0]).toBeCloseTo(1164.79, 2);
  });

  it('a user override on the same card/month wins over the synthetic pin', () => {
    const sim = run([pv(), disc()], { pv: { 1: 300 } });
    expect(sim.monthlyPayments.get('pv')![1]).toBeCloseTo(300, 2);
    // Underpaying the statement breaks grace → interest appears the following month.
    expect(sim.monthlyInterest.get('pv')![2]).toBeGreaterThan(0);
  });

  it('a month that can afford the ISB pays it in full — identical to the old pin', () => {
    // Same shape, +1200/mo more income: month-1 cash above floor+cushion = 3498, enough for
    // the ISB (1164.79), Disc's full 1200 statement, and every minimum. Nothing accrues.
    const sim = simulateVariablePayoff(
      [pv(), disc()], 3800, 3500, 'avalanche', 0, 0, 3, flatEvents(3, 3200, 1000),
      ...PAD,
    );
    expect(sim.monthlyPayments.get('pv')![1]).toBeCloseTo(1164.79, 2);
    expect(sim.monthlyMandatoryCyclingPayment.get('disc')![1]).toBeCloseTo(1200, 2);
    expect(sim.monthlyInterest.get('pv')![2]).toBe(0);
  });

  it('a user override stays unconditional even when cash cannot cover it', () => {
    // 2400 exceeds month-1 cash above the floor (2298). The synthetic ISB would be capped;
    // an explicit override is a command and still pays in full, exactly as before.
    const sim = run([pv(), disc()], { pv: { 1: 2400 } });
    expect(sim.monthlyPayments.get('pv')![1]).toBeCloseTo(2400, 2);
  });
});

describe('buildCardData — statement_balance no longer replaces the balance', () => {
  function makeAccount(overrides: Partial<AccountRow>): AccountRow {
    return {
      id: 'card-1', user_id: 'test', name: 'Card', account_type: 'credit_card', balance: 6004,
      credit_limit: 14300, apr: 28, payment_due_day: 7, active: true,
      min_payment: 40, payment_preference: 'statement',
      ...overrides,
    };
  }

  it('keeps the real balance and carries the ISB separately', () => {
    const cards = buildCardData([makeAccount({ statement_balance: 1164.79 })], [], [], []);
    expect(cards[0].balance).toBe(6004);
    expect(cards[0].statementBalance).toBe(1164.79);
    expect(cards[0].autopayFullBalance).toBe(false);
  });

  it('no manual ISB → unchanged mapping', () => {
    const cards = buildCardData([makeAccount({ statement_balance: null })], [], [], []);
    expect(cards[0].balance).toBe(6004);
    expect(cards[0].statementBalance).toBeNull();
  });
});

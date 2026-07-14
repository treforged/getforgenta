import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { buildCardData, simulateVariablePayoff, type CardData } from '../credit-card-engine';
import type { AccountRow } from '@/hooks/useSupabaseData';

// Q5 — manual interest-saving balance semantics (see .claude/plan/interest-saving-balance-semantics.md).
//
// accounts.statement_balance is the amount due at the card's NEXT due date only — not a
// replacement for the card's balance. The engine models it as a synthetic payment pin:
//   - months before the due month pay $0 (that cycle's statement was already paid),
//   - the due month pays exactly the entered amount,
//   - later months revert to normal statement-preference behavior.
// The due month is 0 when the due day hasn't passed yet this month, else 1. Grace holds
// through the pinned months (paying the interest-saving amount is what keeps grace).

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

  it('due day passed → month 0 pays $0, month 1 pays exactly the interest-saving balance', () => {
    const sim = run([pv(), disc()]);
    expect(sim.monthlyPayments.get('pv')![0]).toBe(0);
    expect(sim.monthlyPayments.get('pv')![1]).toBeCloseTo(1164.79, 2);
  });

  it('the ISB is funded first — the competing cycling card pulls back its statement payment, floor holds', () => {
    const sim = run([pv(), disc()]);
    // Month-1 cash above floor = 2300; PV's pinned 1164.79 comes off the top, leaving
    // 1135.21 for Disc's 1200 statement — pulled back, not fully paid.
    expect(sim.monthlyMandatoryCyclingPayment.get('disc')![1]).toBeCloseTo(1135.21, 2);
    // The 64.79 shortfall becomes backlog the same month, whose $25 contract minimum the
    // enforcement guard pays even with the pool exhausted (pre-existing engine behavior —
    // the Q2 "single small dip"). Total = 1135.21 + 25; cash dips at most that $25 below floor.
    expect(sim.monthlyPayments.get('disc')![1]).toBeCloseTo(1160.21, 2);
    expect(sim.projectedCashByMonth[1]).toBeGreaterThanOrEqual(3500 - 25 - 0.01);
  });

  it('grace holds through the ISB payment — no interest in months 0-2', () => {
    const sim = run([pv(), disc()]);
    expect(sim.monthlyInterest.get('pv')![0]).toBe(0);
    expect(sim.monthlyInterest.get('pv')![1]).toBe(0);
    // Month-2 interest is computed from month-1's grace state, which the full ISB payment preserved.
    expect(sim.monthlyInterest.get('pv')![2]).toBe(0);
  });

  it('balance keeps walking from the REAL balance, not the ISB', () => {
    const sim = run([pv(), disc()]);
    // End of month 1 = 6004 + month-1 purchases (400) − 1164.79 (no interest in grace).
    expect(sim.monthlyBalances.get('pv')![1]).toBeCloseTo(6004 + 400 - 1164.79, 2);
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

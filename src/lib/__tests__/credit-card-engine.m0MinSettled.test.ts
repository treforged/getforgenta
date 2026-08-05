import { describe, it, expect } from 'vitest';
import { calcMinPayment, m0MinDueSettled, simulateVariablePayoff, type CardData } from '../credit-card-engine';

// Q11 (2026-07-17): a revolving card whose current-month due date is on/before the Plaid sync
// cutoff already made this cycle's payment — the live balance reflects it. Month 0 must not
// force that card's minimum again (it double-counted cash: Discover due Jul 1 kept a $227 min
// in July's plan); the next minimum lands in month 1. Extra, optional paydown in month 0 is
// still allowed — only the FORCED minimum moves.

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'card', name: 'Card', balance: 0, apr: 0, creditLimit: 5000,
    minPayment: 25, targetPayment: 25, monthlyNewPurchases: 0, monthlyRepayments: 0,
    color: '#000', paymentPreference: null, autopayFullBalance: false,
    dueDay: 1, statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}

describe('m0MinDueSettled', () => {
  const now = new Date('2026-07-17T12:00:00');

  it('true when the due date this month is captured in the balance', () => {
    // Cutoff Jul 15, settlement lag 3 days ⇒ captured means strictly before Jul 12.
    expect(m0MinDueSettled(1, '2026-07-15', now)).toBe(true);
    expect(m0MinDueSettled(11, '2026-07-15', now)).toBe(true);
  });

  it('false when the due date has not been captured by a sync yet', () => {
    expect(m0MinDueSettled(20, '2026-07-15', now)).toBe(false);
    expect(m0MinDueSettled(16, '2026-07-15', now)).toBe(false);
  });

  // §1.1 cause C sweep: this gate now shares `isCapturedInBalance` with the car-loan and
  // loan-insurance gates, so it inherits both the settlement lag and the strict boundary. A debit
  // that has posted but not settled is absent from `balances.current`, so a minimum due inside the
  // lag window must stay reserved — dropping it read cash HIGH, the unsafe direction.
  it('keeps a minimum reserved inside the settlement-lag window and on the cutoff day itself', () => {
    expect(m0MinDueSettled(15, '2026-07-15', now)).toBe(false); // due exactly on the cutoff
    expect(m0MinDueSettled(14, '2026-07-15', now)).toBe(false);
    expect(m0MinDueSettled(12, '2026-07-15', now)).toBe(false); // boundary: lag edge, not captured
  });

  it('false without a sync cutoff or due day (conservative: keep the minimum)', () => {
    expect(m0MinDueSettled(1, undefined, now)).toBe(false);
    expect(m0MinDueSettled(null, '2026-07-15', now)).toBe(false);
  });
});

describe('simulateVariablePayoff — m0MinSettled moves the forced minimum to month 1', () => {
  // Zero-surplus scenario (income == expenses, cash pinned at the floor) so the only payments
  // the sim can make are mandatory minimums — isolates the minimum-enforcement layer.
  const monthEvents = [
    { income: 1000, expenses: 1000 },
    { income: 1000, expenses: 1000 },
    { income: 1000, expenses: 1000 },
  ];

  it('settled card: no forced month-0 minimum, normal minimum from month 1', () => {
    const card = makeCard({
      id: 's', balance: 3000, apr: 20, m0MinSettled: true,
    });
    const sim = simulateVariablePayoff([card], 1000, 1000, 'avalanche', 0, 0, 3, monthEvents);
    expect(sim.perCardMinPayments.get('s')![0]).toBe(0);
    expect(sim.monthlyPayments.get('s')![0]).toBe(0);
    expect(sim.perCardMinPayments.get('s')![1]).toBeGreaterThan(0);
    expect(sim.monthlyPayments.get('s')![1]).toBeGreaterThan(0);
  });

  it('unsettled card (flag absent): month-0 minimum forced exactly as today', () => {
    const card = makeCard({ id: 'u', balance: 3000, apr: 20 });
    const sim = simulateVariablePayoff([card], 1000, 1000, 'avalanche', 0, 0, 3, monthEvents);
    expect(sim.perCardMinPayments.get('u')![0]).toBe(calcMinPayment(3000, 20));
    expect(sim.monthlyPayments.get('u')![0]).toBeGreaterThan(0);
  });

  it('settled card still receives optional surplus paydown in month 0', () => {
    const card = makeCard({ id: 's2', balance: 3000, apr: 20, m0MinSettled: true });
    const surplus = [
      { income: 2000, expenses: 1000 },
      { income: 2000, expenses: 1000 },
      { income: 2000, expenses: 1000 },
    ];
    const sim = simulateVariablePayoff([card], 2000, 1000, 'avalanche', 0, 0, 3, surplus);
    expect(sim.monthlyPayments.get('s2')![0]).toBeGreaterThan(0);
  });

  it('two cards, tight month: only the unsettled card is funded in month 0', () => {
    // Cash sits exactly at the floor — zero surplus, so no optional cascade extra can reach the
    // settled card; the only cash that moves is the unsettled card's enforced minimum (computed
    // on its post-interest balance, 3000 + one month of 20% APR interest = 3050).
    const settled = makeCard({ id: 'a', balance: 3000, apr: 25, m0MinSettled: true });
    const unsettled = makeCard({ id: 'b', balance: 3000, apr: 20, dueDay: 25 });
    const sim = simulateVariablePayoff([settled, unsettled], 1000, 1000, 'avalanche', 0, 0, 2, [
      { income: 1000, expenses: 1000 },
      { income: 1000, expenses: 1000 },
    ]);
    expect(sim.monthlyPayments.get('a')![0]).toBe(0);
    expect(sim.monthlyPayments.get('b')![0]).toBe(calcMinPayment(3050, 20));
  });
});

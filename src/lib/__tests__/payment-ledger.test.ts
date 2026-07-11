import { describe, it, expect } from 'vitest';
import { simulateVariablePayoff, buildPaymentLedger, type CardData } from '../credit-card-engine';

// .claude/plan/unify-cycling-model.md Stage 2 — the sim publishes an authoritative per-month
// payment ledger. These tests verify the ledger's internal identities against synthetic data,
// independent of the useCardProjection hook (no consumer reads paymentLedger yet).

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'card', name: 'Card', balance: 0, apr: 20, creditLimit: 20000,
    minPayment: 25, minPaymentIsManual: true, targetPayment: 25,
    monthlyNewPurchases: 0, monthlyRepayments: 0,
    color: '#000', paymentPreference: null, autopayFullBalance: false,
    dueDay: 1, statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}

const flatEvents = (n: number, income: number, expenses: number) =>
  Array.from({ length: n }, () => ({ income, expenses }));

describe('buildPaymentLedger', () => {
  it('perCard payments sum to total, and revolving + cycling == total, every month', () => {
    const a = makeCard({ id: 'a', balance: 4000, apr: 25 });
    const b = makeCard({ id: 'b', balance: 2000, apr: 15 });
    const sim = simulateVariablePayoff(
      [a, b], 1500, 1000, 'avalanche', 0, 0, 6, flatEvents(6, 2500, 1800),
    );
    const ledger = buildPaymentLedger(sim, [a, b], 6);
    expect(ledger).toHaveLength(6);
    for (const entry of ledger) {
      const perCardSum = entry.perCard.reduce((s, c) => s + c.payment, 0);
      expect(perCardSum).toBeCloseTo(entry.total, 6);
      expect(entry.revolving + entry.cycling).toBeCloseTo(entry.total, 6);
    }
  });

  it('total matches the sim\'s own monthlyPayments sum (allPaymentTotals identity)', () => {
    const a = makeCard({ id: 'a', balance: 3000, apr: 22 });
    const b = makeCard({ id: 'b', balance: 1000, apr: 18, monthlyNewPurchases: 50 });
    const sim = simulateVariablePayoff(
      [a, b], 1200, 800, 'snowball', 0, 0, 4, flatEvents(4, 2200, 1600),
    );
    const ledger = buildPaymentLedger(sim, [a, b], 4);
    for (let m = 0; m < 4; m++) {
      const expectedTotal = [a, b].reduce(
        (s, c) => s + (sim.monthlyPayments.get(c.id)?.[m] ?? 0), 0,
      );
      expect(ledger[m].total).toBeCloseTo(expectedTotal, 6);
    }
  });

  it('revolving classifies only cards with a nonzero start-of-month revolving balance (debtPaymentTotals identity)', () => {
    // 'a' starts with real debt (revolving); 'b' has no balance and only ever cycles new
    // purchases, so it should never contribute to the revolving bucket.
    const a = makeCard({ id: 'a', balance: 2500, apr: 24 });
    const b = makeCard({ id: 'b', balance: 0, apr: 19, paymentPreference: 'statement', monthlyNewPurchases: 100 });
    const sim = simulateVariablePayoff(
      [a, b], 1000, 1000, 'avalanche', 0, 0, 5, flatEvents(5, 2400, 1500),
    );
    const ledger = buildPaymentLedger(sim, [a, b], 5);
    for (let m = 0; m < 5; m++) {
      const startRevBalB = m === 0
        ? (sim.monthlyRevolvingBalances.get('b')?.[0] ?? 0)
        : (sim.monthlyRevolvingBalances.get('b')?.[m - 1] ?? 0);
      expect(startRevBalB).toBe(0);
      const bPayment = sim.monthlyPayments.get('b')?.[m] ?? 0;
      // b's payment must land entirely in cycling, never revolving.
      expect(ledger[m].cycling).toBeGreaterThanOrEqual(bPayment - 1e-6);
    }
  });

  it('a card paying off mid-projection stops contributing to revolving the month after payoff', () => {
    const a = makeCard({ id: 'a', balance: 400, apr: 20, minPayment: 400 });
    const sim = simulateVariablePayoff(
      [a], 2000, 1000, 'avalanche', 0, 0, 3, flatEvents(3, 3000, 1000),
    );
    const ledger = buildPaymentLedger(sim, [a], 3);
    expect(sim.monthlyBalances.get('a')![0]).toBe(0);
    // Month 1+ 'a' has no starting revolving balance, so its payments (if any) are cycling, not revolving.
    expect(ledger[1].revolving).toBe(0);
    expect(ledger[2].revolving).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { simulateVariablePayoff, CardData } from '../credit-card-engine';

// Regression for the real "off by pennies" bug found while reviewing account
// a72f416e-433a-4055-9ab0-9feae4e60edf's October figures: the per-card running balance and the
// overall cash total were rounded to cents only when pushed into a *display* array — the value
// actually carried into the next month's math was never rounded, letting floating-point residue
// (confirmed live: 1337.1300000000006) silently compound across the whole 36-month simulation.
// cardPurchasesPerMonth (a real per-month, per-card dollar figure derived from proportional/
// prorated calculations upstream) is one realistic source of a non-terminating decimal arriving
// at this function's input — reproduced directly here rather than guessing at the exact upstream
// formula.

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'card', name: 'Card', balance: 0, apr: 0, creditLimit: 5000,
    minPayment: 25, targetPayment: 25, monthlyNewPurchases: 0, monthlyRepayments: 0,
    color: '#000', paymentPreference: 'statement', autopayFullBalance: false,
    dueDay: 1, statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}

function assertAllExactCents(values: number[], label: string) {
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    expect(Math.round(v * 100), `${label}[${i}] = ${v} is not an exact cent value`).toBeCloseTo(v * 100, 6);
  }
}

describe('simulateVariablePayoff — balance/cash rounding', () => {
  it('a non-terminating-decimal cardPurchasesPerMonth value does not leave residue in monthlyBalances across months', () => {
    const card = makeCard({ id: 'x', name: 'X', balance: 4837.91, apr: 24.99, minPayment: 187, autopayFullBalance: false, paymentPreference: 'statement' });
    const monthEvents = Array.from({ length: 8 }, () => ({ income: 2200, expenses: 1900 }));
    // 350/3 = 116.66666666666667 — a realistic shape for a prorated monthly amount.
    const dirtyPurchase = 350 / 3;
    const cardPurchasesPerMonth = Array.from({ length: 8 }, () => ({ x: dirtyPurchase }));

    const sim = simulateVariablePayoff([card], 1300, 1000, 'avalanche', 2200, 1900, 8, monthEvents,
      undefined, cardPurchasesPerMonth);

    assertAllExactCents(sim.monthlyBalances.get('x')!, 'monthlyBalances[x]');
    assertAllExactCents(sim.monthlyRevolvingBalances.get('x')!, 'monthlyRevolvingBalances[x]');
    assertAllExactCents(sim.projectedCashByMonth, 'projectedCashByMonth');
  });

  it('the same dirty input across three cards with a proportional avalanche split stays exact-cent throughout', () => {
    const cardA = makeCard({ id: 'a', name: 'A', balance: 4837.91, apr: 24.99, minPayment: 187, autopayFullBalance: false, paymentPreference: 'statement' });
    const cardB = makeCard({ id: 'b', name: 'B', balance: 3122.47, apr: 19.49, minPayment: 99, autopayFullBalance: false, paymentPreference: 'full' });
    const cardC = makeCard({ id: 'c', name: 'C', balance: 1894.33, apr: 27.49, minPayment: 65, autopayFullBalance: false, paymentPreference: 'statement' });
    const monthEvents = Array.from({ length: 12 }, () => ({ income: 3173.37, expenses: 1841.59 }));
    const dirtyPurchase = 700 / 3;
    const cardPurchasesPerMonth = Array.from({ length: 12 }, () => ({ a: dirtyPurchase, b: dirtyPurchase / 2, c: 0 }));

    const sim = simulateVariablePayoff([cardA, cardB, cardC], 1734.18, 1000, 'avalanche', 3173.37, 1841.59, 12, monthEvents,
      undefined, cardPurchasesPerMonth);

    for (const card of [cardA, cardB, cardC]) {
      assertAllExactCents(sim.monthlyBalances.get(card.id)!, `monthlyBalances[${card.id}]`);
      assertAllExactCents(sim.monthlyRevolvingBalances.get(card.id)!, `monthlyRevolvingBalances[${card.id}]`);
    }
    assertAllExactCents(sim.projectedCashByMonth, 'projectedCashByMonth');
  });

  it('a dirty-decimal cycling-card shortfall does not leave residue in the backlog/interest arithmetic', () => {
    const cyc = makeCard({ id: 'cyc', name: 'Cyc', apr: 22.49, autopayFullBalance: true, paymentPreference: 'statement' });
    // Income too tight to cover the dirty purchase amount most months — forces a chronic
    // shortfall, so the backlog (and the interest charged on it) compounds the dirty decimal
    // across many months, exactly the shape that originally let residue accumulate undetected.
    const monthEvents = Array.from({ length: 10 }, () => ({ income: 1100, expenses: 1100 }));
    const dirtyPurchase = 350 / 3;
    const cardPurchasesPerMonth = Array.from({ length: 10 }, () => ({ cyc: dirtyPurchase }));

    const sim = simulateVariablePayoff([cyc], 1000, 1000, 'avalanche', 1100, 1100, 10, monthEvents,
      undefined, cardPurchasesPerMonth);

    expect(sim.monthlyCyclingBacklog.get('cyc')!.some(v => v > 0)).toBe(true); // confirms a shortfall actually occurred
    assertAllExactCents(sim.monthlyCyclingBacklog.get('cyc')!, 'monthlyCyclingBacklog[cyc]');
    assertAllExactCents(sim.monthlyBalances.get('cyc')!, 'monthlyBalances[cyc]');
    assertAllExactCents(sim.monthlyCyclingOwed.get('cyc')!, 'monthlyCyclingOwed[cyc]');
    assertAllExactCents(sim.monthlyCyclingInterest.get('cyc')!, 'monthlyCyclingInterest[cyc]');
    assertAllExactCents(sim.monthlyPayments.get('cyc')!, 'monthlyPayments[cyc]');
    assertAllExactCents(sim.projectedCashByMonth, 'projectedCashByMonth');
  });
});

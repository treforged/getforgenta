import { describe, it, expect } from 'vitest';
import { simulateVariablePayoff, projectCardVariable, CardData } from '../credit-card-engine';

// Regression test for two related bugs found while diagnosing why a cycling card's "Start"
// balance jumped between months with no visible cause: (1) a partial payment on a cycling
// card silently lost the grace period without ever charging interest on the unpaid amount,
// and (2) projectCardVariable's displayed startBalance/endBalance for a cycling row didn't
// reflect that true owed amount — it just echoed the payment, so a shortfall was invisible in
// the month it happened and only surfaced as an unexplained jump the following month.

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'card', name: 'Card', balance: 0, apr: 0, creditLimit: 5000,
    minPayment: 25, targetPayment: 25, monthlyNewPurchases: 0, monthlyRepayments: 0,
    color: '#000', paymentPreference: 'statement', autopayFullBalance: true,
    dueDay: 1, statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}

describe('simulateVariablePayoff / projectCardVariable — cycling shortfall interest', () => {
  it('charges interest on a carried-forward shortfall and surfaces the true owed amount in the display', () => {
    const cardA = makeCard({ id: 'cardA', name: 'Card A', apr: 24, monthlyNewPurchases: 800 });
    const cardB = makeCard({ id: 'cardB', name: 'Card B', apr: 12, monthlyNewPurchases: 300 });

    const monthEvents = [
      { income: 3000, expenses: 1500 }, // m0: nothing owed yet
      { income: 3000, expenses: 1500 }, // m1: ample cash, both fully paid
      { income: 500, expenses: 1500 },  // m2: tight month — pool can't cover both
      { income: 3000, expenses: 1500 }, // m3: ample cash again — catch-up
      { income: 3000, expenses: 1500 },
      { income: 3000, expenses: 1500 },
    ];

    const sim = simulateVariablePayoff(
      [cardA, cardB], 1000, 1000, 'avalanche', 3000, 1500, 6, monthEvents,
    );

    // Avalanche priority: Card A (24% APR) is paid first from the shared pool and gets its
    // full $800; Card B (12% APR) gets whatever's left and is short by $200.
    expect(sim.monthlyPayments.get('cardA')![2]).toBeCloseTo(800, 2);
    expect(sim.monthlyPayments.get('cardB')![2]).toBeCloseTo(100, 2);

    // No interest charged in the shortfall month itself — it accrues for the NEXT cycle.
    expect(sim.monthlyCyclingInterest.get('cardB')![2]).toBe(0);
    // The following month's bill includes interest on the $200 carried at 12%/12 = $2.
    expect(sim.monthlyCyclingInterest.get('cardB')![3]).toBeCloseTo(2, 2);
    // True owed entering month 3 = $200 unpaid + $300 new purchases + $2 interest = $502 —
    // more than what was actually paid in month 2 ($100), proving the shortfall is tracked.
    expect(sim.monthlyCyclingOwed.get('cardB')![3]).toBeCloseTo(502, 2);
    expect(sim.monthlyPayments.get('cardB')![3]).toBeCloseTo(502, 2);

    // Card A never shorted — no interest ever charged on it.
    expect(sim.monthlyCyclingInterest.get('cardA')!.every(v => v === 0)).toBe(true);

    const projB = projectCardVariable(
      cardB, sim.monthlyPayments.get('cardB')!, 6, true, undefined,
      sim.monthlyRevolvingBalances.get('cardB')!,
      sim.monthlyCyclingOwed.get('cardB')!, sim.monthlyCyclingInterest.get('cardB')!,
    );

    // Row 3 (1-indexed) = sim month 2, the shortfall month. Its endBalance must show the true
    // $502 owed entering next cycle, not just that month's own $300 new purchases — the bug
    // this test guards against.
    const shortfallRow = projB.months[2];
    expect(shortfallRow.endBalance).toBeCloseTo(502, 2);
    expect(shortfallRow.interest).toBe(0);

    // Row 4 = sim month 3, the catch-up month. Its startBalance must match the prior row's
    // endBalance exactly (no more unexplained jump) and show the $2 interest charged.
    const catchUpRow = projB.months[3];
    expect(catchUpRow.startBalance).toBeCloseTo(shortfallRow.endBalance, 2);
    expect(catchUpRow.interest).toBeCloseTo(2, 2);

    expect(projB.totalInterest).toBeGreaterThanOrEqual(2);
  });

  it('matches prior behavior when a cycling card is never shorted (no interest, display unchanged)', () => {
    const card = makeCard({ id: 'cardC', name: 'Card C', apr: 18, monthlyNewPurchases: 200 });
    const monthEvents = Array.from({ length: 6 }, () => ({ income: 3000, expenses: 1500 }));

    const sim = simulateVariablePayoff([card], 2000, 1000, 'avalanche', 3000, 1500, 6, monthEvents);

    expect(sim.monthlyCyclingInterest.get('cardC')!.every(v => v === 0)).toBe(true);

    const proj = projectCardVariable(
      card, sim.monthlyPayments.get('cardC')!, 6, true, undefined,
      sim.monthlyRevolvingBalances.get('cardC')!,
      sim.monthlyCyclingOwed.get('cardC')!, sim.monthlyCyclingInterest.get('cardC')!,
    );

    for (const row of proj.months) {
      expect(row.interest).toBe(0);
      // No shortfall ever occurs, so startBalance should equal that month's payment, and
      // endBalance should equal that month's own new purchases — identical to the old
      // payment-only formula.
      expect(row.startBalance).toBeCloseTo(row.payment, 2);
    }
  });
});

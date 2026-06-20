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

    // Proportional sharing: the tight month's pool is split between both cards in proportion to
    // what each owes (after each card's tiny minimum is guaranteed first), so neither card is
    // zeroed out outright — Card A (owes $800) gets the larger share, Card B (owes $300) gets
    // the smaller share, and BOTH fall a bit short rather than one absorbing the entire shortfall.
    expect(sim.monthlyPayments.get('cardA')![2]).toBeCloseTo(647.37, 2);
    expect(sim.monthlyPayments.get('cardB')![2]).toBeCloseTo(252.63, 2);

    // No interest charged in the shortfall month itself — it accrues for the NEXT cycle.
    expect(sim.monthlyCyclingInterest.get('cardB')![2]).toBe(0);
    // The following month's bill includes interest on Card B's ~$47.37 carried shortfall at 12%/12.
    expect(sim.monthlyCyclingInterest.get('cardB')![3]).toBeCloseTo(0.47, 2);
    // True owed entering month 3 = ~$47.37 unpaid + $300 new purchases + $0.47 interest = ~$347.84
    // — more than what was actually paid in month 2 ($252.63), proving the shortfall is tracked.
    expect(sim.monthlyCyclingOwed.get('cardB')![3]).toBeCloseTo(347.84, 2);
    expect(sim.monthlyPayments.get('cardB')![3]).toBeCloseTo(347.84, 2);

    // Card A is shorted too (proportional sharing, not winner-take-all) — it also carries
    // interest on its own smaller shortfall into the next cycle.
    expect(sim.monthlyCyclingInterest.get('cardA')![3]).toBeCloseTo(3.05, 2);

    const projB = projectCardVariable(
      cardB, sim.monthlyPayments.get('cardB')!, 6, true, undefined,
      sim.monthlyRevolvingBalances.get('cardB')!,
      sim.monthlyCyclingOwed.get('cardB')!, sim.monthlyCyclingInterest.get('cardB')!,
    );

    // Row 3 (1-indexed) = sim month 2, the shortfall month. Its endBalance must show the true
    // ~$347.84 owed entering next cycle, not just that month's own $300 new purchases — the bug
    // this test guards against.
    const shortfallRow = projB.months[2];
    expect(shortfallRow.endBalance).toBeCloseTo(347.84, 2);
    expect(shortfallRow.interest).toBe(0);

    // Row 4 = sim month 3, the catch-up month. Its startBalance must match the prior row's
    // endBalance exactly (no more unexplained jump) and show the interest charged.
    const catchUpRow = projB.months[3];
    expect(catchUpRow.startBalance).toBeCloseTo(shortfallRow.endBalance, 2);
    expect(catchUpRow.interest).toBeCloseTo(0.47, 2);
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

  it('shows continuity (not a $0 placeholder) on the month a revolving card transitions to cycling', () => {
    // Mirrors Prime Visa: a statement-preference card revolves normally for a couple of
    // months, then a big-surplus month pays it off completely and the engine flips it into
    // cycling mode mid-iteration (Step 6). monthlyCyclingOwed/monthlyCyclingInterest were
    // already pushed as 0 placeholders for that month back in Step 2, before the transition
    // was known — without the retroactive fix, the transition month's displayed "Start"
    // balance would show $0 instead of carrying the prior month's end balance forward.
    const card = makeCard({
      id: 'cardP', name: 'Card P', balance: 1000, apr: 12, monthlyNewPurchases: 100,
      minPayment: 50, autopayFullBalance: false,
    });
    const monthEvents = [
      { income: 600, expenses: 500 },  // m0: minimum only, still revolving
      { income: 600, expenses: 500 },  // m1: minimum only, still revolving
      { income: 2000, expenses: 500 }, // m2: big surplus — pays off fully, transitions
    ];

    const sim = simulateVariablePayoff([card], 600, 500, 'avalanche', 600, 500, 3, monthEvents);

    const m1EndBalance = sim.monthlyBalances.get('cardP')![1];
    expect(m1EndBalance).toBeGreaterThan(0); // still genuinely revolving after month 1

    // The transition month's retroactively-corrected "owed" must equal the PRIOR month's
    // end balance exactly — that's the continuity the bug broke.
    expect(sim.monthlyCyclingOwed.get('cardP')![2]).toBeCloseTo(m1EndBalance, 2);
    expect(sim.monthlyCyclingInterest.get('cardP')![2]).toBeGreaterThan(0);

    const proj = projectCardVariable(
      card, sim.monthlyPayments.get('cardP')!, 3, true, undefined,
      sim.monthlyRevolvingBalances.get('cardP')!,
      sim.monthlyCyclingOwed.get('cardP')!, sim.monthlyCyclingInterest.get('cardP')!,
    );

    const transitionRow = proj.months[2]; // 1-indexed row 3 = sim month index 2
    expect(transitionRow.startBalance).toBeCloseTo(m1EndBalance, 2);
    expect(transitionRow.startBalance).not.toBe(0);
    expect(transitionRow.interest).toBeGreaterThan(0);
  });
});

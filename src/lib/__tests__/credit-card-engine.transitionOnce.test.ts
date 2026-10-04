import { describe, it, expect } from 'vitest';
import { simulateVariablePayoff, projectCardVariable, type CardData } from '../credit-card-engine';

// THE REVOLVING -> CYCLING TRANSITION MONTH COUNTS EVERY DOLLAR ONCE (ask c2e84e6e, 2026-10-04).
//
// Two defects, both at the one month a card leaves revolving mode, both found on the demo fixture
// (card d7, month 7) while explaining a $205.71 conservation surplus in payment-pin-semantics:
//
//   1. INTEREST, TWICE. Step 6 pushed the month's real Step-3 interest into `monthlyInterest`, and
//      then, because the card had just reached $0, copied the SAME figure into
//      `monthlyCyclingInterest` so the cycling display row would reconcile. Any reader of both
//      series - which is what their names invite - counted it twice ($38.09 on d7, $8.80 on d8).
//   2. A PINNED PAYMENT'S PURCHASES, TWICE. A statement-preference card transitions when its
//      revolving carry is gone, and was seeded with this month's FULL purchases as next cycle's
//      statement. A pin that reaches past the carry into this month's purchases has already paid
//      part of them, so the next statement billed that part again ($167.62 on d7 under a $1,000 pin).
//      The non-statement path had this exact fix since 2026-09-17; the statement path never did.
//
// The identity below is the whole contract: over a horizon in which the card ends owing nothing,
//   dollars paid == starting balance + purchases + interest, to the cent,
// with interest read as monthlyInterest + monthlyCyclingInterest. Each half alone breaks it.

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'card', name: 'Card', balance: 0, apr: 24, creditLimit: 20000,
    minPayment: 25, minPaymentIsManual: true, targetPayment: 25,
    monthlyNewPurchases: 0, monthlyRepayments: 0,
    color: '#000', paymentPreference: 'statement', autopayFullBalance: false,
    dueDay: 1, statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}

// Positional args 9-20 (fundingAccountId … debtCashTargetByMonth); #10 is cardPurchasesPerMonth.
const run = (
  card: CardData, purchases: number[], overrides?: { [cardId: string]: Record<number, number> },
) => simulateVariablePayoff(
  [card], 0, 0, 'avalanche', 0, 0, purchases.length,
  Array.from({ length: purchases.length }, () => ({ income: 5000, expenses: 1000 })),
  undefined, purchases.map(p => ({ [card.id]: p })),
  undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
  overrides,
);

const sum = (a: number[]) => Math.round(a.reduce((s, v) => s + v, 0) * 100) / 100;

function ledger(sim: ReturnType<typeof run>, id: string) {
  const interest = (sim.monthlyInterest.get(id) ?? []).map((v, m) => v + (sim.monthlyCyclingInterest.get(id)?.[m] ?? 0));
  return { paid: sum(sim.monthlyPayments.get(id) ?? []), interest: sum(interest), perMonthInterest: interest };
}

// Purchases stop after month 3 and the card carries no baseline, so by month 9 it owes nothing and
// the identity can be asserted to the cent without guessing an end balance.
const PURCHASES = [0, 500, 500, 500, 0, 0, 0, 0, 0, 0];

describe('transition month — every dollar counted once', () => {
  it('CONTROL: the horizon really ends at zero, so the identity has nothing to hide behind', () => {
    const sim = run(makeCard({ balance: 1000 }), PURCHASES);
    const id = 'card';
    expect(sim.monthlyBalances.get(id)!.at(-1)).toBe(0);
    expect(sim.monthlyCyclingOwed.get(id)!.at(-1)).toBe(0);
    expect(sim.monthlyCyclingBacklog.get(id)!.at(-1) ?? 0).toBe(0);
  });

  it('reports the transition month\'s interest ONCE across monthlyInterest + monthlyCyclingInterest', () => {
    // Unpinned, flush with cash: month 0 pays the $1,000 carry plus its $20.00 of interest
    // (24% / 12 on $1,000) and the card transitions. That $20.00 is the only interest it ever pays.
    for (const pref of ['statement', null] as const) {
      const sim = run(makeCard({ balance: 1000, paymentPreference: pref }), PURCHASES);
      const { paid, interest, perMonthInterest } = ledger(sim, 'card');
      expect(perMonthInterest[0], `${pref}: month-0 interest`).toBeCloseTo(20, 2);
      expect(interest, `${pref}: horizon interest`).toBeCloseTo(20, 2);
      expect(paid, `${pref}: paid == balance + purchases + interest`).toBeCloseTo(1000 + 1500 + 20, 2);
    }
  });

  it('a pin that reaches into this month\'s purchases is not billed again on the next statement', () => {
    // m0 pin $300: 1000 + 20.00 interest - 300 = 720 carried.
    // m1 pin $900: 720 + 14.40 interest + 500 purchases = 1234.40 owed; the pin pays 165.60 of the
    //   month's purchases, so 334.40 is left - and that, not 500, is the next statement.
    const sim = run(makeCard({ balance: 1000 }), PURCHASES, { card: { 0: 300, 1: 900 } });
    const pays = sim.monthlyPayments.get('card')!;
    const { paid, interest, perMonthInterest } = ledger(sim, 'card');
    expect(pays[0]).toBeCloseTo(300, 2);
    expect(pays[1]).toBeCloseTo(900, 2);
    expect(perMonthInterest[1]).toBeCloseTo(14.4, 2);
    expect(sim.monthlyCyclingOwed.get('card')![2], 'month-2 statement').toBeCloseTo(334.4, 2);
    expect(interest).toBeCloseTo(34.4, 2);
    expect(paid, 'paid == balance + purchases + interest').toBeCloseTo(1000 + 1500 + 34.4, 2);
  });

  it('the displayed rows still reconcile and still show the transition interest once', () => {
    // The display half: the cycling row at the transition month must still carry the interest the
    // engine charged (so Start + purchases + interest - payment = End), now read from
    // monthlyInterest instead of a copy, and the rows' total interest must equal the engine's.
    for (const pref of ['statement', null] as const) {
      const card = makeCard({ balance: 1000, paymentPreference: pref, autopayFullBalance: pref === null });
      const sim = run(card, PURCHASES);
      const proj = projectCardVariable(
        card, sim.monthlyPayments.get('card')!, PURCHASES.length, true, PURCHASES,
        sim.monthlyRevolvingBalances.get('card')!, sim.monthlyCyclingOwed.get('card')!,
        sim.monthlyCyclingInterest.get('card')!, sim.monthlyBalances.get('card')!, sim.monthlyInterest.get('card')!,
      );
      expect(proj.months.length).toBeGreaterThan(0);
      expect(sum(proj.months.map(r => r.interest)), `${pref}: displayed interest`).toBeCloseTo(20, 2);
      for (const r of proj.months) {
        const residual = r.endBalance - (r.startBalance + r.newPurchases + r.interest - r.payment);
        expect(Math.abs(residual), `${pref} ${r.label}`).toBeLessThan(0.01);
      }
    }
  });
});

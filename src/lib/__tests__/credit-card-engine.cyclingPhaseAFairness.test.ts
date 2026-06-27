import { describe, it, expect } from 'vitest';
import { simulateVariablePayoff, CardData } from '../credit-card-engine';

// Regression for a real bug found while diagnosing why a live account's lower-minimum cycling
// card (Venture X, $25 minimum) kept getting starved to near-zero while a higher-minimum cycling
// card (Prime Visa, $231.15 minimum) absorbed almost the entire shared mandatory-statement pool —
// even in a month with plenty of cash above the floor for both.
//
// Root cause: Phase A of the pool split (guarantee every cycling card at least its own minimum)
// calls distributeProportionally with a needFn that returns each card's FULL target
// (min(minPayment, owed)) on every iteration, never subtracting what that card already received —
// unlike Phase B's needFn, which correctly subtracts paidSoFar. distributeProportionally's
// water-filling loop only excludes a card from `remaining` once its needFn drops to ~0, so a
// stale/constant needFn means NEITHER card is ever excluded, and the loop keeps re-running
// (bounded only by its `guard` counter) — re-feeding each card its full target every pass. The
// card with the bigger target compounds fastest (a fixed fraction of a fixed, larger number),
// consuming several multiples of its intended guarantee by the time `guard` cuts the loop off,
// crowding out Phase B's proportional-by-true-need split that was supposed to run with whatever
// pool Phase A left over.
//
// Fix: Phase A's needFn now subtracts paidSoFar too, so a card properly drops out of `remaining`
// the moment its guarantee is met — mirroring Phase B exactly.

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'card', name: 'Card', balance: 0, apr: 0, creditLimit: 10000,
    minPayment: 25, targetPayment: 25, monthlyNewPurchases: 0, monthlyRepayments: 0,
    color: '#000', paymentPreference: 'statement', autopayFullBalance: true,
    dueDay: 1, statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}

describe('simulateVariablePayoff — Phase A fairness between cycling cards with different minimums', () => {
  it('splits a tight shared pool close to proportional-by-need, not winner-take-most for the higher-minimum card', () => {
    // Mirrors the real account: a high-minimum cycling card (Prime Visa-like) and a low-minimum
    // one (Venture X-like) both owe their full monthly statement, but the shared pool that month
    // can't cover both in full.
    const cardBig = makeCard({ id: 'big', name: 'Big', apr: 27, minPayment: 200, monthlyNewPurchases: 700 });
    const cardSmall = makeCard({ id: 'small', name: 'Small', apr: 15, minPayment: 20, monthlyNewPurchases: 300 });

    const monthEvents = [
      { income: 3000, expenses: 1500 }, // m0: nothing owed yet (month0 purchases not yet due)
      { income: 3000, expenses: 1500 }, // m1: ample cash, both fully paid
      { income: 0, expenses: 1500 },    // m2: tight — pool can't cover both cards' full statement
    ];

    const sim = simulateVariablePayoff([cardBig, cardSmall], 1000, 1000, 'avalanche', 3000, 1500, 3, monthEvents);

    const bigPay = sim.monthlyPayments.get('big')![2];
    const smallPay = sim.monthlyPayments.get('small')![2];

    // Both cards owe their full statement this cycle ($700 / $300) — confirms the scenario
    // actually reproduces a tight shared pool, not one card already satisfied.
    expect(bigPay).toBeLessThan(700);
    expect(smallPay).toBeLessThan(300);

    // The low-minimum card must receive a meaningful share of the pool, not be starved down to
    // near its bare $20 minimum while the high-minimum card absorbs almost everything — the
    // literal bug this test guards against (confirmed live: a $669 pool meant to split ~$479/$190
    // between Prime Visa and Venture X landed $604/$65 under the old code — Venture X getting
    // barely more than its bare minimum despite a real, fundable need).
    expect(smallPay).toBeGreaterThan(100);

    // Verified exact split for this fixture against the fixed implementation.
    expect(bigPay).toBeCloseTo(404.49, 2);
    expect(smallPay).toBeCloseTo(145.51, 2);
  });
});

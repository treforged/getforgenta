import { describe, it, expect } from 'vitest';
import { simulateVariablePayoff, CardData } from '../credit-card-engine';

// Regression for the real double-reservation bug behind a user-reported symptom: a cycling card
// (Venture X) getting shorted while a revolving card (Discover) sat at its minimum, even in
// months where total cash covered both mandatory obligations combined. Root cause: the augmented
// floor (getAugmentedMinSafeCash) already reserves revolving cards' minimums for cards with a
// dueDay, but simulateVariablePayoff's own reservedForRevolving reserved the same dollars again
// before sizing the cycling-card payoff pool. ccMinAlreadyInFloorByMonth lets a caller tell this
// function how much of the active floor already covers that reservation, so it isn't double-counted.
//
// An earlier, disproven attempt at this fix ("combined mandatory pool" via
// Math.min(T, R+C)/Math.max(0,...) algebra) was verified to be an exact identity to the original
// formula for every T/R/C — it changed nothing. This fix instead subtracts an externally-supplied
// ccMinAlreadyInFloor from reservedForRevolving directly, which is NOT an identity (verified below).
//
// Cycling payments are billed one cycle in arrears (a month's new purchases are paid the
// FOLLOWING month) — every scenario here needs at least 2 months so the cycling card actually
// owes something to be shorted or fully paid.

function makeCard(overrides: Partial<CardData>): CardData {
  return {
    id: 'card', name: 'Card', balance: 0, apr: 0, creditLimit: 5000,
    minPayment: 25, targetPayment: 25, monthlyNewPurchases: 0, monthlyRepayments: 0,
    color: '#000', paymentPreference: 'statement', autopayFullBalance: true,
    dueDay: 1, statementBalancePhase: false, statementBalance: null,
    ...overrides,
  };
}

// Positional params after monthEvents (arg 8): fundingAccountId, cardPurchasesPerMonth,
// month0RemainingIncome, month0RemainingExpenses, oneTimeByMonth, month0SafeFloor,
// maxDebtPaymentByMonth, cashFloorByMonth — 8 params — THEN ccMinAlreadyInFloorByMonth (arg 17).
const SKIP8 = [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined] as const;

describe('simulateVariablePayoff — ccMinAlreadyInFloorByMonth (double-reservation fix)', () => {
  it('omitting the param is byte-identical to today\'s behavior — proves the bootstrap pass (bare floor) is unaffected', () => {
    const revolving = makeCard({ id: 'rev', name: 'Revolving', balance: 4000, apr: 20, minPayment: 150, autopayFullBalance: false });
    const cycling = makeCard({ id: 'cyc', name: 'Cycling', apr: 15, monthlyNewPurchases: 400 });
    const monthEvents = [
      { income: 1000, expenses: 1000 },
      { income: 1600, expenses: 1000 },
    ];

    const withoutParam = simulateVariablePayoff([revolving, cycling], 1000, 1000, 'avalanche', 0, 0, 2, monthEvents);
    const withZeroArray = simulateVariablePayoff([revolving, cycling], 1000, 1000, 'avalanche', 0, 0, 2, monthEvents,
      ...SKIP8, [0, 0]);

    expect(withoutParam.monthlyPayments.get('cyc')).toEqual(withZeroArray.monthlyPayments.get('cyc'));
    expect(withoutParam.monthlyPayments.get('rev')).toEqual(withZeroArray.monthlyPayments.get('rev'));
  });

  it('cycling gets its full obligation once ccMinAlreadyInFloor covers the double-reserved amount, in a month where the old formula would have shorted it', () => {
    const revolving = makeCard({ id: 'rev', name: 'Revolving', balance: 4000, apr: 20, minPayment: 150, autopayFullBalance: false });
    const cycling = makeCard({ id: 'cyc', name: 'Cycling', apr: 15, monthlyNewPurchases: 400 });
    const monthEvents = [
      { income: 1000, expenses: 1000 }, // month0: net 0, nothing owed by cycling yet
      { income: 1600, expenses: 1000 }, // month1: month0's $400 purchase is now due
    ];
    const liquidCash = 1000;

    const old = simulateVariablePayoff([revolving, cycling], liquidCash, 1000, 'avalanche', 0, 0, 2, monthEvents);
    expect(old.monthlyPayments.get('cyc')![1]).toBeCloseTo(300, 2); // confirms the old formula really does short it here

    const fixed = simulateVariablePayoff([revolving, cycling], liquidCash, 1000, 'avalanche', 0, 0, 2, monthEvents,
      ...SKIP8, [0, 150]);
    expect(fixed.monthlyPayments.get('cyc')![1]).toBeCloseTo(400, 2); // no longer shorted
    expect(fixed.monthlyPayments.get('rev')![1]).toBeGreaterThanOrEqual(150); // revolving's minimum still covered
  });

  it('a genuine shortfall (not enough for both, even accounting for F) still shorts cycling and carries interest forward — unchanged from today', () => {
    const revolving = makeCard({ id: 'rev', name: 'Revolving', balance: 4000, apr: 20, minPayment: 150, autopayFullBalance: false });
    const cycling = makeCard({ id: 'cyc', name: 'Cycling', apr: 12, monthlyNewPurchases: 400 });
    const monthEvents = [
      { income: 1000, expenses: 1000 },
      { income: 1350, expenses: 1000 }, // tight even with F maxed: cash above floor (~200) < $400 owed
      { income: 3000, expenses: 1000 }, // catch-up month
    ];
    const liquidCash = 1000;

    const fixed = simulateVariablePayoff([revolving, cycling], liquidCash, 1000, 'avalanche', 0, 0, 3, monthEvents,
      ...SKIP8, [0, 150, 0]);

    expect(fixed.monthlyPayments.get('cyc')![1]).toBeLessThan(400); // genuinely shorted
    expect(fixed.monthlyPayments.get('rev')![1]).toBeGreaterThanOrEqual(150); // revolving's own minimum still protected first
    expect(fixed.monthlyCyclingInterest.get('cyc')![2]).toBeGreaterThan(0); // shortfall carries interest into next cycle, as today
  });

  it('a large one-time cycling purchase still cannot drain revolving below its minimum — the original protective purpose of reservedForRevolving is preserved', () => {
    const revolving = makeCard({ id: 'rev', name: 'Revolving', balance: 4000, apr: 20, minPayment: 150, autopayFullBalance: false });
    const cycling = makeCard({ id: 'cyc', name: 'Cycling', apr: 10, monthlyNewPurchases: 1800 });
    const monthEvents = [
      { income: 1000, expenses: 1000 },
      { income: 1300, expenses: 1000 }, // far short of revolving's min + cycling's $1800, even with F
    ];
    const liquidCash = 1000;

    const fixed = simulateVariablePayoff([revolving, cycling], liquidCash, 1000, 'avalanche', 0, 0, 2, monthEvents,
      ...SKIP8, [0, 150]);

    expect(fixed.monthlyPayments.get('rev')![1]).toBeGreaterThanOrEqual(150);
    expect(fixed.monthlyPayments.get('cyc')![1]).toBeLessThan(1800); // cycling absorbs the shortfall, not revolving
  });
});

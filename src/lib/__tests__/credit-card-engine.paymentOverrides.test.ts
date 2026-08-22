import { describe, it, expect } from 'vitest';
import { simulateVariablePayoff, type CardData } from '../credit-card-engine';
import { FLOOR_CUSHION_DOLLARS } from '../floor-protection';

// Q1 override-rebalance — paymentOverridesByMonth (positional param #21).
//
// paymentOverridesByMonth[cardId][monthIdx] pins that card's TOTAL payment for that month.
// The engine deducts the pinned spend from the month's pools BEFORE Step 2 (cycling mandatory
// pool) and Step 5 (revolving cascade) size themselves, and excludes the pinned card from
// normal allocation in both — so the OTHER cards rebalance around the pin under the normal
// strategy/minimum/floor rules.
//
// Invariants:
//   - param absent / empty → byte-identical behavior (deep-equal regression guard)
//   - freed cash from a LOWER pin flows to the next card by strategy; monthly total conserved
//   - a HIGHER pin shrinks the others but never below their contract minimums
//   - the pin is clamped at what the card actually owes — excess is never spent
//   - months before an overridden month are identical to a legacy run
//   - pinning below the contract minimum is allowed (explicit user command)

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

// Positional args 9-20 (fundingAccountId … debtCashTargetByMonth) unused by these scenarios.
const PAD = [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined] as const;

const flatEvents = (n: number, income: number, expenses: number) =>
  Array.from({ length: n }, () => ({ income, expenses }));

const totalPaid = (sim: ReturnType<typeof simulateVariablePayoff>, m: number) =>
  [...sim.monthlyPayments.values()].reduce((s, arr) => s + (arr[m] ?? 0), 0);

// Every fixture below is built as "a $1,000/mo natural surplus above the floor", and the engine
// deploys FLOOR_CUSHION_DOLLARS less than that. Since 2026-08-21 Step 5 drains EVERY month,
// month 0 included, to floor + cushion instead of to the floor exactly (step5Floor in
// credit-card-engine.ts). Month 0 needs it most, being the only month whose payment is later
// quantised to whole dollars against a cent-exact cap. None of the rebalancing behaviour these
// tests exist to pin changed; only the size of the pool being rebalanced did. Writing that as an
// expression rather than re-pinned literals keeps each comment's arithmetic checkable by eye and
// keeps the fixtures honest if the cushion is ever retuned.
const afterCushion = (uncushioned: number) => uncushioned - FLOOR_CUSHION_DOLLARS;

describe('simulateVariablePayoff — paymentOverridesByMonth (param #21)', () => {
  // Shared fixture: 1000/mo natural surplus above the floor.
  // Natural avalanche month 0: hi gets min + all surplus, lo gets its min.
  const hiLo = () => [
    makeCard({ id: 'hi', balance: 3000, apr: 28, minPayment: 25 }),
    makeCard({ id: 'lo', balance: 3000, apr: 12, minPayment: 25 }),
  ];
  const runHiLo = (months: number, overrides?: { [cardId: string]: Record<number, number> }) =>
    simulateVariablePayoff(
      hiLo(), 1000, 1000, 'avalanche', 0, 0, months, flatEvents(months, 2000, 1000),
      ...PAD, overrides,
    );

  it('pin LOWER than natural → the freed cash flows to the next card by strategy; total conserved', () => {
    const base = runHiLo(1);
    expect(base.monthlyPayments.get('hi')![0]).toBeCloseTo(afterCushion(975), 2);
    expect(base.monthlyPayments.get('lo')![0]).toBeCloseTo(25, 2);

    const sim = runHiLo(1, { hi: { 0: 100 } });
    expect(sim.monthlyPayments.get('hi')![0]).toBeCloseTo(100, 2);
    expect(sim.monthlyPayments.get('lo')![0]).toBeCloseTo(afterCushion(900), 2); // min 25 + freed 873
    expect(totalPaid(sim, 0)).toBeCloseTo(totalPaid(base, 0), 2);  // monthly total conserved
    expect(sim.cashFloorBreaches).toEqual([]);
    expect(sim.projectedCashByMonth[0]).toBeGreaterThanOrEqual(1000 - 0.01); // floor intact
  });

  it('pin HIGHER than natural → other cards shrink but never below their contract minimums', () => {
    const sim = runHiLo(1, { lo: { 0: 800 } });
    expect(sim.monthlyPayments.get('lo')![0]).toBeCloseTo(800, 2);
    expect(sim.monthlyPayments.get('hi')![0]).toBeCloseTo(afterCushion(200), 2); // shrunk, still ≥ its 25 min
    expect(sim.monthlyPayments.get('hi')![0]).toBeGreaterThanOrEqual(25);
    expect(totalPaid(sim, 0)).toBeCloseTo(afterCushion(1000), 2); // pool bounded by cash above floor
    expect(sim.cashFloorBreaches).toEqual([]);
  });

  it('pin below the contract minimum is honored exactly (explicit user command)', () => {
    const cards = [
      makeCard({ id: 'a', balance: 3000, apr: 28, minPayment: 200 }),
      makeCard({ id: 'b', balance: 3000, apr: 12, minPayment: 25 }),
    ];
    const sim = simulateVariablePayoff(
      cards, 1000, 1000, 'avalanche', 0, 0, 1, flatEvents(1, 2000, 1000),
      ...PAD, { a: { 0: 5 } },
    );
    expect(sim.monthlyPayments.get('a')![0]).toBeCloseTo(5, 2); // no min-enforcement backstop
    expect(sim.monthlyPayments.get('b')![0]).toBeCloseTo(afterCushion(995), 2);
  });

  it('clamp at owed: a pin above the full balance pays it off and spends nothing extra', () => {
    const cards = [
      makeCard({ id: 'a', balance: 500, apr: 24 }),
      makeCard({ id: 'b', balance: 3000, apr: 12 }),
    ];
    const sim = simulateVariablePayoff(
      cards, 5000, 1000, 'avalanche', 0, 0, 1, flatEvents(1, 2000, 1000),
      ...PAD, { a: { 0: 99999 } },
    );
    const paidA = sim.monthlyPayments.get('a')![0];
    expect(paidA).toBeGreaterThanOrEqual(500);
    expect(paidA).toBeLessThanOrEqual(500 * 1.02); // balance + one month's interest at most
    expect(sim.monthlyBalances.get('a')![0]).toBe(0);
  });

  it('override on a later month → months before it are identical to a legacy run', () => {
    const base = runHiLo(4);
    const sim = runHiLo(4, { hi: { 2: 50 } });
    for (const id of ['hi', 'lo']) {
      for (let m = 0; m < 2; m++) {
        expect(sim.monthlyPayments.get(id)![m]).toBe(base.monthlyPayments.get(id)![m]);
        expect(sim.monthlyBalances.get(id)![m]).toBe(base.monthlyBalances.get(id)![m]);
      }
    }
    expect(sim.projectedCashByMonth[0]).toBe(base.projectedCashByMonth[0]);
    expect(sim.projectedCashByMonth[1]).toBe(base.projectedCashByMonth[1]);
    // Month 2 reflects the pin; later months follow from the resulting balances.
    expect(sim.monthlyPayments.get('hi')![2]).toBeCloseTo(50, 2);
    expect(sim.monthlyPayments.get('lo')![2]).toBeGreaterThan(base.monthlyPayments.get('lo')![2]);
  });

  it('avalanche: freed cash goes to the next-highest APR, not the lowest', () => {
    const cards = [
      makeCard({ id: 'hi', balance: 3000, apr: 28 }),
      makeCard({ id: 'mid', balance: 3000, apr: 20 }),
      makeCard({ id: 'lo', balance: 3000, apr: 12 }),
    ];
    const sim = simulateVariablePayoff(
      cards, 1000, 1000, 'avalanche', 0, 0, 1, flatEvents(1, 2000, 1000),
      ...PAD, { hi: { 0: 50 } },
    );
    expect(sim.monthlyPayments.get('hi')![0]).toBeCloseTo(50, 2);
    expect(sim.monthlyPayments.get('mid')![0]).toBeCloseTo(afterCushion(925), 2); // min 25 + freed 898
    expect(sim.monthlyPayments.get('lo')![0]).toBeCloseTo(25, 2);   // min only
  });

  it('snowball: freed cash goes to the next-smallest balance', () => {
    const cards = [
      makeCard({ id: 'small', balance: 800, apr: 12 }),
      makeCard({ id: 'mid', balance: 2000, apr: 20 }),
      makeCard({ id: 'big', balance: 5000, apr: 28 }),
    ];
    const sim = simulateVariablePayoff(
      cards, 1000, 1000, 'snowball', 0, 0, 1, flatEvents(1, 2000, 1000),
      ...PAD, { small: { 0: 25 } },
    );
    expect(sim.monthlyPayments.get('small')![0]).toBeCloseTo(25, 2);
    expect(sim.monthlyPayments.get('mid')![0]).toBeCloseTo(afterCushion(950), 2); // next smallest gets the surplus
    expect(sim.monthlyPayments.get('big')![0]).toBeCloseTo(25, 2);
  });

  it('regression guard: omitted, explicit-undefined, and empty-object params are all deep-equal', () => {
    const run = (overrides?: { [cardId: string]: Record<number, number> }) =>
      simulateVariablePayoff(
        hiLo(), 1500, 1000, 'avalanche', 0, 0, 6, flatEvents(6, 2500, 1800),
        ...PAD, overrides,
      );
    const base = simulateVariablePayoff(
      hiLo(), 1500, 1000, 'avalanche', 0, 0, 6, flatEvents(6, 2500, 1800),
    );
    for (const sim of [run(undefined), run({})]) {
      for (const id of ['hi', 'lo']) {
        expect(sim.monthlyPayments.get(id)).toEqual(base.monthlyPayments.get(id));
        expect(sim.monthlyBalances.get(id)).toEqual(base.monthlyBalances.get(id));
        expect(sim.monthlyRevolvingBalances.get(id)).toEqual(base.monthlyRevolvingBalances.get(id));
        expect(sim.monthlyInterest.get(id)).toEqual(base.monthlyInterest.get(id));
        expect(sim.monthlyDebtCashPayment.get(id)).toEqual(base.monthlyDebtCashPayment.get(id));
      }
      expect(sim.projectedCashByMonth).toEqual(base.projectedCashByMonth);
      expect(sim.projectedPayoffMonths).toBe(base.projectedPayoffMonths);
      expect(sim.flags).toEqual(base.flags);
    }
  });

  it('reconciliation: pinned and rebalanced rows both satisfy End = Start + interest − payment', () => {
    const sim = runHiLo(3, { hi: { 1: 150 } });
    for (const id of ['hi', 'lo']) {
      let start = 3000;
      for (let m = 0; m < 3; m++) {
        const interest = sim.monthlyInterest.get(id)![m];
        const pay = sim.monthlyPayments.get(id)![m];
        const end = sim.monthlyBalances.get(id)![m];
        const walked = Math.max(0, start + interest - pay);
        expect(end).toBeCloseTo(walked < 1 ? 0 : walked, 1);
        start = end;
      }
    }
  });
});

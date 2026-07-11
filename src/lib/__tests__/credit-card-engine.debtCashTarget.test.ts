import { describe, it, expect } from 'vitest';
import { simulateVariablePayoff, type CardData } from '../credit-card-engine';

// Phase 2 Option C convergence — debtCashTargetByMonth (positional param #20).
//
// When provided, the target REPLACES the sim's own revolving-cascade cash pool for that month:
// the sim allocates exactly min(max(target, minimums), owed) of revolving debt cash through its
// normal avalanche/snowball per-card cascade. This makes the sim the per-card ALLOCATOR of the
// forecast engine's authoritative monthly revolving debt cash (revolvingPayment + step-3
// surplus) — covering BOTH clamp months (target below the sim's own surplus) AND surplus months
// (target above it; maxDebtPaymentByMonth alone can't do those since it is only a cap).
//
// Invariants:
//   - param absent → byte-identical behavior (all existing callers unaffected)
//   - per-card contract minimums always win over a lower target (2026-06-19 lesson:
//     floor-forced months must never produce min-payment violations)
//   - allocation is capped at what is actually owed — excess target cash is never spent
//   - cycling-card mandatory pool (Step 2) is untouched; the target governs Step 5 only

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

// Positional args 9-19 (fundingAccountId … upfrontPayByMonth) unused by these scenarios.
const PAD = [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined] as const;

const flatEvents = (n: number, income: number, expenses: number) =>
  Array.from({ length: n }, () => ({ income, expenses }));

const totalPaid = (sim: ReturnType<typeof simulateVariablePayoff>, m: number) =>
  [...sim.monthlyPayments.values()].reduce((s, arr) => s + (arr[m] ?? 0), 0);

describe('simulateVariablePayoff — debtCashTargetByMonth (param #20)', () => {
  it('clamp month: target below the sim\'s own surplus → exactly the target is paid', () => {
    const card = makeCard({ id: 'a', balance: 5000 });
    // 1000/mo natural surplus above the floor; target only 100.
    const sim = simulateVariablePayoff(
      [card], 1000, 1000, 'avalanche', 0, 0, 3, flatEvents(3, 2000, 1000),
      ...PAD, [100, 100, 100],
    );
    expect(totalPaid(sim, 0)).toBeCloseTo(100, 2);
    expect(totalPaid(sim, 1)).toBeCloseTo(100, 2);
    expect(totalPaid(sim, 2)).toBeCloseTo(100, 2);
  });

  it('surplus month: target ABOVE the sim\'s own available cash is still paid in full', () => {
    const card = makeCard({ id: 'a', balance: 5000 });
    // Zero natural surplus (income == expenses, cash pinned at floor) — the sim on its own
    // could only pay the minimum. The engine says 800/mo of real cash exists: pay it.
    const sim = simulateVariablePayoff(
      [card], 1000, 1000, 'avalanche', 0, 0, 3, flatEvents(3, 1000, 1000),
      ...PAD, [800, 800, 800],
    );
    expect(totalPaid(sim, 0)).toBeCloseTo(800, 2);
    expect(totalPaid(sim, 1)).toBeCloseTo(800, 2);
  });

  it('minimum invariant: target below the contract minimum → minimum is paid, not the target', () => {
    const card = makeCard({ id: 'a', balance: 5000, minPayment: 200 });
    const sim = simulateVariablePayoff(
      [card], 1000, 1000, 'avalanche', 0, 0, 2, flatEvents(2, 2000, 1000),
      ...PAD, [50, 50],
    );
    expect(totalPaid(sim, 0)).toBeCloseTo(200, 2);
    expect(totalPaid(sim, 1)).toBeCloseTo(200, 2);
  });

  it('cap at owed: target above the remaining balance pays it off and spends nothing extra', () => {
    const card = makeCard({ id: 'a', balance: 500 });
    const sim = simulateVariablePayoff(
      [card], 5000, 1000, 'avalanche', 0, 0, 2, flatEvents(2, 2000, 1000),
      ...PAD, [5000, 5000],
    );
    // Month 0 pays off the whole balance (+ this cycle's interest at most), nothing more.
    const paid0 = totalPaid(sim, 0);
    expect(paid0).toBeGreaterThanOrEqual(500);
    expect(paid0).toBeLessThanOrEqual(500 * 1.02);
    expect(sim.monthlyBalances.get('a')![0]).toBe(0);
    expect(totalPaid(sim, 1)).toBe(0);
  });

  it('per-card cascade: avalanche priority still routes the target to the highest APR first', () => {
    const hi = makeCard({ id: 'hi', balance: 3000, apr: 28, minPayment: 25 });
    const lo = makeCard({ id: 'lo', balance: 3000, apr: 12, minPayment: 25 });
    const sim = simulateVariablePayoff(
      [hi, lo], 1000, 1000, 'avalanche', 0, 0, 1, flatEvents(1, 2000, 1000),
      ...PAD, [500],
    );
    expect(totalPaid(sim, 0)).toBeCloseTo(500, 2);
    expect(sim.monthlyPayments.get('lo')![0]).toBeCloseTo(25, 2); // min only
    expect(sim.monthlyPayments.get('hi')![0]).toBeCloseTo(475, 2); // min + all surplus
  });

  it('fixed point: feeding the sim\'s own natural monthly totals back as the target reproduces them', () => {
    const a = makeCard({ id: 'a', balance: 4000, apr: 25 });
    const b = makeCard({ id: 'b', balance: 2000, apr: 15 });
    const base = simulateVariablePayoff(
      [a, b], 1500, 1000, 'avalanche', 0, 0, 6, flatEvents(6, 2500, 1800),
    );
    const naturalTotals = Array.from({ length: 6 }, (_, m) => totalPaid(base, m));
    const replay = simulateVariablePayoff(
      [a, b], 1500, 1000, 'avalanche', 0, 0, 6, flatEvents(6, 2500, 1800),
      ...PAD, naturalTotals,
    );
    for (let m = 0; m < 6; m++) {
      expect(replay.monthlyPayments.get('a')![m]).toBeCloseTo(base.monthlyPayments.get('a')![m], 2);
      expect(replay.monthlyPayments.get('b')![m]).toBeCloseTo(base.monthlyPayments.get('b')![m], 2);
      expect(replay.monthlyBalances.get('a')![m]).toBeCloseTo(base.monthlyBalances.get('a')![m], 2);
      expect(replay.monthlyBalances.get('b')![m]).toBeCloseTo(base.monthlyBalances.get('b')![m], 2);
    }
  });

  it('param absent → byte-identical to an explicit undefined (no behavior change for existing callers)', () => {
    const card = makeCard({ id: 'a', balance: 3000 });
    const withoutParam = simulateVariablePayoff(
      [card], 1000, 1000, 'avalanche', 0, 0, 3, flatEvents(3, 2000, 1500),
    );
    const withUndefined = simulateVariablePayoff(
      [card], 1000, 1000, 'avalanche', 0, 0, 3, flatEvents(3, 2000, 1500),
      ...PAD, undefined,
    );
    expect(withUndefined.monthlyPayments.get('a')).toEqual(withoutParam.monthlyPayments.get('a'));
    expect(withUndefined.monthlyBalances.get('a')).toEqual(withoutParam.monthlyBalances.get('a'));
    expect(withUndefined.projectedCashByMonth).toEqual(withoutParam.projectedCashByMonth);
  });
});

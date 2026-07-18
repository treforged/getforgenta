// Q10 — firstRevolvingPayoffMonth dust tolerance.
//
// The convergence loop's whole-dollar debtCashTargetByMonth can leave a card's payoff
// payment cents short (live: Prime Visa held $0.04 from m12 onward, forever). The sim
// state is economically settled — grace held, zero interest — but the payoff-month
// reducers treated any balance > $0 as live debt, nulling simRevolvingPayoffMonth /
// forecastRevolvingPayoffMonth and suppressing the CC Debt Free milestone. Sub-dollar
// remainders must count as paid, matching the engine's <$1 dust convention.
import { describe, it, expect } from 'vitest';
import { firstRevolvingPayoffMonth, REVOLVING_DUST_DOLLARS } from '@/lib/revolving-payoff';

const mapOf = (entries: Record<string, number[]>): Map<string, number[]> =>
  new Map(Object.entries(entries));

describe('firstRevolvingPayoffMonth', () => {
  it('finds the first exact-zero month (baseline behavior unchanged)', () => {
    const bals = mapOf({ a: [500, 250, 0, 0], b: [100, 0, 0, 0] });
    expect(firstRevolvingPayoffMonth(bals, ['a', 'b'], 4)).toBe(3);
  });

  it('treats persistent sub-dollar dust as paid off (Q10 live shape)', () => {
    // Prime Visa shape: pays down, then $0.04 forever from m2.
    const bals = mapOf({ pv: [1200, 400, 0.04, 0.04], other: [300, 0, 0, 0] });
    expect(firstRevolvingPayoffMonth(bals, ['pv', 'other'], 4)).toBe(3);
  });

  it('does NOT write off a remainder at or above the dust threshold', () => {
    const bals = mapOf({ a: [500, REVOLVING_DUST_DOLLARS, REVOLVING_DUST_DOLLARS] });
    expect(firstRevolvingPayoffMonth(bals, ['a'], 3)).toBeNull();
  });

  it('sums dust across cards against a single threshold', () => {
    // 0.60 + 0.60 = 1.20 ≥ $1 → still live; 0.30 + 0.30 = 0.60 → paid.
    const live = mapOf({ a: [10, 0.6, 0.6], b: [10, 0.6, 0.6] });
    expect(firstRevolvingPayoffMonth(live, ['a', 'b'], 3)).toBeNull();
    const dust = mapOf({ a: [10, 0.3, 0.3], b: [10, 0.3, 0.3] });
    expect(firstRevolvingPayoffMonth(dust, ['a', 'b'], 3)).toBe(2);
  });

  it('returns null when no card starts with revolving debt', () => {
    const bals = mapOf({ a: [0, 0], b: [0, 0] });
    expect(firstRevolvingPayoffMonth(bals, ['a', 'b'], 2)).toBeNull();
  });

  it('clamps negative balances to zero like the original reducers', () => {
    const bals = mapOf({ a: [500, -2, -2] });
    expect(firstRevolvingPayoffMonth(bals, ['a'], 3)).toBe(2);
  });
});

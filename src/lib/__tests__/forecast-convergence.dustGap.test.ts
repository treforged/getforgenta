import { describe, it, expect } from 'vitest';
import type { CardProjectionResult } from '@/hooks/useCardProjection';
import type { ForecastInputs, ForecastResult } from '@/lib/forecast-engine';
import { runDebtCashConvergence } from '@/lib/forecast-convergence';

/**
 * The convergence gap is measured only over months that still carry revolving
 * debt (2026-08-26). These pin the two halves of that rule, and the first one
 * is the one that matters: an empty measurement set must never be read as a
 * gap of zero, because this loop reads a zero gap as CONVERGED and would then
 * publish a plan nobody had actually solved.
 *
 * Everything here runs against a stub engine. The real forecast is not
 * involved: what is under test is which months the loop LOOKS at, not what the
 * engine computes for them.
 */

/** A row carrying only the three fields the convergence loop reads off one. */
const row = (debtPayment: number) => ({ debtPayment, revolvingDebtCash: 0, endingCash: 0 });

/** A projection carrying only `data`, which is all the loop touches. */
const proj = (payments: readonly number[]) =>
  ({ data: payments.map(row) }) as unknown as ForecastResult;

/**
 * The smallest `base` the loop needs. Cast once, here, because supplying a real
 * `CardProjectionResult` would mean building a whole card projection to
 * exercise four fields: `monthlyRevolvingBalances`, `manualIsbPins` (absent, so
 * the loop's `?? []` runs), `maxDebtPaymentByMonth`, and the resim closure.
 *
 * `resimulateWithDebtCash` returns the base itself so the revolving balances
 * stay fixed across passes. That isolates the variable under test: only the
 * engine's payments move, so any non-convergence is the gap rule and nothing
 * else.
 */
const makeBase = (revolvingByMonth: readonly number[]): CardProjectionResult => {
  const base = {
    monthlyRevolvingBalances: new Map<string, number[]>([['card-1', [...revolvingByMonth]]]),
    maxDebtPaymentByMonth: revolvingByMonth.map(() => Infinity),
    resimulateWithDebtCash: () => base,
  };
  return base as unknown as CardProjectionResult;
};

const inputs = {} as unknown as ForecastInputs;

describe('runDebtCashConvergence: which months the gap is measured over', () => {
  it('measures every month when nothing revolves, rather than converging on an empty set', () => {
    // Both months sit on the sub-dollar revolving dust the sim deliberately
    // leaves behind, so no month qualifies as "still solving". The payments
    // move by $1,000 every pass and must therefore never be called converged.
    const base = makeBase([0.04, 0.04]);
    let call = 0;
    const engine = () => {
      call += 1;
      return proj([call * 1000, call * 1000]);
    };

    const result = runDebtCashConvergence(base, inputs, { engine, maxPasses: 6 });

    expect(result.converged).toBe(false);
    expect(result.passes).toBe(6);
  });

  it('lets a settled revolving month converge while a dust month swings', () => {
    // Month 0 owes real money and its payment is stable; month 1 is clear and
    // its payment swings by thousands. Before this rule that swing spoke for
    // the whole run and vetoed it, which is exactly what stranded the live
    // account on the un-accelerated base pair.
    const base = makeBase([5000, 0]);
    let call = 0;
    const engine = () => {
      call += 1;
      return proj([100, call * 1000]);
    };

    const result = runDebtCashConvergence(base, inputs, { engine, maxPasses: 6 });

    expect(result.converged).toBe(true);
  });

  it('still converges the ordinary way when every month revolves', () => {
    // Nothing exotic: both months owe, both settle, and the loop behaves as it
    // always did. This is the guard against the filter quietly changing the
    // answer for a user whose whole horizon carries debt.
    const base = makeBase([5000, 5000]);
    let call = 0;
    const engine = () => {
      call += 1;
      const payment = call < 4 ? 100 - call * 10 : 70;
      return proj([payment, payment]);
    };

    const result = runDebtCashConvergence(base, inputs, { engine, maxPasses: 6 });

    expect(result.converged).toBe(true);
  });
});

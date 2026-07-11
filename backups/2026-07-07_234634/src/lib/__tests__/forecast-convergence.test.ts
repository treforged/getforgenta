import { describe, it, expect, vi } from 'vitest';
import { runDebtCashConvergence, type ConvergenceEngine } from '../forecast-convergence';
import type { CardProjectionResult } from '@/hooks/useCardProjection';
import type { ForecastInputs, ForecastResult } from '../forecast-engine';

// Phase 2 Option C, step 5 — the provider's convergence loop, extracted as a pure function so
// its semantics (pass budget, tolerance, month-0 NaN rule, zero-regression fallback) are unit-
// testable without mounting CardProjectionProvider or running the real engine.
//
// Contract:
//   engine(base) → target = rows.revolvingDebtCash (target[0] = NaN, month 0 is live-anchored)
//   → base.resimulateWithDebtCash(target) → engine again → compare successive monthly
//   debtPayment arrays; ≤3 passes, $1/month tolerance. Converged ⇒ publish the resimmed
//   projection + its engine run; NOT converged ⇒ publish the base pair (Option A display
//   machinery stays as the zero-regression fallback).

const MONTHS = 4;

/** Fake engine: maps a cardProjection marker to fixed per-month debtPayment/revolvingDebtCash
 * rows. `plans` is consulted in call order; the last entry repeats. */
function fakeEngine(plans: { debtPayment: number[]; revolvingDebtCash: number[] }[]): ConvergenceEngine {
  let call = 0;
  return vi.fn((_inputs: ForecastInputs): ForecastResult => {
    const plan = plans[Math.min(call++, plans.length - 1)];
    return {
      data: Array.from({ length: MONTHS }, (_, m) => ({
        debtPayment: plan.debtPayment[m],
        revolvingDebtCash: plan.revolvingDebtCash[m],
      })) as unknown as ForecastResult['data'],
      milestones: [],
    };
  }) as unknown as ConvergenceEngine;
}

function makeBase(): { base: CardProjectionResult; resims: CardProjectionResult[]; targets: number[][] } {
  const resims: CardProjectionResult[] = [];
  const targets: number[][] = [];
  const base = {
    resimulateWithDebtCash: (target: number[]) => {
      targets.push([...target]);
      const resim = { marker: `resim-${resims.length}` } as unknown as CardProjectionResult;
      resims.push(resim);
      return resim;
    },
  } as unknown as CardProjectionResult;
  return { base, resims, targets };
}

const inputs = { cardProjectionData: null } as unknown as ForecastInputs;

describe('runDebtCashConvergence', () => {
  it('converges on pass 1 when the resimmed engine run matches the base run within $1/month', () => {
    const { base, resims, targets } = makeBase();
    const engine = fakeEngine([
      { debtPayment: [500, 400, 300, 200], revolvingDebtCash: [450, 380, 280, 180] },
      { debtPayment: [500, 400.5, 300, 200], revolvingDebtCash: [450, 380, 280, 180] },
    ]);
    const out = runDebtCashConvergence(base, inputs, { engine });

    expect(out.converged).toBe(true);
    expect(out.passes).toBe(1);
    expect(out.cardProjection).toBe(resims[0]);
    // Month 0 is live-anchored: the target must carry NaN there, engine values after.
    expect(targets[0][0]).toBeNaN();
    expect(targets[0].slice(1)).toEqual([380, 280, 180]);
    // The published projections are the CONVERGED engine run, not the base run.
    expect((out.projections.data[1] as { debtPayment: number }).debtPayment).toBe(400.5);
  });

  it('iterates: re-targets from each new engine run and converges on a later pass', () => {
    const { base, resims, targets } = makeBase();
    const engine = fakeEngine([
      { debtPayment: [500, 400, 300, 200], revolvingDebtCash: [450, 380, 280, 180] },
      { debtPayment: [500, 350, 300, 200], revolvingDebtCash: [450, 330, 280, 180] }, // pass 1: $50 off
      { debtPayment: [500, 350, 300, 200], revolvingDebtCash: [450, 330, 280, 180] }, // pass 2: stable
    ]);
    const out = runDebtCashConvergence(base, inputs, { engine });

    expect(out.converged).toBe(true);
    expect(out.passes).toBe(2);
    expect(out.cardProjection).toBe(resims[1]);
    // Pass 2's target is damped: the midpoint of pass 1's target and pass 1's engine run
    // (default damping 0.5), so a two-cycle oscillation collapses instead of repeating.
    expect(targets[1].slice(1)).toEqual([355, 280, 180]);
  });

  it('damping breaks a two-cycle oscillation that never converges undamped', () => {
    // Engine responds to the resim's target: payment[1] = 900 − target[1] (base run: 500).
    // Undamped that's a permanent two-cycle 500 ↔ 400; damped 0.5 it lands on the 450 fixed
    // point: pass 1 target 500 → 400; pass 2 target (500+400)/2 = 450 → 450 (gap 50); pass 3
    // target stays 450 → 450 (gap 0) ⇒ converged.
    function makeTargetSensitive() {
      const base = {
        resimulateWithDebtCash: (target: number[]) =>
          ({ target } as unknown as CardProjectionResult),
      } as unknown as CardProjectionResult;
      const engine = ((i: ForecastInputs): ForecastResult => {
        const t = (i.cardProjectionData as unknown as { target?: number[] } | null)?.target;
        const m1 = t ? 900 - t[1] : 500;
        return {
          data: Array.from({ length: MONTHS }, (_, m) => ({
            debtPayment: m === 1 ? m1 : 100,
            revolvingDebtCash: m === 1 ? m1 : 100,
          })) as unknown as ForecastResult['data'],
          milestones: [],
        };
      }) as unknown as ConvergenceEngine;
      return { base, engine };
    }

    const damped = makeTargetSensitive();
    const out = runDebtCashConvergence(damped.base, inputs, { engine: damped.engine });
    expect(out.converged).toBe(true);
    expect(out.passes).toBe(3);
    expect((out.projections.data[1] as { debtPayment: number }).debtPayment).toBe(450);

    // damping: 1 disables the damper — the same engine oscillates forever and falls back.
    const undamped = makeTargetSensitive();
    const outUndamped = runDebtCashConvergence(undamped.base, inputs, {
      engine: undamped.engine, damping: 1,
    });
    expect(outUndamped.converged).toBe(false);
    expect(outUndamped.cardProjection).toBe(undamped.base);
  });

  it('falls back to the base pair (zero-regression) when the pass budget is exhausted', () => {
    const { base } = makeBase();
    // Oscillates forever: successive runs always differ by $100 in month 1.
    const engine = fakeEngine([
      { debtPayment: [500, 400, 300, 200], revolvingDebtCash: [450, 380, 280, 180] },
      { debtPayment: [500, 300, 300, 200], revolvingDebtCash: [450, 280, 280, 180] },
      { debtPayment: [500, 400, 300, 200], revolvingDebtCash: [450, 380, 280, 180] },
      { debtPayment: [500, 300, 300, 200], revolvingDebtCash: [450, 280, 280, 180] },
    ]);
    const out = runDebtCashConvergence(base, inputs, { engine });

    expect(out.converged).toBe(false);
    expect(out.passes).toBe(3);
    // Base projection + BASE engine run are published untouched.
    expect(out.cardProjection).toBe(base);
    expect((out.projections.data[1] as { debtPayment: number }).debtPayment).toBe(400);
  });

  it('respects the tolerance boundary: a $1.5/month gap does not converge at $1 tolerance', () => {
    const { base } = makeBase();
    const engine = fakeEngine([
      { debtPayment: [500, 400, 300, 200], revolvingDebtCash: [450, 380, 280, 180] },
      { debtPayment: [500, 401.5, 300, 200], revolvingDebtCash: [450, 381.5, 280, 180] },
    ]);
    const out = runDebtCashConvergence(base, inputs, { engine, maxPasses: 1 });
    expect(out.converged).toBe(false);
    expect(out.cardProjection).toBe(base);
  });

  it('passes the resimmed projection into the engine as cardProjectionData', () => {
    const { base, resims } = makeBase();
    const seen: unknown[] = [];
    const engine = ((i: ForecastInputs) => {
      seen.push(i.cardProjectionData);
      return {
        data: Array.from({ length: MONTHS }, () => ({ debtPayment: 100, revolvingDebtCash: 100 })) as unknown as ForecastResult['data'],
        milestones: [],
      };
    }) as unknown as ConvergenceEngine;
    const out = runDebtCashConvergence(base, inputs, { engine });

    expect(out.converged).toBe(true);
    expect(seen[0]).toBe(base);
    expect(seen[1]).toBe(resims[0]);
  });
});

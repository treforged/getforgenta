import type { CardProjectionResult } from '@/hooks/useCardProjection';
import { calculateForecast, type ForecastInputs, type ForecastResult } from './forecast-engine';

// Phase 2 Option C, step 5 — the provider's debt-cash convergence loop as a pure function.
// engine(base) → target = rows.revolvingDebtCash (target[0] = NaN, month 0 is live-anchored)
// → base.resimulateWithDebtCash(target) → engine again → compare successive monthly
// debtPayment arrays. Converged ⇒ publish the resimmed pair; exhausted ⇒ publish the base
// pair so the Option A display machinery remains the zero-regression fallback.

export type ConvergenceEngine = (inputs: ForecastInputs) => ForecastResult;

export interface DebtCashConvergenceOptions {
  maxPasses?: number;
  toleranceDollars?: number;
  engine?: ConvergenceEngine;
  /** Weight of the newest engine run in each re-target, (0, 1]. 1 = undamped. */
  damping?: number;
}

export interface DebtCashConvergenceResult {
  cardProjection: CardProjectionResult;
  projections: ForecastResult;
  converged: boolean;
  passes: number;
}

export function runDebtCashConvergence(
  base: CardProjectionResult,
  engineInputs: ForecastInputs,
  opts: DebtCashConvergenceOptions = {},
): DebtCashConvergenceResult {
  // Default pass budget of 8: on live data the damped (0.5) loop needs ~6 passes to collapse
  // the payment↔cash-floor two-cycle (gap 1423 → 159 → 91 → 133 → 29 → 1, verified 2026-07-07).
  const { maxPasses = 8, toleranceDollars = 1, engine = calculateForecast, damping = 0.5 } = opts;

  const baseProj = engine({ ...engineInputs, cardProjectionData: base });
  let currentProj = baseProj;
  let prevTarget: number[] | null = null;

  for (let pass = 1; pass <= maxPasses; pass++) {
    // Re-target from the CURRENT engine run, but always resim from base — the closure is
    // stateless, and month 0 stays live-anchored (NaN ⇒ keep the sim's own month-0 cash).
    // After pass 1 the target is damped toward the previous one, so a payment↔cash-floor
    // two-cycle collapses onto its fixed point instead of oscillating past the pass budget.
    const raw = currentProj.data.map((row, m) => (m === 0 ? NaN : row.revolvingDebtCash));
    const prev = prevTarget;
    const target: number[] = prev
      ? raw.map((v, m) => (m === 0 ? NaN : damping * v + (1 - damping) * prev[m]))
      : raw;
    prevTarget = target;
    const resim = base.resimulateWithDebtCash(target);
    const resimProj = engine({ ...engineInputs, cardProjectionData: resim });

    const maxGap = resimProj.data.reduce((max, row, m) => {
      const gap = Math.abs(row.debtPayment - currentProj.data[m].debtPayment);
      return gap > max ? gap : max;
    }, 0);

    if (maxGap <= toleranceDollars) {
      return { cardProjection: resim, projections: resimProj, converged: true, passes: pass };
    }
    currentProj = resimProj;
  }

  return { cardProjection: base, projections: baseProj, converged: false, passes: maxPasses };
}

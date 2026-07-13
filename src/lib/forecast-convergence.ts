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
  // Default pass budget of 18: the damped (0.5) loop's residual gap decays ~40%/pass near the
  // fixed point, so the exact pass count to cross $1 tolerance scales with the initial gap and is
  // data-sensitive. On 2026-07-11 live data the loop converged monotonically (gaps 2307 → 916 →
  // 262 → … → 1 at pass 13, 0 by pass 15) yet the old 12-pass budget cut it off one pass short at
  // gap $2 — and the exhaustion path publishes the UNACCELERATED base pair, so a run that had
  // already found the correct payoff (Discover: Jul 2027) was discarded for the pathological base
  // (Feb 2029, cash ballooning to ~$38k). 18 clears that trajectory with a 5-pass margin and still
  // covers the earlier fixtures (2026-07-09 needed 11, 2026-07-07 needed 6). The fallback to base
  // remains the zero-regression guard for genuine (non-decaying) oscillation, which no budget fixes.
  const { maxPasses = 18, toleranceDollars = 1, engine = calculateForecast, damping = 0.5 } = opts;

  // On exhaustion, publish the last resim (not base) only when the loop was genuinely CONVERGING
  // toward its fixed point but ran out of budget — i.e. the gap made net progress (lastGap <
  // firstGap) AND landed small in absolute terms (lastGap ≤ this bound). This rescues the
  // "one pass short" cliff (2026-07-11 live data: monotonic decay 2307 → … → gap $2 at the cap;
  // the last resim already had the correct Jul 2027 payoff while base was the pathological Feb
  // 2029 / $38k-hoard run). A genuine non-decaying oscillation has firstGap == lastGap (flat) or
  // no net progress, so it still falls back to base — the zero-regression guard. The absolute
  // bound guards the other pathological case: a huge gap decaying so slowly that the last resim is
  // still a mid-transient, unconverged run less trustworthy than base's self-consistent pair.
  const exhaustionPublishBound = Math.max(toleranceDollars * 25, 25);

  const baseProj = engine({ ...engineInputs, cardProjectionData: base });
  let currentProj = baseProj;
  let prevTarget: number[] | null = null;
  let prevCap: number[] | null = null;
  let firstGap = Infinity;
  let lastGap = Infinity;
  let lastResim: CardProjectionResult | null = null;
  let lastResimProj: ForecastResult | null = null;

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
    // Thread Forecast's own PASS-2 cap (currentProj.maxDebtPaymentByMonth) through so Step 2's
    // cycling-pool cap agrees with Step 5's revolving cascade — both driven by the same
    // Forecast-authoritative number instead of the sim recomputing its own independent cap.
    //
    // The cap is damped exactly like the target above, and for the same reason: on save-up
    // months where every card is cycling, the sim's mandatory pool binds to the cap 1:1 while
    // the engine's next cap moves opposite to the sim's payment (higher payment ⇒ more cycling
    // expense ⇒ lower cap) — a slope ≈ −1 map that self-damps only ~7%/pass and exhausts the
    // pass budget (the residual m30 two-cycle, 2026-07-09). Months where either side is
    // non-finite (uncapped) take the newest raw value: averaging a finite cap with Infinity
    // would pin the month uncapped forever.
    const rawCap = currentProj.maxDebtPaymentByMonth;
    const pc = prevCap;
    const cap: number[] = pc
      ? rawCap.map((v, m) => (isFinite(v) && isFinite(pc[m]) ? damping * v + (1 - damping) * pc[m] : v))
      : rawCap;
    prevCap = cap;
    const resim = base.resimulateWithDebtCash(target, cap);
    const resimProj = engine({ ...engineInputs, cardProjectionData: resim });

    const maxGap = resimProj.data.reduce((max, row, m) => {
      const gap = Math.abs(row.debtPayment - currentProj.data[m].debtPayment);
      return gap > max ? gap : max;
    }, 0);

    if (maxGap <= toleranceDollars) {
      return { cardProjection: resim, projections: resimProj, converged: true, passes: pass };
    }
    if (pass === 1) firstGap = maxGap;
    lastGap = maxGap;
    lastResim = resim;
    lastResimProj = resimProj;
    currentProj = resimProj;
  }

  // Exhausted. If the loop was converging (net progress + landed small), publish the last resim —
  // it is strictly closer to the fixed point than base. Otherwise fall back to base (oscillation /
  // no meaningful progress), preserving the zero-regression guarantee. `converged` stays false in
  // both cases: the loop never crossed the $1 tolerance.
  const wasConverging = lastResim !== null && lastResimProj !== null
    && lastGap < firstGap && lastGap <= exhaustionPublishBound;
  if (wasConverging) {
    return { cardProjection: lastResim!, projections: lastResimProj!, converged: false, passes: maxPasses };
  }
  return { cardProjection: base, projections: baseProj, converged: false, passes: maxPasses };
}

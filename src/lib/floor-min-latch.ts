/**
 * Per-convergence-run hysteresis for getAugmentedMinSafeCash's card-minimum floor term — the
 * surgical fix for the floor-regime bistability root-caused 2026-08-25 (8c15ed1a's commit body;
 * regression pinned in forecast-convergence.floorFlicker.test.ts).
 *
 * THE FLICKER. A card's floor reservation for month m is a function of the sim's end-of-month
 * revolving balance for that same month: revBal > 0 reserves the FORMULA minimum on the dying
 * balance (the 'rev' regime, ~$47 on a ~$100 tail), revBal === 0 reserves the static configured
 * min_payment via the cycling branch (the 'cyc' regime, $253 on the measured capture). The two
 * regimes differ by a step ($205.77 measured), and the step points the WRONG way for a fixed-point
 * iteration: paying a card off RAISES that month's floor retroactively, which lowers the next
 * pass's payment target, which un-pays the card, which drops the floor back. When a payoff tail
 * lands exactly on the boundary month, runDebtCashConvergence's engine↔resim loop has no fixed
 * point to find — it falls into a genuine limit cycle (a period-3 orbit on the $8,000-shock
 * capture) and exhausts its pass budget, publishing the base fallback. Damping cannot fix a
 * discontinuity, and no pass budget outlasts a true cycle.
 *
 * THE RULE. One latch is created per convergence run and observes, once per engine run, the
 * regime each (month, card) reservation naturally lands in. A monotone trajectory — a payoff date
 * drifting earlier or later across passes and settling — changes a given (month, card)'s regime
 * at most ONCE. Changing regime TWICE within one run is the flicker signature, and on the second
 * change the pair is latched: from that pass on its reservation is forced up to the LARGEST
 * amount any regime has produced for it, making the floor term monotone (non-decreasing) for the
 * rest of the run so the loop's remaining dynamics can converge. Forcing the larger amount is the
 * safe side by this floor's own doctrine: a floor reads cash LOW, never high — the converged plan
 * holds one regime-step more cash in the boundary month rather than authorising a payment the
 * next pass would take back.
 *
 * WHAT IT CANNOT TOUCH. Two regime changes require three engine runs, so any run that converges
 * in one pass (base + pass 1 — the untouched golden captures) is byte-identical with or without
 * the latch. Callers outside a convergence loop (Dashboard, Forecast display, useCardProjection's
 * bounded 3-pass refinement) never construct one, and getAugmentedMinSafeCash without a latch is
 * unchanged. The latch is deliberately stateful — it IS the cross-pass memory — which is why it
 * lives here as an explicit object a convergence run creates and owns, never module state.
 */

/** The reservation regime getAugmentedMinSafeCash's card loop landed in for one (month, card):
 * 'rev' = revolving balance > 0, formula minimum; 'cyc' = paid off / cycling, static configured
 * minimum; 'none' = no reservation (gates excluded it, or the card doesn't qualify). Only a
 * revBal sign flip can move a pair between regimes within a run — every other gate (due-day
 * cutoffs, payment preference, start date) is pass-stable. */
export type FloorMinRegime = 'rev' | 'cyc' | 'none';

export interface FloorMinLatch {
  /**
   * Record the natural regime + amount for (monthIdx, cardId) this engine run and return the
   * amount the floor must apply: the natural amount until the pair flickers, then
   * max(natural, largest amount ever observed for the pair) forever after.
   */
  observe(monthIdx: number, cardId: string, regime: FloorMinRegime, amount: number): number;
}

interface PairState {
  lastRegime: FloorMinRegime;
  regimeChanges: number;
  maxAmount: number;
  latched: boolean;
}

export function createFloorMinLatch(): FloorMinLatch {
  const pairs = new Map<string, PairState>();

  return {
    observe(monthIdx: number, cardId: string, regime: FloorMinRegime, amount: number): number {
      const key = `${monthIdx}:${cardId}`;
      const st = pairs.get(key);
      if (!st) {
        pairs.set(key, { lastRegime: regime, regimeChanges: 0, maxAmount: amount, latched: false });
        return amount;
      }
      if (regime !== st.lastRegime) {
        st.regimeChanges += 1;
        st.lastRegime = regime;
        // Second change = the pair has RETURNED to a regime it already left (only revBal's sign
        // moves a pair, and there are two reachable regimes per card) — the flicker signature.
        if (st.regimeChanges >= 2) st.latched = true;
      }
      if (amount > st.maxAmount) st.maxAmount = amount;
      return st.latched ? Math.max(amount, st.maxAmount) : amount;
    },
  };
}

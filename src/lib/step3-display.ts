// Shared display-layer derivation for Forecast PASS-3 surplus redirects.
//
// The card-payoff SIM (simulateVariablePayoff) plans per-card payments; Forecast's PASS-3 routes
// additional surplus cash to revolving debt beyond that plan. useCardProjection distributes those
// extras per card in debt-strategy priority order (perCardPaymentsScaled[].surpluses). The SIM's
// monthly balances do NOT reflect the extras, so every surface that displays a card balance must
// subtract the cumulative extras the same way — the Forecast month popup, the Forecast Total CC
// line (forecast-engine's revolvingAdj), the Debt Payoff accordion/chart, and the CSV export.
// Before this module each surface derived its own adjustment (three disagreeing versions —
// the "Prime -$369 vs accordion" mismatch); they now all consume these helpers.
//
// IMPORTANT: this is display-only. The forecast engine's cash walk (step-3 routing,
// cumulativeStep3Extra, milestones, Ending Cash) is intentionally NOT driven by these values.

export interface PerCardSurpluses {
  id: string;
  surpluses: number[];
}

/**
 * Running total of PASS-3 surplus redirected to each card through month i (inclusive).
 * Input is useCardProjection's perCardPaymentsScaled (only id + surpluses are read).
 */
export function cumulativeSurplusesByCard(
  perCardPaymentsScaled: readonly PerCardSurpluses[] | undefined,
): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const card of perCardPaymentsScaled ?? []) {
    let running = 0;
    result.set(card.id, (card.surpluses ?? []).map(s => {
      running += s ?? 0;
      return running;
    }));
  }
  return result;
}

/**
 * Card balance as every display surface should show it: the SIM balance minus the cumulative
 * PASS-3 surplus already redirected to this card, floored at 0. Only meaningful while the card
 * still carries revolving debt — callers gate on monthlyRevolvingBalances > 0 and show the
 * cycling/statement balance untouched otherwise.
 */
export function adjustedDisplayBalance(simBalance: number, cumulativeSurplus: number): number {
  return Math.max(0, simBalance - cumulativeSurplus);
}

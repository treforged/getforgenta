// Shared cycling-debt-model types (.claude/plan/unify-cycling-model.md Stage 1).
//
// Moved out of useCardProjection.ts so pure lib code (forecast-engine.ts, credit-card-engine.ts,
// cardProjectionResim.ts) can reference these shapes without importing from a React hook file.
// useCardProjection.ts re-exports these under the same names, so existing consumers are
// unaffected — this is a type-only relocation, not an API change.

import type { CardData, PaymentLedgerEntry } from './credit-card-engine';

export interface Month0Result {
  safeToPayTotal: number;
  maxCapacity: number;
  holdback: number;
  holdbackEvent: { eventName: string; monthLabel: string } | null;
  cyclingPayment: number;
  revolvingPayment: number;
  perCardAdjusted: { id: string; name: string; payment: number; maxPayment: number }[];
  m0SafeFloor: number;
  /** Cash being set aside this month toward a saving-phase vehicle's down payment. Still the
   * user's own cash (hasn't left any account) — excluded from debt-payment capacity above, but
   * should be shown as cash on hand with this note, not subtracted as if it were a real expense. */
  carReserve: number;
  carReserveEvent: { vehicleName: string } | null;
  /** Subtracted from cashPreDebt above — surface these so any UI deriving "available to deploy"
   * from visible line items (Dashboard) can show them, instead of having them only affect the
   * total invisibly. */
  vehicleInsurance: number;
  mortgagePayment: number;
}

export interface ProjectionDataRow {
  month: string;
  totalCCBalance: number;
  displayCCBalance: number;
  totalInterest: number;
  utilization: number;
  [cardName: string]: string | number;
}

export interface CardProjectionResult {
  data: ProjectionDataRow[];
  cards: { name: string; color: string }[];
  simCards: CardData[];
  debtPaymentTotals: number[];
  allPaymentTotals: number[];
  perCardPayments: { name: string; id: string; payments: number[] }[];
  perCardPaymentsScaled: { name: string; id: string; payments: number[]; surpluses: number[] }[];
  monthlyRevolvingBalances: Map<string, number[]>;
  monthlyBalances: Map<string, number[]>;
  perCardMinPayments: Map<string, number[]>;
  /** True amount owed at the start of each cycling billing cycle (principal + any carried
   * interest), before that month's payment. Lets other consumers of this hook's sim (e.g.
   * CreditCardEngine.tsx's accordion) show the same Start/End figures as the Forecast popup,
   * instead of falling back to a separate, independently-converging local simulation. */
  monthlyCyclingOwed: Map<string, number[]>;
  /** Interest charged on a cycling card's carried-forward unpaid balance, per month. */
  monthlyCyclingInterest: Map<string, number[]>;
  /** Interest actually charged on a REVOLVING (non-cycling) card's starting balance each month
   * (Step 3's real calc). Ground truth so projectCardVariable's revolving branch can show the
   * engine's real interest instead of back-solving it from whatever payment ends up displayed —
   * which may be a cash-floor-scaled amount different from the payment that produced the balance. */
  monthlyInterest: Map<string, number[]>;
  /** A cycling card's accumulated backlog (unpaid statement debt), end-of-month post-payment.
   * Lets callers (e.g. Dashboard.tsx/Forecast.tsx's own getAugmentedMinSafeCash calls) keep their
   * displayed "Cash Floor" in lockstep with simulateVariablePayoff's own double-reservation guard
   * for backlog cards — see pay-schedule.ts's getAugmentedMinSafeCash. */
  monthlyCyclingBacklog: Map<string, number[]>;
  /** Mandatory statement payment made to each cycling card per month (before backlog cascade).
   * Exposed so simDebug and other consumers can distinguish mandatory vs discretionary payments. */
  monthlyMandatoryCyclingPayment: Map<string, number[]>;
  /** Per-month cap on Step-5 debt payments from the look-ahead floor-protection pass.
   * Infinity = uncapped; finite = save-up month. Exposed for debugging interest-accrual causes. */
  maxDebtPaymentByMonth: number[];
  /** Authoritative per-month payment ledger built from the active sim's own outputs —
   * .claude/plan/unify-cycling-model.md Stage 2. Not yet consumed by forecast-engine.ts. */
  paymentLedger: PaymentLedgerEntry[];
  m0Income: number;
  m0Expenses: number;
  m0SafeFloor: number;
  saveUpMonths: Set<number>;
  /** Strictly-before-the-breach months only (never the event's own month) — see the
   * strictSaveUpMonths comment near its definition. Forecast.tsx uses this (not saveUpMonths)
   * to gate its own surplus-redirect step, since the event's own month should still be eligible
   * for redirecting any genuine surplus left over once its own protection is already in place. */
  strictSaveUpMonths: Set<number>;
  saveUpReason: Map<number, { eventName: string; monthLabel: string }>;
  /** 1-indexed month count (matches payoffMonth convention) when the virtual revolving balance
   * first reaches zero in the pass-3 simulation — mirrors Forecast.tsx's CC Debt Free milestone
   * so the Debt Payoff tab's PAYOFF ETA shows the same projected payoff date. Null if revolving
   * debt is not cleared within PROJECTION_MONTHS. */
  forecastRevolvingPayoffMonth: number | null;
  /** 1-indexed month when the simulation's total revolving balance (across all revolving cards)
   * first hits $0 — based on activeSim.monthlyRevolvingBalances, which reflects the actual
   * per-card payoff schedule including "full" preference cards like Discover. Used by the
   * Debt Payoff tab's PAYOFF ETA so it aligns with when the SIM truly clears all revolving debt. */
  simRevolvingPayoffMonth: number | null;
  /** Months (>0) where a card carries a manual interest-saving-balance pin (the synthetic
   * statement pin in credit-card-engine's manualStatementByCard). The sim pays exactly the
   * pinned amount in these months regardless of any debt-cash target, so the convergence loop
   * excludes them from target feedback the same way month 0 is live-anchored — feeding back
   * the engine's floor-clipped value for a month whose payment is fixed injects a persistent
   * target-vs-actual error that oscillates the loop. `amount` is the pinned payment and
   * `minPayment` the card's contract minimum, so Forecast's PASS-2 floor-protection walk can
   * model the pinned month's true mandatory CC outflow (ccMinTotal + amount − minPayment)
   * instead of assuming only minimums leave that month. Optional for fixture compatibility. */
  manualIsbPins?: { month: number; amount: number; minPayment: number }[];
  /** Per-card revolving balance trajectory with step-3 surplus applied cumulatively in avalanche
   * order — mirrors Forecast.tsx's adjustedRevBal = max(0, simBal - cumulativeStep3Extra) per card.
   * Use as both revBals and trueBalances in projectCardVariable so the Debt Payoff chart and
   * per-card payoff label match the Forecast's CC Debt Free milestone timing. */
  forecastAdjustedRevolvingBalances: Map<string, number[]>;
  /** Phase 2 Option C convergence: re-run the ACTIVE simulation with the forecast engine's
   * authoritative per-month revolving debt cash (ForecastRow.revolvingDebtCash) as
   * debtCashTargetByMonth (sim param #20) and rebuild every sim-derived field — with NO pass-3
   * replica, NO scaling and NO surplus distribution, because the sim's payments ARE the plan
   * (per-card surpluses all zero; the engine's step3-display adjustments become no-ops).
   *
   * Month 0 is live-anchored: callers MUST pass target[0] = NaN (the sim's isFinite check skips
   * it) — month0/saveUp/look-ahead outputs are kept from this base result. A fresh closure every
   * compute: do NOT put it in downstream useMemo dep arrays; consumers key on the
   * CardProjectionResult object identity instead.
   *
   * `forecastMaxDebtPaymentByMonth` (optional): Forecast PASS 2's own per-month save-up cap
   * (ForecastResult.maxDebtPaymentByMonth). When provided, it REPLACES the sim's own
   * (narrower) look-ahead cap for Step 2's cycling/paid-off pool cap, so cycling-only save-up
   * months agree with Forecast instead of the sim recomputing an independent, possibly
   * disagreeing determination. Omitted ⇒ the sim keeps using its own cap (legacy behavior). */
  resimulateWithDebtCash: (target: number[], forecastMaxDebtPaymentByMonth?: number[]) => CardProjectionResult;
  /** Anomaly B: this same result rebuilt with user month-pins (sim param #21,
   * paymentOverridesByMonth) applied — both the base sim AND the returned
   * resimulateWithDebtCash closure carry the pins, so a convergence loop run on the
   * variant keeps them on every pass. Optional: fixture snapshots predate it. */
  withPaymentOverrides?: (pinnedPayments: { [cardId: string]: Record<number, number> }) => CardProjectionResult;
  month0: Month0Result;
}

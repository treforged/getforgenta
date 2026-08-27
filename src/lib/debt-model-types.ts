// Shared cycling-debt-model types (.claude/plan/unify-cycling-model.md Stage 1).
//
// Moved out of useCardProjection.ts so pure lib code (forecast-engine.ts, credit-card-engine.ts,
// cardProjectionResim.ts) can reference these shapes without importing from a React hook file.
// useCardProjection.ts re-exports these under the same names, so existing consumers are
// unaffected — this is a type-only relocation, not an API change.

import type { CardData, PaymentLedgerEntry } from './credit-card-engine';
import type { AutoExtraReserveKind } from './ranked-surplus-allocation';

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
  /** The portion of `carReserve` still HELD at month end — i.e. excluding any vehicle whose
   * purchase lands in month 0, where the reserve is spent by month end. Mirrors the forecast
   * engine's `cumulativeCarReserveHeld` at i=0 (`forecast-engine.ts:1080-1084`). */
  carReserveHeld: number;
  /** End-of-month-0 cash, defined EXACTLY as the Forecast table's `END CASH` column:
   *
   *   endCash = chain.cashPreDebt − safeToPayTotal + carReserveHeld
   *
   * which is `forecast-engine.ts`'s `finalLiquid = cashPreDebt − monthDebtPayment` plus the
   * reserved-but-unspent vehicle savings it adds back for display (`endingCash`, line 1282).
   *
   * Finding §1.1: Dashboard's "Month-End Cash" tile used to build its own answer from the
   * transaction-merge helpers (`getRemainingTransaction*`) — the very source `m0Income`/
   * `m0Expenses` above deliberately abandoned because it disagrees with the forecast engine —
   * and it omitted savings, car, insurance, mortgage and transfer outflows entirely. Two pages
   * predicted month-end cash $3,487 apart. There is one definition and it lives here. */
  endCash: number;
  /** Subtracted from cashPreDebt above — surface these so any UI deriving "available to deploy"
   * from visible line items (Dashboard) can show them, instead of having them only affect the
   * total invisibly. */
  vehicleInsurance: number;
  /** Cash leaving for non-credit-card debt service — the `debts` rows paired to mortgage /
   * student-loan / other-liability accounts. Renamed from `mortgagePayment` 2026-08-24, when the
   * sum stopped being mortgage-only; `buildOtherDebtPaymentSchedule` (non-cc-liabilities.ts) computes it
   * and owns the rule that stops a bill the user ALSO keeps as an expense rule counting twice. */
  otherDebtPayment: number;
  /** RANKED AUTOMATIC EXTRA PAYMENTS — `chain.autoExtraReserve` broken out per target, straight
   * from `computeAutoExtraReserve`'s `perTarget`. The scalar says how many dollars left checking;
   * this says WHICH goal or car fund they left for, which is what the forecast needs to grow the
   * matching balance by the same dollars.
   *
   * ⚠️ Without this the feature is strictly worse than not shipping it: `cashPreDebt` already
   * drops by `autoExtraReserve`, so a consumer that models the cash side and not the savings side
   * simply makes the user's money disappear. `forecast-engine.ts` credits these at month 0 —
   * linked savings account first, else the goal's / car fund's own pool.
   *
   * Empty for every user with nothing opted in, which `auto_extra`'s FALSE default makes the norm.
   * Sums to `chain.autoExtraReserve` (the scalar is rounded to cents; the parts are not).
   *
   * `'loan'` is extra PRINCIPAL on a vehicle loan (a `car_funds` row in its loan phase). It leaves
   * checking exactly as a goal contribution does, but it lands on a liability rather than in a
   * pool, so a consumer that credits these must reduce the loan balance, never grow a savings
   * balance — see `forecast-engine.ts`'s crediting step. */
  autoExtraPerTarget: { id: string; kind: AutoExtraReserveKind; amount: number }[];
  /** The COMPLETE month-0 cash chain the engine used to derive safeToPayTotal, as integers.
   *
   * Findings §2.6/§2.3: Dashboard used to render `safeToPayTotal` (an engine output) as the "="
   * of a subtraction chain assembled from its own page-local transaction sums and its own
   * `getAugmentedMinSafeCash` call. Two independent derivations printed as one equation, so the
   * rows did not add up to their own total ($2,632 off) and the floor row disagreed with the
   * floor the engine actually applied. Every term below is the value the engine consumed, so a
   * UI sourcing all of them shows one derivation instead of two.
   *
   * Every field carries EXACT CENTS — the unrounded value the engine consumed — and `cashPreDebt`
   * is the very variable the cap was computed from, not a re-derivation of it. Rounding happens
   * ONLY at render (Tre's decision, 2026-08-06: "calculations should use the full exact values
   * with the decimals"). The identity holds in exact arithmetic:
   *
   *   cashPreDebt = fundingBalance + income − expenses − planExpenses − goalContributions
   *                 − autoExtraReserve − carSavedEarmark − carReserve − carLoanPayment
   *                 − vehicleInsurance − otherDebtPayment − transfers + oneTimeNet
   *
   * `carSavedShortfall` is NOT in that identity by design — see its own doc comment.
   *
   * ⚠️ Do NOT go back to rounding the terms here. These fields used to be integers with
   * `cashPreDebt` defined as the SUM OF THE ROUNDED TERMS, which made the drawer's on-screen
   * column add up exactly in integer arithmetic but left the total up to a dollar away from the
   * raw value driving the cap — the cause of Dashboard MONTH-END CASH and Forecast END CASH
   * printing $1 apart. Consumers that render this chain (`month0-budget-snapshot.ts`,
   * `Dashboard.tsx`'s month-end calc drawer) print two decimals so the equation still visibly
   * balances. `monthEndCash.invariant.test.ts` pins the cross-surface gap at cents.
   *
   * What remains — `cashPreDebt − m0SafeFloor − safeToPayTotal` — is a real residual, and it is a
   * union of four distinct things: the save-up holdback; the FLOOR_CUSHION_DOLLARS margin the
   * month-0 drain leaves above the floor on purpose (since 1eebd1f3, 2026-08-21; before that
   * month 0 was the one uncushioned month and this residue was pennies); the cents month 0's TWO
   * whole-dollar roundings leave behind (`m0SafeFloor` is a rounded floor and the per-card split is
   * integers — measured 12c and 8c on the real fixture, 2026-08-22); cash beyond what any
   * revolving balance can absorb; or a negative when card minimums breach the floor. It must be
   * DISPLAYED as computed rows, never absorbed silently, and each part must carry its OWN reason,
   * because a drawer built to explain itself is wrong the moment it attributes the engine's
   * safety margin to the user's cards. `month0-budget-snapshot.ts` does that split.
   */
  chain: Month0CashChain;
}

export interface Month0CashChain {
  /** Funding-account balance the engine started from, GROSS of any car-fund earmark.
   *
   *  Finding §2.9: this used to arrive already net of the earmark, which made the earmark
   *  unnameable — a demo holding $2,800 in checking with $3,200 "saved" toward a car rendered
   *  "Balance on hand $0" and no surface could explain why. The earmark is now its own term
   *  (`carSavedEarmark`), so the chain shows the deduction instead of hiding it. `cashPreDebt` is
   *  unchanged to the cent: the term subtracts exactly what the balance used to arrive short by. */
  fundingBalance: number;
  /** Scheduled income still to land this month (forecastMonthEvents[0].income). */
  income: number;
  /** Scheduled non-CC expenses still to come this month (forecastMonthEvents[0].expenses). */
  expenses: number;
  /** Checking-sourced payment-plan installments still due this month. The forecast engine folds
   *  these into `baseExpenses` (`forecast-engine.ts:697`), so a chain that omits them reads high
   *  by exactly one month's installments — finding §1.1, $150 of the Dashboard/Forecast gap. */
  planExpenses: number;
  /** Monthly savings-goal contributions the engine reserved. */
  goalContributions: number;
  /** RANKED AUTOMATIC EXTRA PAYMENTS — surplus this month that opted-in goals and car funds took
   *  ahead of the credit cards (`computeAutoExtraReserve`, ranked-surplus-allocation.ts). Zero for
   *  every user with nothing opted in, which `auto_extra`'s FALSE default makes the norm.
   *
   *  ⚠️ It is a term in THIS chain, and not a subtraction from `availableForRevolving`, on purpose.
   *  `endCash = cashPreDebt − safeToPayTotal + carReserveHeld`, so shaving the reserve off the card
   *  pool alone would drop `safeToPayTotal` while RAISING `endCash` by the same dollars — the app
   *  would claim the user has that money still in checking *and* that the goal grew by it. As a
   *  chain term it is what it conceptually is: an extra goal contribution, a sibling of
   *  `goalContributions` and `carReserve`, and `endCash` is then correct by construction.
   *
   *  The reserve is decided from a pool that is itself net of the cash floor, which resolves in one
   *  order: pool = cashPreDebt(before) − floor − cyclingPayment → reserve → subtract. The card
   *  block's combined minimum is settled inside the allocator BEFORE any rank is consulted, so a
   *  goal ranked above the cards can only ever take surplus, never a minimum payment. */
  autoExtraReserve: number;
  /** Down-payment money ALREADY saved that is sitting in the funding account — still the user's
   *  cash, but spoken for, so it is not offered up for card paydown. Capped at the account balance
   *  (`resolveCarFundEarmark`), which is what makes it a legitimate chain term. */
  carSavedEarmark: number;
  /** The part of that earmark the account could not cover — saved cash that is NOT in the linked
   *  account. Deliberately NOT part of `cashPreDebt`: it is a data-consistency signal, not money
   *  leaving the account, and folding it would double-count against a balance that never held it.
   *  Renderers surface it as explanatory copy (finding §2.9). */
  carSavedShortfall: number;
  /** Car down-payment reserve — still the user's own cash, but not deployable this month. */
  carReserve: number;
  /** Active car-loan payments still due after the sync cutoff. */
  carLoanPayment: number;
  vehicleInsurance: number;
  /** Non-credit-card debt service leaving checking this month — see {@link Month0Result}. */
  otherDebtPayment: number;
  /** Transfer/investment rules plus goal lump-sum transfers leaving checking this month. */
  transfers: number;
  /** Net one-time DB transactions (income − expenses); may be negative. */
  oneTimeNet: number;
  /** Sum of the terms above. Cash on hand before any revolving-debt payment. */
  cashPreDebt: number;
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
  /** The funding account the engine actually resolved for debt cash
   * (`persistedDebtFundingId || forecastFundingAccountId`). Finding §2.3: Dashboard resolved its
   * own funding account (`profile.default_deposit_account` with no account-type check and no
   * persisted-override), so its `getAugmentedMinSafeCash` call saw different pre-paycheck bills
   * and displayed a cash floor the engine never used ($2,402 vs $1,650). Any surface displaying
   * or itemizing the floor must pass THIS id, not one it resolves itself. */
  debtFundingAccountId: string | null;
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

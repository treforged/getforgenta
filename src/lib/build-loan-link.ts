import { getActiveCarLoanPayments, getCarFundSaved, getLoanPrincipal } from './vehicle-loan-engine';
import type { CarBuild, CarFund } from './types';

/**
 * The connection between a BUILD (the log of what you are doing to the car) and the CAR FUND
 * (the plan for buying or paying off the car itself).
 *
 * They were separate surfaces with nothing joining them: the Build page could tell you the
 * modifications came to $12,400 and the Vehicles page could tell you $16,254 was still owed on
 * the car, and no page anywhere put the two figures on the same screen. `car_builds.car_fund_id`
 * is that join, and this module is the only thing that reads it.
 *
 * Pure: no database, no React. `asOf` is injectable so the loan branch is testable without
 * waiting for a month to pass.
 */

/**
 * The build's connected car fund, or null.
 *
 * ⚠️ THE ID IS NOT TRUSTED. The FK on `car_builds.car_fund_id` guarantees the row exists; it
 * cannot guarantee it belongs to the same user, and RLS is what actually protects `car_funds`.
 * So the id is resolved against the funds the CALLER can see, and anything not in that list
 * reads as unconnected. This is the same rule `resolveLinkedLoanBalance` follows for
 * `car_funds.linked_loan_account_id` — read `vehicle-loan-link.ts`'s header before relaxing it.
 */
export function resolveBuildCarFund(
  build: Pick<CarBuild, 'car_fund_id'> | null | undefined,
  carFunds: readonly CarFund[] | null | undefined,
): CarFund | null {
  const id = build?.car_fund_id;
  if (!id) return null;
  return (carFunds ?? []).find(cf => cf.id === id) ?? null;
}

/**
 * What the Build page shows about the connected car, as a discriminated union so the component
 * cannot render a figure the state does not actually have.
 *
 * The four cases exist because a car fund in `phase: 'loan'` is not always a loan you are paying:
 * it can be one that has not reached its first payment yet, and it can be one already paid off.
 * Both would come back from `getActiveCarLoanPayments` as simply absent, and collapsing them into
 * a `$0 / no payoff date` row would draw a confident zero over two quite different truths.
 */
export type BuildCarSummary =
  /** Still saving for the car. */
  | {
      kind: 'saving';
      vehicleName: string;
      /** Resolved through `getCarFundSaved`, never read off `current_saved` directly. */
      saved: number;
      downPaymentGoal: number;
      /** 0-100, clamped. 0 when the goal is 0 — there is no progress toward nothing. */
      pct: number;
      /** What the loan is expected to be once the car is bought. */
      estimatedLoan: number;
      plannedPurchaseDate: string | null;
    }
  /** Paying the loan right now. */
  | {
      kind: 'loan';
      vehicleName: string;
      /** This month's regular payment, lump sums excluded — the engine's own row. */
      payment: number;
      remainingBalance: number;
      payoffDate: string;
      isDeferredInterest: boolean;
    }
  /** In loan phase, but the first payment has not come due (or the dates are not filled in). */
  | { kind: 'loan_pending'; vehicleName: string; paymentStartDate: string | null }
  /** In loan phase with nothing left owed. */
  | { kind: 'loan_paid'; vehicleName: string };

export interface BuildCarSummaryOptions {
  /** Live balance of `carFund.linked_account`, for `getCarFundSaved`. Null when unresolved —
   * which falls back to the typed figure rather than inventing a zero. */
  linkedAccountBalance?: number | null;
  /** Injectable clock. */
  asOf?: Date;
}

/** ISO `YYYY-MM-DD` for a Date, matching `getActiveCarLoanPayments`'s own comparison basis. */
function isoDay(d: Date): string {
  return d.toISOString().split('T')[0];
}

/**
 * Summarize a connected car fund for the Build page.
 *
 * Every figure comes from `vehicle-loan-engine`, the same source the Vehicles page and the
 * forecast read — deliberately, so the Build page cannot quote a payoff date the rest of the app
 * disagrees with. That is the §2.5 bug class this codebase has already paid to fix once.
 */
export function summarizeBuildCarFund(
  carFund: CarFund,
  { linkedAccountBalance = null, asOf }: BuildCarSummaryOptions = {},
): BuildCarSummary {
  const vehicleName = carFund.vehicle_name;

  if (carFund.phase === 'saving') {
    // `null` funding account, exactly as the Vehicles page passes: this surface has no cash pool
    // of its own to double-count against.
    const saved = getCarFundSaved(carFund, null, linkedAccountBalance);
    const downPaymentGoal = Number(carFund.down_payment_goal) || 0;
    const pct = downPaymentGoal > 0
      ? Math.min(100, Math.max(0, (saved / downPaymentGoal) * 100))
      : 0;
    return {
      kind: 'saving',
      vehicleName,
      saved,
      downPaymentGoal,
      pct,
      estimatedLoan: getLoanPrincipal(carFund),
      plannedPurchaseDate: carFund.planned_purchase_date,
    };
  }

  const active = getActiveCarLoanPayments([carFund], asOf)[0];
  if (active) {
    return {
      kind: 'loan',
      vehicleName,
      payment: active.payment,
      remainingBalance: active.remainingBalance,
      payoffDate: active.payoffDate,
      isDeferredInterest: active.isDeferredInterest,
    };
  }

  // Absent from `getActiveCarLoanPayments` means one of three things, and they are not the same
  // news. Missing dates and a future first payment are both "not started"; anything else got as
  // far as the schedule and came back with nothing owed.
  const start = carFund.payment_start_date;
  if (!carFund.loan_start_date || !start) {
    return { kind: 'loan_pending', vehicleName, paymentStartDate: start ?? null };
  }
  if (start > isoDay(asOf ?? new Date())) {
    return { kind: 'loan_pending', vehicleName, paymentStartDate: start };
  }
  return { kind: 'loan_paid', vehicleName };
}

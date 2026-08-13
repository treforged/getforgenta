// §1B Stage 6 — the dated obligations that are NOT recurring rules, in the shape §1A already asks about.
//
// WHY THIS FILE EXISTS. Bank Activity has always been able to LINK a charge to a payment plan or a
// vehicle charge — `pickablePlans` and `pickableCarCharges` are both live pickers — and has never
// once been able to SUGGEST one. So the app knew, on 2026-08-10, that Discover's `Paypal Pay in 4
// -99` and `-357` were the Cold Air Intake ($98.97) and the Exhaust ($356.86) instalments, both
// sitting in `payment_plans` on that very card, and still made the user find them in a dropdown.
//
// ⚠️ NOTHING HERE IS A SECOND MATCHER. Every obligation below is turned into a `ChargeToMatch` and
// handed to `matchCharge`, whose own header says it was shaped for exactly this: "Stage C's capture
// gates ask this question about things that are not rules at all — a car loan payment from a
// `car_funds` row, a card's minimum, an upfront-plan installment". Same four gates, same
// one-candidate-only rule, same silence on ambiguity.
//
// ⚠️ MATCHING RUNS FROM THE OBLIGATION SIDE, which is what makes it safe. One instalment can claim
// at most one charge, so the mirror ambiguity `bank-activity-queue.ts` has to guard against for
// ledger rows (three identical $10 tolls all pointing at one entry) cannot arise: two charges can
// never both be told they are the same instalment.

import { normalizePaymentSource, type ChargeToMatch, type MatchableTransaction, matchCharge } from './transaction-matching';
import { getPaymentDates, type PaymentPlanFrequency } from './payment-plan-generator';
import { getActiveCarLoanPayments } from './vehicle-loan-engine';
import type { CarFund } from './types';
import type { CarChargeKind } from './synced-transaction-review';

/**
 * The `payment_plans` fields this reads.
 *
 * Declared structurally rather than `Pick<PaymentPlan, …>` so a raw supabase row satisfies it:
 * `frequency` is a `string` on the generated table type and a union on `PaymentPlan`, and a Pick
 * would force every caller to cast a whole row to narrow one column.
 */
export interface ObligationPlan {
  id: string;
  name: string;
  payment_amount: number | string;
  frequency: string;
  /** `YYYY-MM-DD`. */
  start_date: string;
  total_payments: number;
  payment_source: string | null;
  active: boolean;
}

const PLAN_FREQUENCIES = new Set<string>(['weekly', 'biweekly', 'monthly']);

/** One dated thing the user owes, and which of the app's link destinations it belongs to. */
export interface ChargeObligation {
  /** Stable identity of this single instalment, for de-duping claims. */
  key: string;
  /** The question, in §1A's own shape. */
  charge: ChargeToMatch;
  /** A `payment_plans.id` — set iff this is a plan instalment. */
  planId?: string;
  /** A `car_funds.id` — set iff this is a vehicle charge. */
  carFundId?: string;
  /** Which of a vehicle's two monthly obligations. Set iff `carFundId` is. */
  carChargeKind?: CarChargeKind;
}

/**
 * Every instalment an active payment plan bills, as obligations.
 *
 * `getPaymentDates` is the same generator `getMonthlyPlanCashExpenses` projects the cash from, so a
 * suggestion can never point at an instalment the forecast does not believe in. Every date is
 * emitted rather than only past ones — `matchCharge`'s ±5 day window is what decides relevance, and
 * a second date filter here would be a second, weaker copy of that rule.
 *
 * INACTIVE PLANS ARE OUT, matching `pickablePlans`: a cancelled plan bills nothing a bank charge
 * could be settling. A plan whose instalments have all been paid stays in — its last instalment is
 * exactly the kind of charge still sitting undecided in the queue.
 */
export function paymentPlanObligations(plans: readonly ObligationPlan[]): ChargeObligation[] {
  const obligations: ChargeObligation[] = [];
  for (const plan of plans) {
    if (!plan.active) continue;
    const accountId = normalizePaymentSource(plan.payment_source);
    if (!accountId) continue;
    const amount = Math.abs(Number(plan.payment_amount));
    if (!Number.isFinite(amount) || amount === 0) continue;
    // `getPaymentDates` handles exactly these three; anything else stored in the column has no
    // schedule to generate and so yields no obligations rather than a guessed one.
    if (!PLAN_FREQUENCIES.has(plan.frequency)) continue;
    const dates = getPaymentDates(plan.start_date, plan.frequency as PaymentPlanFrequency, plan.total_payments);
    for (const dueDate of dates) {
      obligations.push({
        key: `plan:${plan.id}:${dueDate}`,
        planId: plan.id,
        charge: { accountId, amount, dueDate },
      });
    }
  }
  return obligations;
}

/** `YYYY-MM` → the mid-month `Date` every car-fund helper in this app uses as the month's
 *  representative day (`forecast-engine.ts:303`). The 15th, so no month-length or DST edge can
 *  move it into a neighbouring month. */
function midMonth(monthKey: string): Date {
  const [year, month] = monthKey.split('-').map(Number);
  return new Date(year, month - 1, 15);
}

/** `YYYY-MM` + a day-of-month, clamped into the month. */
function dueInMonth(monthKey: string, day: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `${monthKey}-${String(Math.min(Math.max(day, 1), lastDay)).padStart(2, '0')}`;
}

/** The day of the month an ISO date falls on, or null. */
function dayOf(date: string | null | undefined): number | null {
  if (!date) return null;
  const day = Number(date.slice(8, 10));
  return Number.isInteger(day) && day >= 1 ? day : null;
}

/**
 * The loan payment and the insurance premium each `phase='loan'` vehicle bills, per month.
 *
 * TWO OBLIGATIONS PER VEHICLE, NOT ONE — the same split `pickableCarCharges` offers and the engines
 * gate independently (`forecast-engine.ts:307` vs `:356`). Merging them would record a decision the
 * number-moving half could only disambiguate by comparing amounts.
 *
 * ⚠️ THE AMOUNT IS RE-DERIVED PER MONTH, not read off `actual_monthly_payment`.
 * `getActiveCarLoanPayments` is the authoritative figure the engines charge against cash: it
 * excludes lump sums (a separate debit at the bank, which would never post as one transaction with
 * the payment), it yields nothing before the loan starts or after it pays off, and it shrinks to the
 * true-up in the final month. Asked as of each month's own mid-point, it gives that month's real
 * payment rather than today's.
 *
 * ACCOUNTS follow `capture-evidence.ts`: `loan_payment_account`, whose documented null means "the
 * generic liquid-cash pool", so the caller's funding account is the fallback. Insurance is debited
 * from the same account — there is no separate column, and the engines make the same assumption.
 */
export function carChargeObligations(
  carFunds: readonly CarFund[],
  monthKeys: readonly string[],
  fundingAccountId: string | null = null,
): ChargeObligation[] {
  const obligations: ChargeObligation[] = [];
  const loanFunds = carFunds.filter(cf => cf.phase === 'loan');
  if (loanFunds.length === 0) return obligations;

  const accountOf = (cf: CarFund) => normalizePaymentSource(cf.loan_payment_account) ?? fundingAccountId;

  for (const monthKey of monthKeys) {
    const asOf = midMonth(monthKey);
    if (Number.isNaN(asOf.getTime())) continue;

    // The loan payment, for the vehicles whose loan was actually running that month.
    for (const payment of getActiveCarLoanPayments(carFunds as CarFund[], asOf)) {
      const cf = loanFunds.find(f => f.id === payment.carFundId);
      if (!cf) continue;
      const accountId = accountOf(cf);
      const payDay = dayOf(cf.payment_start_date);
      if (!accountId || payDay === null || payment.payment <= 0) continue;
      const dueDate = dueInMonth(monthKey, payDay);
      obligations.push({
        key: `car:${cf.id}:loan_payment:${dueDate}`,
        carFundId: cf.id,
        carChargeKind: 'loan_payment',
        charge: { accountId, amount: payment.payment, dueDate },
      });
    }

    // Insurance is an OWNERSHIP cost, so it is anchored to `insurance_start_date ?? loan_start_date`
    // and runs on past that anchor indefinitely — it outlives the loan, exactly as
    // `activeCarLoanInsuranceByMonth` models it. It is NOT gated on the loan still being active.
    for (const cf of loanFunds) {
      const premium = Number(cf.monthly_insurance || 0);
      const anchor = cf.insurance_start_date ?? cf.loan_start_date ?? null;
      const insuranceDay = dayOf(anchor);
      const accountId = accountOf(cf);
      if (premium <= 0 || !accountId || insuranceDay === null || !anchor) continue;
      const dueDate = dueInMonth(monthKey, insuranceDay);
      // A premium cannot settle before the policy starts. Compared as dates rather than months so a
      // mid-month start does not invent a charge for the days before it.
      if (dueDate < anchor.slice(0, 10)) continue;
      obligations.push({
        key: `car:${cf.id}:insurance:${dueDate}`,
        carFundId: cf.id,
        carChargeKind: 'insurance',
        charge: { accountId, amount: premium, dueDate },
      });
    }
  }
  return obligations;
}

/**
 * Which charge each obligation settles — obligation id → charge id, first claim kept.
 *
 * First-claim-wins mirrors `buildRuleSuggestionIndex`: a charge that satisfies two obligations is a
 * data problem (two plans billing the same amount on the same card in the same week), and quietly
 * showing the second would misattribute it. Later obligations simply find the charge taken.
 */
export function matchObligations(
  obligations: readonly ChargeObligation[],
  charges: readonly MatchableTransaction[],
): Map<string, ChargeObligation> {
  const byChargeId = new Map<string, ChargeObligation>();
  for (const obligation of obligations) {
    const match = matchCharge(obligation.charge, charges);
    if (match && !byChargeId.has(match.txn.id)) byChargeId.set(match.txn.id, obligation);
  }
  return byChargeId;
}

/**
 * What did this month actually cost, and how much of it was borrowing rather than spending?
 *
 * WHY THIS EXISTS (§2.4). The Dashboard built its expense aggregates straight off the transaction
 * stream, and that stream is `mergeWithGeneratedTransactions`, which expands **recurring rules
 * only** — never payment plans, never car loans, never vehicle insurance. /transactions builds its
 * stream from base + debt + reconciliations + plans + car loans, so the two pages disagreed by
 * $1,226/mo on real data. The engine-derived numbers (MONTH-END CASH, Safe to Pay, the floor) were
 * never wrong: they count those obligations as separate cash-chain terms. Only the stream
 * aggregates were, and they were wrong by omission, which is the worst kind — a tile that shows a
 * total it did not derive hides whatever it failed to model.
 *
 * WHY IT DOES NOT JUST MERGE THE GENERATORS. `generatePaymentPlanTransactions` filters only on
 * `!plan.active`, so it emits CC-sourced plans (already inside the card balance the engine pays
 * down) and installments already settled. `generateCarLoanTransactions` has no phase filter, so it
 * emits payments for saving-phase vehicles nobody has bought yet, and historical installments
 * anchored before `payment_start_date`. Merging either raw would replace an under-count with an
 * over-count. This module derives from the filtered paths instead — the plan predicate below and
 * `getActiveCarLoanPayments` — and ignores any plan/car rows a caller happens to pass in, so it is
 * safe against a stream that already contains them.
 *
 * CLASSIFICATION IS STRUCTURAL, NOT BY NAME. `expense-filtering.ts` decides what is a debt payment
 * by testing whether the category string contains 'debt' or 'credit card', which means renaming a
 * category silently moves a headline number. Here the `isDebtPayment` flag and the account type
 * decide, and nothing reads the display name.
 *
 * ACCOUNTING MODEL (Tre decision, 2026-08-06 — "Option B"): debt PRINCIPAL is not an expense,
 * interest is. A card is a payment method, so counting both the purchases made on it and the
 * payment made to it double-counts; paying principal down is net-worth-neutral. Hence two totals:
 * `expensesAllIn` (everything that left, the honest cash figure) and `expenses` (Option B).
 */

import { getPaymentDates, type PaymentPlan } from './payment-plan-generator';
import { getActiveCarLoanPayments } from './vehicle-loan-engine';
import type { CarFund } from './types';
import type { EnrichedTransaction } from './pay-schedule';

export type MonthlyExpenseModel = {
  /** Groceries, bills, gas, dining, vehicle insurance, checking-sourced plan installments. */
  living: number;
  /** Auto-loan interest for this month. Card interest joins this in Phase 2. */
  interest: number;
  /** Auto-loan principal. Net-worth-neutral, so Option B keeps it out of `expenses`. */
  principal: number;
  /**
   * Goal / investment contributions — money moved between two of the user's OWN accounts.
   *
   * ⚠️ LIVE AS OF §2.4 PHASE 2 (2026-08-19). This was pinned at 0 because "the stream does not
   * carry the originating rule_type"; `generateMonthTransactionsFromRules` now stamps
   * `isTransfer`, so it does. Contributions are held OUT of `living`, which is what stops a Roth
   * contribution from reading as an expense — and stopped the Dashboard's "Annual Savings" tile
   * from going DOWN the more the user saved.
   *
   * ⚠️ GENERATED ROWS ONLY, and that limit is real: a transfer someone typed by hand carries no
   * rule_type and stays in `living`. Better than the zero it replaces, not yet complete. Widening
   * it means linking a recorded row back to its rule (§1B), not guessing from the category name —
   * category strings are user-editable, and this module's own header forbids classifying by name.
   */
  transfers: number;
  /**
   * The EXPENSE view: sums to `expenses`, so SPENDING BY CATEGORY and the headline tile cannot
   * disagree. Debt principal is absent by construction — an auto loan appears here as
   * `Auto Loan Interest` only, since paying principal is not spending.
   */
  byCategory: Record<string, number>;
  /**
   * The CASH view: sums to `expensesAllIn`, adding an `Auto Loan Principal` row. For surfaces that
   * report money that left the account rather than money that was spent (the all-in PDF export,
   * the month-0 snapshot's `spentSoFar`).
   */
  byCategoryAllIn: Record<string, number>;
  /** Option B headline: living + interest. */
  expenses: number;
  /**
   * Everything that actually left the account — debt principal AND contributions included.
   *
   * ⚠️ ITS VALUE IS UNCHANGED BY PHASE 2, deliberately. Contributions moved out of `living` and
   * are added back here, so every caller reporting "cash that left" (the month-0 snapshot, the
   * cash flow chart, the PDF) sees exactly the dollars it saw before. Only `expenses` moved.
   * Note this is therefore NO LONGER `expenses + principal`; writing it that way would silently
   * drop the contributions back out.
   */
  expensesAllIn: number;
  /** interest + principal. */
  debtService: number;
  /** Emergency-runway burn rate. Identical to `expensesAllIn` — kept as its own name because the
   *  question it answers ("what does a month cost me in cash") is not the same question. */
  cashOut: number;
};

export type MonthlyExpenseInput = {
  /** Transactions already narrowed to the month in question. */
  monthTxns: EnrichedTransaction[];
  paymentPlans: PaymentPlan[];
  carFunds: CarFund[];
  /**
   * Credit-card account ids in BOTH the bare and `account:`-prefixed forms, because
   * `payment_plans.payment_source` is stored prefixed while account ids are not.
   */
  creditCardSourceIds: Set<string>;
  /** The day being reported on. Its calendar month is the month modelled. */
  asOf: Date;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Card payments are accounted for separately; plan and car rows are derived, not read. */
function isDerivedElsewhere(t: EnrichedTransaction): boolean {
  return Boolean(t.isDebtPayment || t.isPlanPayment || t.isCarLoanPayment);
}

export function buildMonthlyExpenseModel(input: MonthlyExpenseInput): MonthlyExpenseModel {
  const { monthTxns, paymentPlans, carFunds, creditCardSourceIds, asOf } = input;
  const year = asOf.getFullYear();
  const month = asOf.getMonth();

  // Two views of the same rows. `add` writes to both (spend is also cash); `addPrincipalOnly`
  // writes to the cash view alone, which is what keeps each map summing to its own headline.
  const byCategory: Record<string, number> = {};
  const byCategoryAllIn: Record<string, number> = {};
  const bump = (target: Record<string, number>, category: string, amount: number) => {
    if (amount <= 0) return;
    const key = category || 'Other';
    target[key] = round2((target[key] ?? 0) + amount);
  };
  const add = (category: string, amount: number) => {
    bump(byCategory, category, amount);
    bump(byCategoryAllIn, category, amount);
  };
  // Both write to the CASH view only: principal and contributions are money that left the account
  // without being spent, so they belong in `byCategoryAllIn` and never in the expense view.
  const addPrincipalOnly = (category: string, amount: number) => bump(byCategoryAllIn, category, amount);
  const addTransferOnly = (category: string, amount: number) => bump(byCategoryAllIn, category, amount);

  let living = 0;
  let interest = 0;
  let principal = 0;
  let transfers = 0;

  for (const t of monthTxns) {
    if (t.type !== 'expense') continue;
    if (isDerivedElsewhere(t)) continue;
    const amount = Number(t.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    // §2.4 Phase 2 — a contribution to your own savings or investment account is not spending.
    if (t.isTransfer) {
      transfers = round2(transfers + amount);
      addTransferOnly(t.category, amount);
      continue;
    }
    living = round2(living + amount);
    add(t.category, amount);
  }

  // Plans. Same predicate as getMonthlyPlanCashExpenses (inactive out, CC-sourced out) but
  // deliberately WITHOUT its sync-cutoff filter: that function answers "how much cash is still to
  // leave this month", and this one answers "what did the whole month cost".
  for (const plan of paymentPlans) {
    if (!plan.active) continue;
    if (plan.payment_source && creditCardSourceIds.has(plan.payment_source)) continue;
    const amount = Number(plan.payment_amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    for (const date of getPaymentDates(plan.start_date, plan.frequency, plan.total_payments)) {
      const d = new Date(date + 'T00:00:00');
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;
      living = round2(living + amount);
      add(plan.category, amount);
    }
  }

  // Car loans. getActiveCarLoanPayments already drops saving-phase vehicles, loans whose payments
  // have not started, and paid-off loans — the three things generateCarLoanTransactions does not.
  for (const loan of getActiveCarLoanPayments(carFunds, asOf)) {
    interest = round2(interest + loan.interest);
    principal = round2(principal + loan.principal);
    // Option B split. /transactions still shows the single $422.89 row it always has — that is the
    // cash leaving, and byCategoryAllIn reproduces it. What changes is that the EXPENSE view no
    // longer calls the principal an expense.
    add('Auto Loan Interest', loan.interest);
    addPrincipalOnly('Auto Loan Principal', loan.principal);
  }

  // Vehicle insurance is a real recurring cost of owning the car, not debt service. Only an owned
  // (loan-phase) vehicle is insured; a car still being saved for is not.
  const monthEnd = new Date(year, month + 1, 0);
  for (const cf of carFunds) {
    if (cf.phase !== 'loan') continue;
    const premium = Number(cf.monthly_insurance || 0);
    if (!Number.isFinite(premium) || premium <= 0) continue;
    const startStr = cf.insurance_start_date ?? cf.payment_start_date;
    if (startStr && new Date(startStr + 'T00:00:00') > monthEnd) continue;
    living = round2(living + premium);
    add('Insurance', premium);
  }

  const expenses = round2(living + interest);
  // ⚠️ NOT `expenses + principal`. Contributions were taken out of `living` above and have to be
  // added back for the cash view, or every "what left the account" surface under-reports them.
  const expensesAllIn = round2(living + interest + principal + transfers);

  return {
    living,
    interest,
    principal,
    transfers,
    byCategory,
    byCategoryAllIn,
    expenses,
    expensesAllIn,
    debtService: round2(interest + principal),
    cashOut: expensesAllIn,
  };
}

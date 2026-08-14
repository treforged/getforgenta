// N7 — turning a ledger expense into a payment plan. Pure, no I/O.
//
// ⚠️ A CONVERSION DELETES THE SOURCE ROW. `payment_plans` projects its own installment rows into the
// same stream via `generatePaymentPlanTransactions`, so a plan built from a transaction that stays
// behind double-counts the expense across Dashboard, Forecast and Debt Payoff at once.
//
// That is why this is an INTENT and not a builder, the same shape as `planLedgerImport`: "may this
// row be converted at all" and "what plan would it be" are one decision, and a caller that checks
// one and forgets the other is exactly how the double-count gets back in. Anything the ledger did
// not store as a real expense row — a generated recurring occurrence, a debt/plan/car-loan
// projection, a reconciliation, income — has no row to delete, so converting it can only add money.

import { CATEGORIES } from '@/lib/types';
import type { PaymentPlanFrequency } from '@/lib/payment-plan-generator';

/** The fields of a ledger row a conversion reads. Structural, so tests need no DB row. */
export interface TransactionForPlanConversion {
  id: string;
  date: string;
  type: string;
  amount: number;
  category: string;
  note?: string | null;
  isGenerated?: boolean;
  isReconciliation?: boolean;
}

/**
 * The payment-plan form state a conversion would pre-fill. Field-for-field the page's
 * `emptyPlanForm`, so the draft can be handed straight to `setPlanForm`.
 */
export interface PaymentPlanFormDraft {
  name: string;
  provider: string;
  total_amount: string;
  frequency: PaymentPlanFrequency;
  start_date: string;
  total_payments: string;
  category: string;
  payment_source: string;
  plan_type: 'upfront' | 'monthly_charge';
  notes: string;
}

export interface PlanConversionContext {
  /**
   * The row's payment source, already normalized to the `account:ID` spelling the plan form's
   * select offers. The two fields hold the same value space, so it carries over verbatim — but
   * only the page knows the account map, so normalizing is not this function's job.
   */
  paymentSource: string | null | undefined;
}

export type PlanConversionIntent =
  | { ok: true; draft: PaymentPlanFormDraft }
  | { ok: false; reason: string };

/**
 * The plan form's category select is built from `CATEGORIES`, which excludes `Income` and knows
 * nothing about synthetic labels like `Balance Adjustment`. A value outside that list would render
 * the select blank, so an unrecognized category falls back to the form's own default rather than
 * being silently written through.
 */
const DEFAULT_PLAN_CATEGORY = 'Shopping';

/**
 * Whether this ledger row may become a payment plan, and if so exactly which draft.
 *
 * Returns a reason rather than throwing, because every `false` here is an ordinary state — most
 * rows on the page are not convertible, and that is why the button is absent, not an incident.
 */
export function planDraftFromTransaction(
  txn: TransactionForPlanConversion,
  ctx: PlanConversionContext,
): PlanConversionIntent {
  if (txn.isReconciliation) {
    return { ok: false, reason: 'A balance adjustment is a correction, not a purchase.' };
  }

  // A generated occurrence has no stored row to delete. Converting one would leave the recurring
  // rule projecting it forever alongside the plan's installments.
  if (txn.isGenerated) {
    return { ok: false, reason: 'This comes from a recurring rule — edit the rule instead.' };
  }

  // Every synthetic row this page merges in (`gen:`, `debt:`, `plan:`, `car:`, `recon:`) carries a
  // composite id. Only a bare `transactions.id` names a row `remove` can delete.
  if (!txn.id || txn.id.includes(':')) {
    return { ok: false, reason: 'This row is projected, not a saved transaction.' };
  }

  if (txn.type !== 'expense') {
    return { ok: false, reason: 'Only an expense can be split into payments.' };
  }

  // PostgREST returns `numeric` as a string, so this must not assume a JS number. The ledger stores
  // direction in `type` and the plan stores a positive total, hence the abs().
  const amount = Number(txn.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    return { ok: false, reason: 'This transaction has no usable amount.' };
  }

  const category = (CATEGORIES as readonly string[]).includes(txn.category)
    ? txn.category
    : DEFAULT_PLAN_CATEGORY;

  return {
    ok: true,
    draft: {
      name: txn.note?.trim() || 'Transaction',
      provider: '',
      total_amount: String(Math.abs(amount)),
      frequency: 'monthly',
      start_date: txn.date,
      // Deliberately blank. Nothing on a transaction says how many installments the user agreed
      // to, and a guessed count would silently reshape the amount they see per payment. The form's
      // existing "Total Payments *" validation makes them state it.
      total_payments: '',
      category,
      payment_source: ctx.paymentSource ?? '',
      plan_type: 'upfront',
      notes: '',
    },
  };
}

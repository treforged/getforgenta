// §1B Stage 3 — turning a synced bank charge into a ledger row. Pure, no I/O.
//
// ⚠️ THIS IS THE FIRST §1B CODE THAT CREATES MONEY. `public.transactions` is read by twelve
// surfaces including `useForecastEngineInputs` and `CardProjectionContext`, so a row written there
// moves projected numbers across Dashboard, Forecast, Debt Payoff, Vehicles and the AI Advisor at
// once — while `recurring_rules` already projects the same bills.
//
// That is why `planLedgerImport` is a PLAN and not a builder: the decision "may this be imported at
// all" and the decision "what row would it be" are the same decision, and splitting them is how the
// double-count gets reintroduced by a caller that checks one and forgets the other. Tre's
// "otherwise it adds a transaction if the user says it doesn't match anything" is load-bearing.

import { suggestCategory, isValidCategory } from '@/lib/plaid-category-map';

/** The fields of a synced transaction an import reads. Structural, so tests need no DB row. */
export interface SyncedTransactionForImport {
  id: string;
  account_id: string | null;
  amount: number;
  date: string;
  name: string | null;
  merchant_name: string | null;
  category: string | null;
}

/** The ledger row an import would write. Shaped for `public.transactions`. */
export interface LedgerDraft {
  date: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  account: string;
  note: string;
  payment_source: string;
  origin: 'synced';
}

export interface ImportContext {
  /** The REAL `accounts.name` for this charge's account. Never a copied or defaulted label. */
  accountName: string | null | undefined;
  /** The user's category correction, if they made one. */
  categoryOverride: string | null | undefined;
  /** Whether the matcher offered a rule or ledger suggestion for this charge. */
  hasSuggestion: boolean;
  /** The user's existing decision on this charge, if any. */
  review: { status: string } | null | undefined;
}

export type ImportPlan =
  | { ok: true; draft: LedgerDraft }
  | { ok: false; reason: string };

/** Statuses that mean the charge is already accounted for. `'categorized'` is deliberately absent. */
const BLOCKING_STATUSES: ReadonlySet<string> = new Set(['linked_rule', 'linked_txn', 'imported', 'ignored']);

/**
 * Whether this synced charge may become a ledger row, and if so exactly which row.
 *
 * Returns a reason rather than throwing, because every `false` here is a sentence the UI shows a
 * person — "this already matches something you track" is the explanation for why the button is
 * missing, and a thrown error would turn a normal state into an incident.
 */
export function planLedgerImport(txn: SyncedTransactionForImport, ctx: ImportContext): ImportPlan {
  if (ctx.review && BLOCKING_STATUSES.has(ctx.review.status)) {
    return { ok: false, reason: 'You have already dealt with this charge.' };
  }

  // THE double-count guard. Import exists only for charges nothing else in the app describes.
  if (ctx.hasSuggestion) {
    return { ok: false, reason: 'This already matches something you track — linking it keeps the numbers right.' };
  }

  // `transactions.account` is a dead legacy free-text label reading "Checking" on every live row,
  // including ones paid by credit card, and `useTransactions().add` coerces a falsy account to that
  // same literal. So an unresolvable account refuses rather than inheriting the lie.
  const accountName = ctx.accountName?.trim();
  if (!txn.account_id || !accountName) {
    return { ok: false, reason: 'That account is not connected here yet.' };
  }

  // Stage A's convention is OUTFLOW-POSITIVE; the ledger stores a positive amount and puts direction
  // in `type`. PostgREST returns `numeric` as a string, so this must not assume a JS number.
  const signed = Number(txn.amount);
  if (!Number.isFinite(signed) || signed === 0) {
    return { ok: false, reason: 'This charge has no usable amount.' };
  }

  const override = ctx.categoryOverride;
  const category = override && isValidCategory(override) ? override : suggestCategory(txn.category);

  return {
    ok: true,
    draft: {
      date: txn.date,
      type: signed < 0 ? 'income' : 'expense',
      amount: Math.abs(signed),
      category,
      account: accountName,
      note: txn.merchant_name || txn.name || '',
      // The `account:`-prefixed spelling every live ledger row uses. The card and forecast source
      // sets accept both spellings, but writing the bare uuid here would diverge from all 22 rows.
      payment_source: `account:${txn.account_id}`,
      origin: 'synced',
    },
  };
}

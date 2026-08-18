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
  /**
   * The car build item this purchase was FOR, when the user said so — Tre, 2026-08-18, on the
   * Lowered Empire steering wheel: *"why cant i choose to connect to an existing transaction?"*
   *
   * ⚠️ A BUILD ITEM IS NOT A LINK DESTINATION, and this is why it does not need to be. The four
   * review link kinds all point at something that BILLS — a rule, a plan, a vehicle charge, an
   * entry — and a build part bills nothing; it is a purchase. So the honest shape is the one the
   * ledger already has: the charge becomes a real entry, and that entry carries the build item, on
   * the column `transactions.car_build_item_id` the Garage already reads. No new review status, no
   * migration, and the Garage shows the item as paid because it is looking at the same row.
   *
   * Undefined on every ordinary import; `planLedgerImport` never sets it. It is attached at the
   * call site by the picker, because "this was a build part" is the user's assertion, not the
   * importer's inference.
   */
  car_build_item_id?: string | null;
}

export interface ImportContext {
  /** The REAL `accounts.name` for this charge's account. Never a copied or defaulted label. */
  accountName: string | null | undefined;
  /** The user's category correction, if they made one. */
  categoryOverride: string | null | undefined;
  /** Whether the matcher offered a rule or ledger suggestion for this charge. */
  hasSuggestion: boolean;
  /**
   * The user pressed "Not this" — they looked at the suggestion and overruled the matcher.
   *
   * ⚠️ THIS IS THE ONE THING THAT DEFEATS THE DOUBLE-COUNT GUARD, and it is a named field rather
   * than "stop passing `hasSuggestion`" on purpose: at the call site it must read as a person
   * overruling a guess, not as the guard having been forgotten. Tre's decision (2026-08-09) — a
   * rejection has to LAND somewhere ("match to a different transaction, or have it be its own new
   * transaction"), and one of the three places it can land is a new ledger row.
   */
  suggestionRejected?: boolean;
  /**
   * §1B TRANSFER PAIRS — this charge is one LEG of a movement between two accounts the user owns.
   *
   * ⚠️ THIS REFUSAL OUTRANKS `suggestionRejected`, and that ordering is the whole point. Every other
   * refusal here says "something else already describes this charge", and the user overruling it is
   * a legitimate correction. This one says something different: a transfer leg is not an expense and
   * not income, so there is NO ledger row that would be right. Importing the outflow books a
   * transfer as spending; importing the inflow books it as income; importing both does each. That is
   * not a double-count the user can resolve by choosing better — it is a category error, so the
   * button is withheld rather than argued with.
   *
   * The pairing itself is derived and can be wrong, which is why this is a named input from a caller
   * that has actually run `detectTransferPairs`, and why that detector refuses to pair on any
   * ambiguity. A wrongly withheld button costs one un-imported row; a wrongly offered one puts money
   * that never left the user's net worth into twelve surfaces.
   */
  isTransferLeg?: boolean;
  /**
   * EVERY decision the user has already recorded about this charge — none, one, or several.
   *
   * ⚠️ A SET SINCE SPLIT LINK (Slice C), and it had to become one. A charge may now hold N link rows
   * beside its exclusive row, so asking about "the" review would pick one of them and let the other
   * N-1 blocking decisions through — importing a charge that is already linked to a rule is the
   * double-count this whole guard exists to prevent, reached by reading only part of the answer.
   */
  reviews: readonly { status: string }[] | null | undefined;
}

export type ImportPlan =
  | { ok: true; draft: LedgerDraft }
  | { ok: false; reason: string };

/**
 * Statuses that mean the charge is already accounted for. `'categorized'` is deliberately absent —
 * correcting a label takes no position on whether the charge was handled.
 *
 * ⚠️ `'linked_plan'` and `'linked_car'` were missing here until Slice C, and adding them can only
 * REFUSE imports that were previously allowed. Both were unreachable in practice — `BankActivity`
 * hides every action once `isHandledReview` is true, and that set has always included them — so this
 * closes a gap between two lists that were supposed to agree rather than changing what any button
 * does. A plan instalment is projected from `payment_plans` and a car charge from the vehicle
 * engines, so importing one is the same double-count as importing a linked rule.
 */
const BLOCKING_STATUSES: ReadonlySet<string> =
  new Set(['linked_rule', 'linked_txn', 'imported', 'ignored', 'linked_plan', 'linked_car']);

/**
 * Whether this synced charge may become a ledger row, and if so exactly which row.
 *
 * Returns a reason rather than throwing, because every `false` here is a sentence the UI shows a
 * person — "this already matches something you track" is the explanation for why the button is
 * missing, and a thrown error would turn a normal state into an incident.
 */
export function planLedgerImport(txn: SyncedTransactionForImport, ctx: ImportContext): ImportPlan {
  if (ctx.reviews?.some(r => BLOCKING_STATUSES.has(r.status))) {
    return { ok: false, reason: 'You have already dealt with this charge.' };
  }

  // Checked BEFORE the suggestion guard so that "Not this" cannot reach it. See `isTransferLeg`.
  if (ctx.isTransferLeg) {
    return {
      ok: false,
      reason: 'This is one half of a movement between your own accounts, so it is neither income nor spending.',
    };
  }

  // THE double-count guard. Import exists only for charges nothing else in the app describes —
  // unless the user has explicitly rejected the suggestion, which is them telling us the match was
  // wrong and this charge is in fact its own event.
  if (ctx.hasSuggestion && !ctx.suggestionRejected) {
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

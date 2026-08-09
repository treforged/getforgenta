// §1B Stage 2 — the rules about a user's decision on a synced transaction. Pure, no I/O.
//
// Separate from the hook that writes them so they can be tested without a Supabase client, and
// because one of them is a rule the DATABASE DELIBERATELY DOES NOT ENFORCE (see
// `validateReviewInput`) — which makes it exactly the kind of rule that must not live only in a
// button's onClick.

/**
 * `'categorized'` asserts NOTHING about whether the charge was handled — it means only "the user
 * corrected the label". See `20260809_synced_transaction_reviews_categorized.sql` for why a fifth
 * value exists: without it, fixing a wrong auto-category would force the user to also declare the
 * charge linked or dismissed, and the auto-category is wrong often by construction.
 */
export type ReviewStatus =
  | 'linked_rule' | 'linked_txn' | 'imported' | 'ignored' | 'categorized' | 'linked_plan'
  | 'linked_car';

/** Statuses meaning the user has dealt with this charge. Deliberately excludes `'categorized'`. */
const HANDLED_STATUSES: ReadonlySet<string> =
  new Set(['linked_rule', 'linked_txn', 'imported', 'ignored', 'linked_plan', 'linked_car']);

/**
 * §1B Stage 4B — WHICH of a vehicle's two monthly obligations a charge settled.
 *
 * Every `phase='loan'` car fund bills a loan payment AND an insurance premium, usually from the same
 * account in the same month, and the two are gated independently in the engines. Naming only the
 * fund would leave the number-moving half to guess between them by amount — the heuristic §1A
 * demoted — so the user's choice of destination is recorded instead of inferred.
 */
export type CarChargeKind = 'loan_payment' | 'insurance';

/**
 * Whether a review row represents a charge the user has dealt with.
 *
 * Absence of a review means UNREVIEWED, and unreviewed means nothing at all — with all history in
 * scope most rows are permanently unreviewed by design, so no caller may read `false` here as
 * "this did not happen".
 */
export function isHandledReview(review: { status: string } | null | undefined): boolean {
  return !!review && HANDLED_STATUSES.has(review.status);
}

/** What a caller supplies to record a decision. `user_id` is the hook's to set, never the caller's. */
export interface ReviewInput {
  synced_transaction_id: string;
  status: ReviewStatus;
  rule_id?: string | null;
  transaction_id?: string | null;
  /** §1B Stage 4C — the payment plan this charge paid an instalment of. */
  payment_plan_id?: string | null;
  /** §1B Stage 4B — the vehicle this charge belongs to. Meaningless without `car_charge_kind`. */
  car_fund_id?: string | null;
  /** §1B Stage 4B — which of that vehicle's two monthly obligations it settled. */
  car_charge_kind?: CarChargeKind | null;
  /** `YYYY-MM` — WHICH occurrence of a monthly rule, plan or vehicle charge this settles. */
  occurrence_month?: string | null;
  category_override?: string | null;
}

/**
 * A user-facing reason this decision would be meaningless to read back, or null if it is sound.
 *
 * ⚠️ THE RULE THIS EXISTS FOR: "a freshly created `linked_rule` names a rule" — and, since Stages 4C
 * and 4B, the identical rule for `linked_plan` and `linked_car`. That CHECK is deliberately ABSENT
 * from the migrations, and the reason is subtle enough to be worth restating — `rule_id`,
 * `payment_plan_id` and `car_fund_id` are all `ON DELETE SET NULL`, `SET NULL` fires an UPDATE on the
 * referencing row, and Postgres evaluates CHECK constraints on UPDATE. A constraint of that shape
 * would therefore make *deleting a rule, a payment plan or a vehicle* fail with a constraint
 * violation instead of doing what the user asked.
 *
 * So the degraded state (`linked_rule` with a null `rule_id`, `linked_plan` with a null
 * `payment_plan_id`, `linked_car` with a null `car_fund_id`) is legitimate and means "handled, but
 * the thing it named is gone"; what is illegitimate is CREATING one that way. That distinction
 * cannot be expressed as a CHECK, which is precisely why it is enforced here and pinned by tests.
 *
 * Every other rule below is also enforced by the database. They are repeated here to fail with a
 * sentence the user can act on rather than a Postgres constraint name.
 */
export function validateReviewInput(input: ReviewInput): string | null {
  const { status, rule_id, transaction_id, payment_plan_id, car_fund_id, car_charge_kind, occurrence_month } = input;
  if (!input.synced_transaction_id) return 'Missing transaction';
  if (status === 'linked_rule') {
    if (!rule_id) return 'A rule link needs a rule';
    if (!occurrence_month) return 'A rule link needs the month it settles';
  }
  // A plan bills every month, so the link is as meaningless without its occurrence as a rule's is.
  if (status === 'linked_plan') {
    if (!payment_plan_id) return 'A plan link needs a payment plan';
    if (!occurrence_month) return 'A plan link needs the month it settles';
  }
  // A vehicle bills a loan payment AND an insurance premium every month, so a car link needs BOTH
  // which vehicle and which of its two charges — naming only the fund would leave the two
  // independently-gated obligations indistinguishable — plus the month, like every recurring link.
  if (status === 'linked_car') {
    if (!car_fund_id) return 'A vehicle link needs a vehicle';
    if (!car_charge_kind) return 'A vehicle link needs to say which charge it paid';
    if (!occurrence_month) return 'A vehicle link needs the month it settles';
  }
  if ((status === 'linked_txn' || status === 'imported') && !transaction_id) {
    return 'That status needs a ledger entry';
  }
  if (
    (status === 'ignored' || status === 'categorized')
    && (rule_id || transaction_id || payment_plan_id || car_fund_id || car_charge_kind)
  ) {
    return 'That status cannot stay linked to a rule, plan, vehicle or entry';
  }
  // A kind without a fund claims a vehicle obligation with no vehicle. Rejected on ANY status, not
  // just `linked_car`, so it can never reach the row through some other path.
  if (car_charge_kind && !car_fund_id) return 'A vehicle charge needs a vehicle';
  if (occurrence_month && !/^\d{4}-\d{2}$/.test(occurrence_month)) return 'Bad month';
  return null;
}

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
export type ReviewStatus = 'linked_rule' | 'linked_txn' | 'imported' | 'ignored' | 'categorized';

/** Statuses meaning the user has dealt with this charge. Deliberately excludes `'categorized'`. */
const HANDLED_STATUSES: ReadonlySet<string> = new Set(['linked_rule', 'linked_txn', 'imported', 'ignored']);

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
  /** `YYYY-MM` — WHICH occurrence of a monthly rule this charge settles. */
  occurrence_month?: string | null;
  category_override?: string | null;
}

/**
 * A user-facing reason this decision would be meaningless to read back, or null if it is sound.
 *
 * ⚠️ THE RULE THIS EXISTS FOR: "a freshly created `linked_rule` names a rule". That CHECK is
 * deliberately ABSENT from the migration, and the reason is subtle enough to be worth restating —
 * `rule_id` is `ON DELETE SET NULL`, `SET NULL` fires an UPDATE on the referencing row, and Postgres
 * evaluates CHECK constraints on UPDATE. A constraint of that shape would therefore make *deleting a
 * rule* fail with a constraint violation instead of doing what the user asked.
 *
 * So the degraded state (`linked_rule` with a null `rule_id`) is legitimate and means "handled, but
 * the rule is gone"; what is illegitimate is CREATING one that way. That distinction cannot be
 * expressed as a CHECK, which is precisely why it is enforced here and pinned by tests.
 *
 * Every other rule below is also enforced by the database. They are repeated here to fail with a
 * sentence the user can act on rather than a Postgres constraint name.
 */
export function validateReviewInput(input: ReviewInput): string | null {
  const { status, rule_id, transaction_id, occurrence_month } = input;
  if (!input.synced_transaction_id) return 'Missing transaction';
  if (status === 'linked_rule') {
    if (!rule_id) return 'A rule link needs a rule';
    if (!occurrence_month) return 'A rule link needs the month it settles';
  }
  if ((status === 'linked_txn' || status === 'imported') && !transaction_id) {
    return 'That status needs a ledger entry';
  }
  if ((status === 'ignored' || status === 'categorized') && (rule_id || transaction_id)) {
    return 'That status cannot stay linked to a rule or entry';
  }
  if (occurrence_month && !/^\d{4}-\d{2}$/.test(occurrence_month)) return 'Bad month';
  return null;
}

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
 * §1B SPLIT LINK — the statuses of which a charge may hold SEVERAL at once.
 *
 * One bank debit routinely settles more than one obligation: Tre's rent charge pays Rent, Internet
 * and Smart Home for THIS month and the Water/Sewer/Trash rider for the PREVIOUS one (billed in
 * arrears). Each of those is its own link row with its own `occurrence_month`, which is why split
 * link is modelled as N rows rather than a child table — the month must be per-link, and each row
 * already carries one.
 *
 * ⚠️ THIS LIST IS THE PREDICATE OF THE DATABASE'S PARTIAL UNIQUE INDEX
 * (`unique (synced_transaction_id) where status not in (…)`). If a status is added here it must be
 * added there in the same change, or the two disagree about how many decisions a charge may hold.
 */
export const LINK_STATUSES: ReadonlySet<string> = new Set(['linked_rule', 'linked_plan', 'linked_car']);

/**
 * Is this a row a charge may hold several of?
 *
 * Its negation is "the EXCLUSIVE row" — the at-most-one decision per charge that carries import
 * idempotency (`'imported'`), dismissal (`'ignored'`), a ledger pointer (`'linked_txn'`) or a label
 * correction (`'categorized'`), and, by the 2026-08-09 decision, `category_override`.
 */
export function isLinkStatus(status: string | null | undefined): boolean {
  return !!status && LINK_STATUSES.has(status);
}

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
  /**
   * `YYYY-MM-DD` — WHICH occurrence of a WEEKLY or BIWEEKLY rule, refining `occurrence_month`.
   *
   * Optional, and null is legitimate rather than degraded: a rule that bills nothing in the charge's
   * month has no occurrence to name, and every review written before the column existed has none.
   * The read side falls back to month-keying, which for a monthly rule is the same answer.
   */
  occurrence_date?: string | null;
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
  const {
    status, rule_id, transaction_id, payment_plan_id, car_fund_id, car_charge_kind,
    occurrence_month, occurrence_date,
  } = input;
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
  // §1B SPLIT LINK — ONE ROW NAMES ONE THING.
  //
  // Before split link this was merely tidy; under N rows per charge it is load-bearing. Each link
  // row occupies a slot in exactly one of the three dedupe indexes
  // (`(txn, rule_id)`, `(txn, payment_plan_id)`, `(txn, car_fund_id, car_charge_kind)`), so a row
  // carrying two ids would occupy two of them and "link the same thing twice" would stop being
  // detectable. It would also be ambiguous to every reader: `buildConfirmedOccurrences` keys on
  // `rule_id` alone and would suppress a rule occurrence on a row the user created to name a plan.
  if (isLinkStatus(status)) {
    const named = [
      status !== 'linked_rule' && rule_id ? 'a rule' : null,
      status !== 'linked_plan' && payment_plan_id ? 'a payment plan' : null,
      status !== 'linked_car' && car_fund_id ? 'a vehicle' : null,
    ].filter(Boolean);
    if (named.length > 0) return `A link names one thing, and this one also names ${named[0]}`;
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
  // A date outside the month it refines would suppress an occurrence in one month while every
  // month-scoped read counted the row in another — the two columns asserting different things about
  // the same charge. The database rejects it too; this fails with a sentence instead of a
  // constraint name.
  if (occurrence_date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurrence_date)) return 'Bad occurrence date';
    if (!occurrence_month) return 'An occurrence date needs the month it settles';
    if (occurrence_date.slice(0, 7) !== occurrence_month) return 'That occurrence is in another month';
  }
  return null;
}

/**
 * The fields that decide WHICH of a charge's rows a decision is about.
 *
 * Structural rather than the generated row type so the routing below can be handed either a stored
 * row or an unsaved `ReviewInput` — they are the same question asked of the same five columns, and
 * two overloads would be two chances for them to answer differently.
 */
export interface TargetableReview {
  status: string;
  rule_id?: string | null;
  payment_plan_id?: string | null;
  car_fund_id?: string | null;
  car_charge_kind?: string | null;
}

/**
 * What one link row occupies in the dedupe space. Null for the exclusive row, which has no target.
 *
 * ⚠️ THIS IS THE KEY OF THE THREE DEDUPE INDEXES, so it must stay in step with them:
 * `(txn, rule_id)`, `(txn, payment_plan_id)`, `(txn, car_fund_id, car_charge_kind)`. It is also what
 * makes "link another" an INSERT and "change your mind about this link" an UPDATE — see
 * `findReviewRowFor`.
 */
export function linkTarget(input: TargetableReview): string | null {
  if (input.status === 'linked_rule') return `rule:${input.rule_id}`;
  if (input.status === 'linked_plan') return `plan:${input.payment_plan_id}`;
  if (input.status === 'linked_car') return `car:${input.car_fund_id}:${input.car_charge_kind}`;
  return null;
}

/**
 * §1B SPLIT LINK Slice C — the EXCLUSIVE row of a charge, or undefined.
 *
 * The at-most-one decision a charge may hold about ITSELF rather than about one of the things it
 * paid: import idempotency (`'imported'`), dismissal (`'ignored'`), a ledger pointer
 * (`'linked_txn'`), a label correction (`'categorized'`) — and, by Tre's 2026-08-09 decision,
 * `category_override`, which lives here and nowhere else.
 */
export function findExclusiveReview<T extends TargetableReview>(rows: readonly T[]): T | undefined {
  return rows.find(r => !isLinkStatus(r.status));
}

/**
 * §1B SPLIT LINK Slice C — the row a decision should be written to, or undefined to INSERT a new one.
 *
 * ⚠️ THIS FUNCTION IS WHAT MAKES SPLIT LINK A FEATURE RATHER THAN A DATA LOSS BUG. Before it, every
 * write found the charge's one row and updated it, so a second link would have overwritten the
 * first — the user would press "link another", watch the first badge vanish, and have no way to tell
 * that the app had discarded a decision rather than added one.
 *
 * The routing is also what ENFORCES two of the three set rules structurally instead of by validation:
 * an exclusive decision always lands on the exclusive row, so a charge cannot acquire a second one;
 * and a link always lands on the row with the SAME target, so the same rule, plan or vehicle charge
 * cannot be linked twice. `validateReviewSet` still runs on the result — a rule enforced in two
 * places is a rule that survives one of them being edited.
 */
export function findReviewRowFor<T extends TargetableReview>(
  rows: readonly T[],
  input: TargetableReview,
): T | undefined {
  const target = linkTarget(input);
  if (!target) return findExclusiveReview(rows);
  return rows.find(r => linkTarget(r) === target);
}

/**
 * §1B SPLIT LINK — a user-facing reason this WHOLE SET of decisions about ONE charge is unsound.
 *
 * The per-row rules in `validateReviewInput` cannot see the set, and every rule split link relaxes
 * or adds is a rule ABOUT the set: how many exclusive decisions a charge may hold, whether the same
 * thing is linked twice, and where the category lives. So this is a second entry point rather than
 * an argument to the first, and callers writing several rows at once must run BOTH.
 *
 * Each rule below mirrors a partial unique index, so the user gets a sentence instead of a Postgres
 * constraint name — the same division of labour `validateReviewInput` already documents.
 *
 * ⚠️ `category_override` ON A LINK ROW IS REJECTED HERE AND NOT IN `validateReviewInput`, and that
 * asymmetry is deliberate rather than an oversight. Tre decided on 2026-08-09 that the override
 * lives on the EXCLUSIVE row and only there: a category describes the CHARGE, not one of the several
 * things the charge paid — a rent debit split across Rent and Water has one merchant and one label,
 * not two. With the column populated on every row, a charge could end up asserting two different
 * categories with no rule for which one wins. But today's single-row UI legitimately carries the
 * override forward when it converts a `'categorized'` row into a link (every `save.mutate` site in
 * `BankActivity.tsx` passes `category_override: review?.category_override ?? null`), so enforcing it
 * in the per-row validator would break the live app before the UI is ready. The set validator has no
 * callers yet; it is the contract the split-link UI is built against.
 */
export function validateReviewSet(inputs: readonly ReviewInput[]): string | null {
  if (inputs.length === 0) return null;
  const charge = inputs[0].synced_transaction_id;
  const targets = new Set<string>();
  let exclusives = 0;
  for (const input of inputs) {
    const problem = validateReviewInput(input);
    if (problem) return problem;
    if (input.synced_transaction_id !== charge) return 'These decisions are about different charges';
    if (!isLinkStatus(input.status)) {
      // Idempotency (1) preserved exactly: "a row already imported cannot be imported twice" was one
      // of the three jobs the dropped `UNIQUE (synced_transaction_id)` was doing, and it is the one
      // that must survive split link untouched.
      if (++exclusives > 1) return 'A charge can only hold one of those decisions at a time';
      continue;
    }
    if (input.category_override) return 'A category belongs to the charge, not to one of its links';
    const target = linkTarget(input);
    if (target && targets.has(target)) return 'That is already linked to this charge';
    if (target) targets.add(target);
  }
  return null;
}

/**
 * §1B SPLIT LINK Slice C — the set of decisions a charge WOULD hold once `input` is written.
 *
 * The write path knows the charge's current rows and the one decision being made; `validateReviewSet`
 * judges sets. This is the join between them, kept pure and separate so the "what would this become"
 * question can be tested without a Supabase client — and so the answer the validator is given is
 * built by the same routing that decides the UPDATE-vs-INSERT, rather than by a second guess at it.
 *
 * Immutable by construction: the existing rows are never edited in place, which matters because the
 * caller still holds them and one of them is about to be sent to the database as an UPDATE.
 */
export function applyReviewToSet(
  existing: readonly ReviewInput[],
  input: ReviewInput,
): ReviewInput[] {
  const replacing = findReviewRowFor(existing, input);
  if (!replacing) return [...existing, input];
  return existing.map(row => (row === replacing ? input : row));
}

/**
 * §1B SPLIT LINK — a unique-violation from the review table, said in a sentence a user can act on.
 *
 * The routing above makes these states unreachable through one tab, but the database indexes are the
 * backstop for the paths routing cannot see — two tabs, a stale SELECT, a retried request — and when
 * one fires, supabase-js hands the UI raw Postgres text ("duplicate key value violates unique
 * constraint \"synced_transaction_reviews_one_rule_link\""), which reached a real toast during the
 * 2026-08-10 live pass. This maps each index to what the user actually did.
 *
 * ⚠️ The index names here are the ones the migration creates
 * (`20260810_synced_transaction_reviews_split_link.sql`) — one rule written twice, like
 * `LINK_STATUSES` and the `one_exclusive` predicate. The friendlyError parity test parses the
 * shipped SQL and fails if they drift.
 *
 * Returns null for anything that is not a unique violation on this table, so callers fall back to
 * the original message rather than mislabelling an unrelated failure.
 */
export function friendlyReviewWriteError(
  error: { code?: string; message?: string } | null | undefined,
): string | null {
  const message = error?.message ?? '';
  const isUniqueViolation =
    error?.code === '23505' || /duplicate key value violates unique constraint/i.test(message);
  if (!isUniqueViolation || !message.includes('synced_transaction_reviews')) return null;
  if (message.includes('one_rule_link')) {
    return 'This charge is already linked to that bill. Remove the existing link first if you meant to change it.';
  }
  if (message.includes('one_plan_link')) {
    return 'This charge is already linked to that payment plan. Remove the existing link first if you meant to change it.';
  }
  if (message.includes('one_car_link')) {
    return 'This charge is already linked to that vehicle charge. Remove the existing link first if you meant to change it.';
  }
  if (message.includes('one_exclusive')) {
    return 'This charge already has a decision recorded. Undo it first, then try again.';
  }
  // The pre-migration UNIQUE, or a future index nobody mapped yet: still say something honest.
  return 'This charge already has that decision recorded — it may have been updated in another tab. Refresh and try again.';
}

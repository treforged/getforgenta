// §1B Stage 4 part A — a user's confirmed rule link marks that bill's occurrence already paid.
//
// WHY THIS EXISTS. Every other month-0 outflow gate in the app asks `isCapturedInBalance`, which
// §1A Stage C demoted from "the date heuristic decides" to "settled transactions decide, and the
// date heuristic is the fallback". Recurring-rule bills never got that treatment: their month-0
// obligations drop out purely on `t.date > syncCutoffDate` inside the `getRemainingTransaction*`
// helpers. So a bill due the 25th that the user actually paid on the 5th is still charged against
// this month's remaining cash, because its DUE DATE has not passed — the exact class of error §1A
// was built to remove, on the one charge type §1A never reached.
//
// A confirmed `linked_rule` review is the missing evidence. It is strictly better than the
// auto-matcher (it is an assertion by the person who paid the bill, not an inference), which is why
// Tre's decision 2 on 2026-08-08 made Stage 4 ship at all: otherwise confirming a link is busywork
// the app ignores.
//
// ⚠️ DIRECTION OF ERROR. Dropping an obligation from month 0 raises projected available cash — the
// UNSAFE direction, unlike most gates here. Three things hold it down, and all three are load-bearing:
//
//   1. It fires ONLY on an explicit user confirmation. Absence of a review changes nothing, so
//      every bill nobody has touched keeps exactly its pre-Stage-4 behaviour.
//   2. The confirmable rows are SETTLED ONLY. `BankActivity.tsx` excludes pending rows from the
//      list, so a pending debit cannot be linked in the first place — the same rule that makes
//      `hasCoverage` skip pending rows, enforced one layer earlier by not offering the button.
//   3. It is scoped to ONE rule in ONE month (`occurrence_month`), so it can never generalise into
//      "this bill is handled from now on".
//
// NOT wired into the min-safe-cash floor, deliberately — see `getMinSafeCash` in `pay-schedule.ts`,
// which documents why transaction evidence stays out of the floor. The floor is the safety rail;
// raising it reads cash low, which is the direction a floor is supposed to err in.

/** The `synced_transaction_reviews` columns this reads. Structurally satisfied by the row type. */
export interface RuleOccurrenceReview {
  status: string;
  rule_id: string | null;
  occurrence_month: string | null;
  /**
   * `YYYY-MM-DD` — WHICH generated occurrence of the rule, when the writer could locate one.
   *
   * NULL is a first-class legacy value, not a defect: every review written before the
   * occurrence-date migration has one, and this module treats it as "month-keyed, behave exactly as
   * before". Optional on the interface so the ~8 call sites that build test doubles keep compiling
   * with the old shape and keep exercising the legacy path on purpose.
   */
  occurrence_date?: string | null;
}

/** Opaque set of confirmed rule occurrences. Build it with `buildConfirmedOccurrences`. */
export type ConfirmedOccurrences = ReadonlySet<string>;

/**
 * Stable key for one rule's confirmed occurrence. `|` cannot appear in a uuid, a `YYYY-MM` or a
 * `YYYY-MM-DD`.
 *
 * ⚠️ TWO KEY SHAPES SHARE THIS SPACE, and that is safe rather than sloppy: the right-hand side is
 * either a `YYYY-MM` (7 chars, legacy month-keyed) or a `YYYY-MM-DD` (10 chars, occurrence-keyed).
 * No `YYYY-MM` can ever equal a `YYYY-MM-DD`, so a lookup for one can never collide with the other.
 */
function occurrenceKey(ruleId: string, scope: string): string {
  return `${ruleId}|${scope}`;
}

/**
 * The `rule + month` pairs the user has confirmed a bank transaction already paid.
 *
 * Only `'linked_rule'` qualifies. The other six statuses assert something else entirely:
 * `'linked_txn'` points at a ledger row (money already in `public.transactions`, so suppressing a
 * rule occurrence for it would hide a bill nothing accounts for), `'imported'` CREATED a ledger row,
 * and `'ignored'` / `'categorized'` take no position on whether the charge was paid.
 *
 * ⚠️ `'linked_plan'` (§1B Stage 4C) is EXCLUDED ON PURPOSE, not by oversight. It names a
 * `payment_plans` row, whose month-0 outflow comes from `getMonthlyPlanCashExpenses`, not from a
 * recurring rule — a plan id and a rule id are uuids from different tables, so folding them into
 * this one key space would let a collision suppress the wrong bill silently. Its suppression is a
 * separate `buildConfirmedPlanOccurrences` over the plan key space, and is not built yet.
 *
 * ⚠️ `'linked_car'` (§1B Stage 4B) is EXCLUDED ON PURPOSE for the same reason, and one more: it
 * names a `car_funds` row, whose month-0 outflows are gated by `carChargeEvidence` /
 * `isCapturedInBalance` rather than by this set at all — and a car fund bills TWO obligations a
 * month, so its key needs `car_charge_kind` as well. Its suppression belongs in those gates, and is
 * not built yet.
 *
 * ⚠️ A `'linked_rule'` row with a NULL `rule_id` is skipped, not treated as an error. That is the
 * documented degraded state from the FK's `ON DELETE SET NULL` (see the §1B migration): the review
 * still means "handled", but the rule it named is gone, so there is no occurrence left to suppress.
 *
 * ⚠️ ONE KEY PER REVIEW, never both. A row carrying an `occurrence_date` contributes ONLY its date
 * key — adding its month key too would restore the exact bug the column was added to fix, because
 * the month key suppresses every occurrence of that rule in the month. A row without one
 * contributes only its month key, which is the pre-migration behaviour byte for byte.
 */
export function buildConfirmedOccurrences(
  reviews: readonly RuleOccurrenceReview[] | null | undefined,
): ConfirmedOccurrences {
  const confirmed = new Set<string>();
  if (!reviews) return confirmed;
  for (const review of reviews) {
    if (review.status !== 'linked_rule') continue;
    if (!review.rule_id || !review.occurrence_month) continue;
    confirmed.add(occurrenceKey(review.rule_id, review.occurrence_date || review.occurrence_month));
  }
  return confirmed;
}

/**
 * Has the user confirmed THIS occurrence of this rule was already paid?
 *
 * The rule-id form, for consumers that already know which rule produced a charge — the forecast's
 * `scheduledEvents` carry `ruleId` directly and never take the `gen:` id shape.
 *
 * `date` may be a `YYYY-MM-DD` or a `YYYY-MM`. The exact-occurrence key is tried FIRST, then the
 * month key, so:
 *
 *   - a modern date-keyed confirmation suppresses exactly the occurrence it names, which is what
 *     makes a weekly or biweekly rule's other occurrences in the same month survive it;
 *   - a legacy month-keyed confirmation still suppresses the whole month, unchanged;
 *   - a caller that only knows the month (`'2026-08'`) probes the same key twice and therefore
 *     matches ONLY legacy rows. That is correct, not a gap: without a day there is no way to say
 *     which occurrence is being asked about, and guessing would be the original bug.
 */
export function isRuleOccurrenceConfirmed(
  ruleId: string | null | undefined,
  date: string | null | undefined,
  confirmed: ConfirmedOccurrences,
): boolean {
  if (confirmed.size === 0 || !ruleId || !date) return false;
  if (confirmed.has(occurrenceKey(ruleId, date))) return true;
  return confirmed.has(occurrenceKey(ruleId, date.slice(0, 7)));
}

/**
 * Has the user confirmed this GENERATED transaction's bill was already paid?
 *
 * Generated rule expansions carry `id: 'gen:<ruleId>:<YYYY-MM-DD>'`
 * (`generateMonthTransactionsFromRules`), which is the only place a transaction in the merged
 * stream still knows which rule produced it. A uuid contains no `:`, so the split is unambiguous.
 *
 * Returns false for anything that is not a generated rule row — a real `public.transactions` row is
 * money that was actually recorded, and suppressing it would erase a spend the user entered by hand.
 */
export function isOccurrenceConfirmed(
  txn: { id?: string | null; date?: string | null; isGenerated?: boolean },
  confirmed: ConfirmedOccurrences,
): boolean {
  if (confirmed.size === 0) return false;
  if (!txn.isGenerated || !txn.id || !txn.date) return false;
  const parts = txn.id.split(':');
  if (parts.length !== 3 || parts[0] !== 'gen') return false;
  return isRuleOccurrenceConfirmed(parts[1], txn.date, confirmed);
}

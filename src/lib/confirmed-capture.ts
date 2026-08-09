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
}

/** Opaque set of confirmed `rule + month` pairs. Build it with `buildConfirmedOccurrences`. */
export type ConfirmedOccurrences = ReadonlySet<string>;

/** Stable key for one rule's occurrence in one month. `|` cannot appear in a uuid or a `YYYY-MM`. */
function occurrenceKey(ruleId: string, monthKey: string): string {
  return `${ruleId}|${monthKey}`;
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
 */
export function buildConfirmedOccurrences(
  reviews: readonly RuleOccurrenceReview[] | null | undefined,
): ConfirmedOccurrences {
  const confirmed = new Set<string>();
  if (!reviews) return confirmed;
  for (const review of reviews) {
    if (review.status !== 'linked_rule') continue;
    if (!review.rule_id || !review.occurrence_month) continue;
    confirmed.add(occurrenceKey(review.rule_id, review.occurrence_month));
  }
  return confirmed;
}

/**
 * Has the user confirmed this rule's occurrence in the month containing `date` was already paid?
 *
 * The rule-id form, for consumers that already know which rule produced a charge — the forecast's
 * `scheduledEvents` carry `ruleId` directly and never take the `gen:` id shape. `date` may be a
 * `YYYY-MM-DD` or a `YYYY-MM`; only the month part is read.
 */
export function isRuleOccurrenceConfirmed(
  ruleId: string | null | undefined,
  date: string | null | undefined,
  confirmed: ConfirmedOccurrences,
): boolean {
  if (confirmed.size === 0 || !ruleId || !date) return false;
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

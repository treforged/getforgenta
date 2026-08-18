// The exact rows a decision about a bank charge writes — one definition, every surface.
//
// WHY THIS FILE EXISTS. These were four closures inside `BankActivity.tsx`, and while that tab was
// the only place a charge could be decided, that was fine. The Decision Deck is a second surface
// over the SAME queue, and a second surface with its own copy of these writes is how one charge ends
// up meaning different things depending on which screen the user happened to be on. The deck is a
// VIEW; the writes it performs are these, unchanged.
//
// ⚠️ NOTHING HERE DECIDES WHETHER A CHARGE MAY BE WRITTEN. That is `validateReviewInput` /
// `validateReviewSet` (rejected at the mutation) and `planLedgerImport` (the one control that
// creates money, which is deliberately NOT in this file — the deck cannot import).
//
// ⚠️ THE `category_override` ASYMMETRY IS LOAD-BEARING, NOT AN OVERSIGHT. A LINK row may not carry a
// category (`validateReviewSet` rejects it outright, Tre 2026-08-09): the label describes the CHARGE
// and lives on its exclusive row. `linked_txn` IS the exclusive row, so it carries the category
// forward — and must, because `save` writes every column including the nulls, so omitting it would
// silently wipe a label the user set.

import { resolveRuleOccurrenceDate } from './pay-schedule';
import { monthOf, type ChargeSuggestion } from './bank-activity-queue';
import type { ReviewInput } from './synced-transaction-review';
import type { CarChargeKind } from './synced-transaction-review';

/** The two fields of a settled charge every write below reads. */
export interface WritableCharge {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
}

/** The columns `resolveRuleOccurrenceDate` needs to place an occurrence, plus the rule's identity. */
export type OccurrenceRule = Parameters<typeof resolveRuleOccurrenceDate>[0] & { id: string };

/**
 * WHICH occurrence of a rule a charge on `chargeDate` settles — the month, and the day when the app
 * can name one.
 *
 * ⚠️ THE DAY IS WHAT MAKES A BIWEEKLY LINK HONEST. Keyed on the month alone, confirming one of a
 * biweekly rule's two charges in a month suppressed BOTH, over-raising projected cash by the amount
 * of the one the user never confirmed. Tre's `Fuel` rule ($65, biweekly) already carries two July
 * links, so this is a live shape, not a hypothetical.
 *
 * A monthly rule has exactly one occurrence a month, so for the overwhelming majority of links this
 * stores the same information twice and changes nothing. The date resolves to null — and the link
 * keeps today's month-wide behavior — only when the rule bills nothing in the charge's month.
 */
export const ruleOccurrence = (rule: OccurrenceRule, chargeDate: string) => ({
  occurrence_month: monthOf(chargeDate),
  occurrence_date: resolveRuleOccurrenceDate(rule, chargeDate),
});

/**
 * The write that accepting a RULE suggestion performs — and the one the rule picker performs.
 *
 * ⚠️ NO `category_override`. See this file's header: a link is a new row and the label stays on the
 * exclusive one, untouched. Passing it would put the same category on two rows with no rule for
 * which wins, which `validateReviewSet` rejects outright (Tre, 2026-08-09).
 */
export const acceptRuleInput = (txn: WritableCharge, rule: OccurrenceRule): ReviewInput => ({
  synced_transaction_id: txn.id,
  status: 'linked_rule',
  rule_id: rule.id,
  ...ruleOccurrence(rule, txn.date),
});

/** The write that accepting a PAYMENT PLAN suggestion performs — byte-identical to the picker's. */
export const acceptPlanInput = (txn: WritableCharge, planId: string): ReviewInput => ({
  synced_transaction_id: txn.id,
  status: 'linked_plan',
  payment_plan_id: planId,
  occurrence_month: monthOf(txn.date),
});

/** The write that accepting a VEHICLE suggestion performs — byte-identical to the picker's. */
export const acceptCarInput = (
  txn: WritableCharge,
  carFundId: string,
  kind: CarChargeKind,
): ReviewInput => ({
  synced_transaction_id: txn.id,
  status: 'linked_car',
  car_fund_id: carFundId,
  car_charge_kind: kind,
  occurrence_month: monthOf(txn.date),
});

/**
 * The write that accepting a LEDGER-ENTRY suggestion performs.
 *
 * `categoryOverride` is KEPT rather than dropped, unlike the three link writes above — see the
 * header's asymmetry note.
 */
export const acceptLedgerTxnInput = (
  txn: WritableCharge,
  ledgerTxnId: string,
  categoryOverride: string | null,
): ReviewInput => ({
  synced_transaction_id: txn.id,
  status: 'linked_txn',
  transaction_id: ledgerTxnId,
  category_override: categoryOverride,
});

/** The write "Ignore" performs: nothing about this charge belongs in the ledger. */
export const ignoreInput = (txn: WritableCharge): ReviewInput => ({
  synced_transaction_id: txn.id,
  status: 'ignored',
});

/** A suggestion in the shape the writes below read. Structurally satisfied by `ChargeSuggestion`. */
type AcceptableSuggestion = ChargeSuggestion<OccurrenceRule, { id: string }, { id: string }>;

/**
 * The row that accepting a charge's suggestion writes, or null when there is nothing to accept.
 *
 * ⚠️ THE PRECEDENCE IS THE QUEUE'S OWN — rule → plan → vehicle → your own entry — and it is not
 * re-decided here. `buildReviewQueue` sets at most one field on a `ChargeSuggestion`, so in practice
 * this is a routing switch; the order is repeated defensively so that a suggestion carrying two
 * fields could never resolve differently on two surfaces.
 *
 * ⚠️ RETURNS NULL RATHER THAN GUESSING. A caller with no suggestion has nothing the app can confirm,
 * and inventing a decision is the one thing this whole feature must never do.
 */
export function planSuggestionAccept(
  txn: WritableCharge,
  suggestion: AcceptableSuggestion | null | undefined,
  categoryOverride: string | null,
): ReviewInput | null {
  if (!suggestion) return null;
  if (suggestion.rule) return acceptRuleInput(txn, suggestion.rule);
  if (suggestion.plan) return acceptPlanInput(txn, suggestion.plan.id);
  if (suggestion.carCharge) {
    return acceptCarInput(txn, suggestion.carCharge.carFundId, suggestion.carCharge.kind);
  }
  if (suggestion.ledgerTxn) return acceptLedgerTxnInput(txn, suggestion.ledgerTxn.id, categoryOverride);
  return null;
}

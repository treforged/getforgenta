// What an ACCEPTED proposal becomes, and the words the card says it in.
//
// Split from `rules-from-history.ts` so the detection half stays one screen of reading: that file
// answers "what does this history imply", this one answers "what does the app write when the user
// says yes", and nothing here can influence what is detected.
//
// The copy lives beside the payload for the same reason `describeDrift` lives beside the drift it
// describes: the sentence the user reads and the columns the accept button writes are produced from
// one place and cannot drift apart.

import { ordinal } from './ordinal';
import type { RuleProposal, ProposalDirection } from './rules-from-history';
import type { Category } from './types';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The schedule in the words the rule editor would use.
 *
 * Kept here rather than in the card for the same reason `describeDrift` is: the sentence the user
 * reads and the columns the accept button writes are produced from one place and cannot drift apart.
 */
export function describeCadence(proposal: RuleProposal): string {
  if (proposal.frequency === 'monthly') return `Monthly, around the ${ordinal(proposal.dueDay)}`;
  const day = WEEKDAYS[proposal.dueDay] ?? 'week';
  return proposal.frequency === 'weekly' ? `Every ${day}` : `Every other ${day}`;
}

/**
 * What KIND of thing this rule is, in the words the card shows.
 *
 * ⚠️ THE CARD USED TO SAY "BILL" ON A TRANSFER TO THE USER'S OWN BROKERAGE, and that is half of
 * what was actually reported: the totals were wrong AND the surface asserted the wrong thing about
 * his money. Fixing `rule_type` alone would have corrected every figure while the card went on
 * calling a Fidelity contribution a bill — so the label is derived from the same verdict the payload
 * is, in this file, for the reason its header already gives.
 */
export function describeProposalKind(proposal: RuleProposal): string {
  if (proposal.transfer?.ruleType === 'investment') return 'Investment';
  if (proposal.transfer) return 'Transfer';
  return proposal.direction === 'income' ? 'Money in' : 'Bill';
}

/** Where a transfer's money went, for the card's own line. Null when this is not a transfer. */
export function describeTransferDestination(proposal: RuleProposal): string | null {
  const name = proposal.transfer?.destination?.name;
  return name ? `Into ${name}` : null;
}

/** Why the app is asking at all — the run it actually observed, in the card's own words. */
export function describeEvidence(proposal: RuleProposal): string {
  return `${proposal.merchantLabel} · ${proposal.occurrences} charges across ${proposal.months.length} months in a row`;
}

/** The `recurring_rules` columns an accepted proposal writes. Exactly the rule editor's own payload. */
export interface RuleInsertDraft {
  name: string;
  amount: number;
  /** `transfer`/`investment` only when the proposal carries a {@link RuleProposal.transfer} verdict. */
  rule_type: ProposalDirection | 'transfer' | 'investment';
  frequency: RuleProposal['frequency'];
  due_day: number;
  due_month: null;
  start_date: string;
  end_date: null;
  category: Category;
  payment_source: string | null;
  deposit_account: string | null;
  active: true;
  notes: string;
}

/**
 * One proposal as the row the rule editor would have written.
 *
 * ⚠️ INCOME GOES IN `deposit_account` AND EXPENSE IN `payment_source`. That is not a preference —
 * `ruleChargeAccountId` (`transaction-matching.ts:150`) reads the two columns differently by
 * rule_type, and the rule editor leaves `payment_source` null on income. A proposal that filled in
 * the wrong column would write a rule the matcher can never settle a charge against, and the user
 * would see a bill they accepted quietly never being ticked off.
 */
export function ruleInsertFromProposal(proposal: RuleProposal): RuleInsertDraft {
  const income = proposal.direction === 'income';
  return {
    name: proposal.name,
    amount: proposal.amount,
    // 🎯 THE LINE THAT USED TO BOOK EVERY TRANSFER AS SPENDING. `proposal.direction` is only ever
    // income or expense, so an outflow to the user's own brokerage was written `expense` and then
    // counted in `living` by `monthly-expense-model.ts:146`. `transfer`/`investment` are what
    // `pay-schedule.ts:1446` turns into `isTransfer`, and both already exist in this column in
    // production (4 and 6 rows on 2026-09-16) with no CHECK constraint to refuse them.
    rule_type: proposal.transfer?.ruleType ?? proposal.direction,
    frequency: proposal.frequency,
    due_day: proposal.dueDay,
    due_month: null,
    start_date: proposal.anchorDate,
    end_date: null,
    category: proposal.category,
    payment_source: income ? null : proposal.accountId,
    // ⚠️ ON A TRANSFER, `deposit_account` IS THE DESTINATION, and the header's income/expense split
    // still holds: `payment_source` carries the account the money LEFT, so `ruleChargeAccountId`
    // (`transaction-matching.ts:150`) resolves it exactly as it does today and no existing match can
    // move. What the destination buys is `pay-schedule.ts:1450`'s `transferDestination` — without it
    // a surface can say money moved but not where it went, which is the one fact a person wants back.
    deposit_account: income
      ? proposal.accountId
      : (proposal.transfer?.destination?.id ?? null),
    active: true,
    notes: `Proposed from ${proposal.occurrences} charges in your bank history (${proposal.merchantLabel}).`,
  };
}

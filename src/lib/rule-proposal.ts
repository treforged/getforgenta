// §1C — WHAT A PROPOSED RULE IS. Types and thresholds only, no logic.
//
// Split out of `rules-from-history.ts` (which detects them) and `rule-proposal-write.ts` (which
// turns an accepted one into a row) so both can name the same shape without importing each other.
// The thresholds live here because they are the contract, not an implementation detail: they are
// what "conservative enough to show somebody" means, and they are deliberately `rule-drift.ts`'s.

import { MIN_CONSECUTIVE_MONTHS, DRIFT_BAND_LOW, DRIFT_BAND_HIGH } from './rule-drift';
import type { MerchantCharge } from './merchant-memory';
import type { QueueRule } from './bank-activity-queue';
import type { Category } from './types';

/**
 * Consecutive months a merchant must have billed before it is worth proposing anything.
 *
 * The same three as `rule-drift.ts`, and for the same reason: two months is a coincidence two
 * purchases can produce, three is a rhythm. Reusing the constant rather than restating it means the
 * app has ONE answer to "how long is long enough to say something".
 */
export const MIN_PROPOSAL_MONTHS = MIN_CONSECUTIVE_MONTHS;

/**
 * The band every observed charge must sit in, as a multiple of the run's median.
 *
 * `rule-drift.ts`'s constants, applied around what was OBSERVED rather than around a rule that
 * already exists — there is no rule here yet. Asymmetric for the same reason it is there: a bill
 * that doubled is still that bill (power in August), while a charge well below the others is far
 * more likely to be a different, smaller thing from the same merchant. A run that breaks the band
 * has no single amount to propose, so it is dropped rather than averaged into one.
 */
export const PROPOSAL_BAND_LOW = DRIFT_BAND_LOW;
export const PROPOSAL_BAND_HIGH = DRIFT_BAND_HIGH;

/** The fields of a settled `synced_transactions` row this reads. Satisfied by `BankActivityRow`. */
export interface HistoryCharge extends MerchantCharge {
  id: string;
  account_id: string | null;
  /** OUTFLOW POSITIVE, inflow negative — Stage A's convention. */
  amount: number | string;
  /** `YYYY-MM-DD`. */
  date: string;
  /** The provider's category, as the first draft of the rule's own. */
  category?: string | null;
}

/** Existing rules, read only to find out what is ALREADY covered. Satisfied by `RuleRow`. */
export type ProposalRule = QueueRule;

export type ProposalDirection = 'income' | 'expense';

/** One rule the history implies, in the shape the card renders and the accept button writes. */
export interface RuleProposal {
  /** Stable within a run — merchant, account and direction are what identify the pattern. */
  id: string;
  /** The rule's name, as a person writes it: `Duke Energy`, not `DUKE ENERGY`. */
  name: string;
  /** The merchant as it reads on the statement, for the "because we saw this" line. */
  merchantLabel: string;
  merchantKey: string;
  /** Median of the recent window. See {@link proposalAmount}. Always positive. */
  amount: number;
  direction: ProposalDirection;
  frequency: 'monthly' | 'weekly' | 'biweekly';
  /** Day of the MONTH for monthly, day of the WEEK (0-6) for weekly and biweekly — the app's convention. */
  dueDay: number;
  /** The first charge of the run: the schedule's `start_date`, and biweekly's phase anchor. */
  anchorDate: string;
  /** The account the money moved through. Which COLUMN it lands in depends on direction — see {@link ruleInsertFromProposal}. */
  accountId: string;
  /** The consecutive months observed, oldest first. At least {@link MIN_PROPOSAL_MONTHS} long. */
  months: string[];
  /** How many charges the proposal is drawn from — the evidence count the card shows. */
  occurrences: number;
  /** The provider's category for the most recent charge, as a first draft. */
  category: Category;
}

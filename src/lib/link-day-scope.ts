// §1C — HISTORY THAT ARRIVED WITH A LINK IS NOT A TO-DO. Pure, no I/O.
//
// Linking a bank pulls up to two years of transactions in one sync. Every one of those rows is
// unhandled by construction, so without this the review queue would meet a first-time user with a
// backlog of hundreds they never created — a count they cannot drive to zero, which is precisely the
// nagging `bank-activity-queue.ts`'s header rules out. The history is not lost: Bank Activity's "All
// activity" filter still shows every row, and rule discovery (`rules-from-history.ts`) is what that
// history is actually FOR. It simply stops being phrased as work owed.
//
// ⚠️ THIS IS A VIEW OVER THE QUEUE, NOT A CHANGE TO IT. `buildReviewQueue` still runs against the
// FULL history in both directions, because a bill due on the 1st can settle in the prior month and
// filtering the matcher's corpus would drop exactly those cross-month settlements. What is filtered
// is the OUTPUT — which charges are put in front of the user, and which are counted.
//
// ⚠️ AN ACCOUNT WHOSE LINK DAY CANNOT BE READ IS LEFT ALONE. `accounts.created_at` is a link day
// only for a row Plaid created; on a hand-entered account it is the day the user typed it in, which
// says nothing about when any feed started. So the quieting reaches only accounts carrying a
// `plaid_account_id` AND a `created_at`, and every other account behaves exactly as it did before
// this existed. Nobody's queue shrinks on a guess.

import type { QueueCharge, QueueRule, QueueLedgerTxn, ReviewQueue } from './bank-activity-queue';
import type { ObligationPlan } from './charge-obligations';

/** The fields of an `accounts` row this reads. Structurally satisfied by `AccountRow`. */
export interface LinkableAccount {
  id: string;
  /** Set only by the Plaid link flow — the tell that `created_at` is a link day. */
  plaid_account_id?: string | null;
  /** `timestamptz`. The row was inserted when the account was linked. */
  created_at?: string | null;
}

/**
 * `accounts.id` → the `YYYY-MM-DD` its feed started, for the accounts where that is knowable.
 *
 * An account missing from the map is not scoped at all. That is the honest reading of "we do not
 * know when this feed began", and it keeps every pre-existing account behaving as it always has.
 */
export function accountLinkDays(accounts: readonly LinkableAccount[]): Record<string, string> {
  const days: Record<string, string> = {};
  for (const account of accounts) {
    if (!account.plaid_account_id) continue;
    const created = account.created_at;
    if (!created || created.length < 10) continue;
    days[account.id] = created.slice(0, 10);
  }
  return days;
}

/**
 * Is this charge inside the window the user is asked to decide about?
 *
 * ON the link day counts: the sync that runs at link time reports the day's own charges, and a
 * boundary that excluded them would quietly swallow a decision the user does owe.
 */
export function isDecidableCharge(
  charge: Pick<QueueCharge, 'account_id' | 'date'>,
  linkDays: Readonly<Record<string, string>>,
): boolean {
  if (!charge.account_id) return true;
  const linkDay = linkDays[charge.account_id];
  if (!linkDay) return true;
  return charge.date >= linkDay;
}

/**
 * The queue as the user should see it: the same decisions, minus the ones the link brought with it.
 *
 * The suggestion map and the badge count are recomputed together with the card list. Dropping a card
 * while leaving its suggestion counted would badge a number with nothing behind it — a count the
 * user cannot act on, which is worse than the backlog this removes.
 */
export function scopeQueueToLinkedHistory<
  C extends QueueCharge, R extends QueueRule, T extends QueueLedgerTxn, P extends ObligationPlan,
>(
  queue: ReviewQueue<C, R, T, P>,
  linkDays: Readonly<Record<string, string>>,
): ReviewQueue<C, R, T, P> {
  if (Object.keys(linkDays).length === 0) return queue;

  const needsDecision = queue.needsDecision.filter(charge => isDecidableCharge(charge, linkDays));
  const inScope = new Set(needsDecision.map(c => c.id));
  const suggestions: Record<string, typeof queue.suggestions[string]> = {};
  for (const [chargeId, suggestion] of Object.entries(queue.suggestions)) {
    if (inScope.has(chargeId)) suggestions[chargeId] = suggestion;
  }

  return { needsDecision, suggestions, suggestedCount: Object.keys(suggestions).length };
}

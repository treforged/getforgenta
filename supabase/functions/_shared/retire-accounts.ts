/**
 * When a connection is superseded, what happens to the accounts that belonged to it?
 *
 * ── WHY THIS IS NOT JUST "DELETE THEM" ───────────────────────────────────────
 * Tre, 2026-09-02: "the duplicates need to actually be deleted automatically." He is right that
 * leaving them behind is not good enough - a hidden row he has to find and tidy is still his
 * problem, and on 2026-09-02 two live Robinhood connections double-counted $2,054.85.
 *
 * But a superseded account is not always inert. One of his had a $100,000 savings goal pointing
 * at it and another had a $230/month rule. Deleting a row something still references either
 * breaks that thing or, worse, silently re-points it at nothing.
 *
 * And re-pointing automatically is the one move already proven wrong here: Robinhood returned TWO
 * new accounts BOTH named "Robinhood individual", one personal and one agent-traded, separable by
 * nothing the provider sends. A session guessed and got it backwards. `supersede-connection.ts`
 * records that as the reason it refuses to remap.
 *
 * So the rule is: DELETE what is provably safe to delete, and only that.
 *
 *   - referenced by nothing  ⇒ DELETE. This is the ordinary duplicate and it is the whole of the
 *     complaint: a row with no history and no links, sitting in net worth twice.
 *   - referenced by anything ⇒ KEEP, deactivated. It stops counting immediately, which is the
 *     part that matters for the money, and the reference survives for a human to move.
 *
 * That deletes the noise without ever guessing on something a user built.
 *
 * Pure: no database, no clock. The caller gathers the ids and does the writing.
 */

/** Ids of accounts belonging to the superseded connection(s). */
export type AccountId = string;

export interface RetirementPlan {
  /** Nothing points at these. Safe to remove outright. */
  deletable: AccountId[];
  /** Something still points at these. Deactivate, never delete. */
  deactivateOnly: AccountId[];
}

/**
 * Split stale accounts into the ones that can go and the ones that must only be hidden.
 *
 * `referenced` is the union of every account id mentioned by goals, rules, car funds and
 * transactions. It is passed in rather than queried so this stays pure and so the caller cannot
 * forget a table quietly - adding a new referencing table is a change at the CALL SITE, where the
 * query lives, not a silent omission here.
 *
 * ⚠️ An EMPTY `referenced` set is treated as "nothing is referenced", which is correct only if the
 * caller actually looked. A caller that fails to query and passes an empty set would delete rows
 * it should have kept, so the caller must treat a failed lookup as "reference everything" rather
 * than as an empty result.
 */
export function planAccountRetirement(
  staleAccountIds: readonly AccountId[],
  referenced: ReadonlySet<AccountId>,
): RetirementPlan {
  const deletable: AccountId[] = [];
  const deactivateOnly: AccountId[] = [];
  for (const id of staleAccountIds) {
    if (referenced.has(id)) deactivateOnly.push(id);
    else deletable.push(id);
  }
  return { deletable, deactivateOnly };
}

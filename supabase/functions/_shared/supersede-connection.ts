/**
 * Re-linking an institution SUPERSEDES the old connection to it.
 *
 * ── THE BUG THIS EXISTS FOR (2026-08-21, real) ───────────────────────────────
 * Tre re-linked Robinhood. Plaid issued a NEW item with NEW `account_id`s for the same underlying
 * accounts, and `persistAccount` matches on `plaid_account_id` — so it found nothing, inserted new
 * rows, and left the old ones behind. Both connections were `connection_status = 'active'`, so both
 * kept syncing. The result was a ghost "Robinhood individual" holding a stale $251.53 alongside the
 * real ones: net worth overstated, two rows with the same name, and no way to tell from the app
 * which was which.
 *
 * Nothing about that was Robinhood-specific. It happens on every re-link, at every institution.
 *
 * ── WHAT SUPERSESSION DOES, AND WHAT IT DELIBERATELY DOES NOT ────────────────
 * Does: mark the old connection `revoked` (which is the only status `plaid-sync-all` skips, so it
 * stops syncing) and deactivate the accounts that belonged to it.
 *
 * Does NOT delete anything, ever. `active = false` keeps the row, its history and its id, and one
 * flag undoes the whole thing. Deleting a financial account row to tidy up a sync artefact is not
 * a trade worth making.
 *
 * Does NOT re-point references. A goal or rule pointing at a superseded account has to be moved by
 * hand, because matching an old account to its replacement is genuinely ambiguous: Robinhood
 * returned TWO new accounts both named "Robinhood individual", one personal and one traded by an
 * agent, distinguishable by nothing the provider sends. A session guessed and got it backwards.
 * An automatic remap would make that same wrong guess silently, on money.
 *
 * ── THE MATCH IS ON `institution_id`, NOT THE NAME ───────────────────────────
 * `institution_name` is a display string that Plaid can change between links ("Chase" vs
 * "Chase Bank"); `institution_id` (`ins_54`) is stable and is what identifies the bank. A null
 * `institution_id` supersedes NOTHING — without it there is no safe way to tell "the same bank
 * again" from "a second bank", and the failure that costs the user is disconnecting a live
 * connection they still need.
 *
 * Pure: no database, no clock. The caller does the writing.
 */

/** The `financial_connections` columns this reads. */
export interface SupersedableConnection {
  id: string;
  institution_id: string | null;
  provider_item_id: string;
  connection_status: string;
}

export interface IncomingLink {
  institution_id: string | null;
  provider_item_id: string;
}

/**
 * The connections `incoming` replaces — same bank, different item, not already retired.
 *
 * Returns ids only, so the caller can decide the write. An empty array is the ordinary case: a
 * first-time link supersedes nothing.
 */
export function planSupersededConnections(
  existing: readonly SupersedableConnection[],
  incoming: IncomingLink,
): string[] {
  // No institution id ⇒ no safe comparison ⇒ touch nothing. See the header.
  if (!incoming.institution_id) return [];

  return existing
    .filter(c =>
      c.institution_id === incoming.institution_id
      // ⚠️ NEVER the incoming item itself. A re-link of an item the user ALREADY has (Plaid's
      // update mode reuses the item_id) hits the same upsert, and revoking it here would
      // disconnect the connection the user just repaired.
      && c.provider_item_id !== incoming.provider_item_id
      // Already retired, or in a state the user must fix by hand — leave both alone.
      && c.connection_status !== 'revoked')
    .map(c => c.id);
}

/** A superseded row, as far as hanging up at the provider is concerned. */
export interface RetirableConnection {
  id: string;
  access_token: string | null;
}

/**
 * The superseded connections worth calling the provider's disconnect on.
 *
 * ── WHY HANG UP AT ALL ───────────────────────────────────────────────────────
 * Marking a row `revoked` stops US syncing. It does nothing at the provider, where the Item
 * stays live: it keeps counting against the connection quota we are billed on, and the user's
 * bank keeps listing us as connected. Someone who re-links their bank has REPLACED that
 * connection, not added a second one, so continuing to hold an access token we will never use
 * again is a promise the app is not keeping.
 *
 * ── WHY THIS IS A SEPARATE, PURE DECISION ────────────────────────────────────
 * `/item/remove` is IRREVERSIBLE. The failure that costs the user is hanging up on a link they
 * still need, which is the same failure `planSupersededConnections` exists to prevent — so the
 * choice is made here, in something a test can exercise, rather than inside the edge function's
 * imperative block where it could only be verified by running it against Plaid.
 *
 * A row with no access token is skipped: there is nothing to present and the call would fail.
 * Callers pass ONLY rows that `planSupersededConnections` already selected; this narrows that
 * set, it never widens it.
 */
export function planProviderDisconnects(
  supersededRows: readonly RetirableConnection[],
): string[] {
  return supersededRows
    .filter(r => typeof r.access_token === 'string' && r.access_token.length > 0)
    .map(r => r.id);
}


/** An account row, as far as the orphan check is concerned. */
export interface ConnectableAccount {
  id: string;
  connection_id: string | null;
}

/**
 * Accounts left pointing at a connection that no longer exists — the leftovers a user SEES.
 *
 * ⚠️ WHY THIS IS PRODUCTION CODE AND NOT A TEST HELPER. The two halves of a supersede failed in
 * opposite directions on 2026-09-05, and BOTH were found by Tre spotting rows on his screen
 * rather than by anything in the system:
 *
 *   - the dedupe retired ACCOUNTS but not the ITEM, leaving two dead banks listed forever;
 *   - the cleanup then removed the ITEMS and left their ACCOUNT rows, on the reasoning that
 *     `active: false` made them harmless. It did not. He could still see them.
 *
 * Each looks complete on its own. Written as a check the sender actually RUNS, the invariant
 * cannot quietly stop being true: a supersede that leaves anything here has not finished, and
 * the run says so instead of the user discovering it.
 *
 * An account with no `connection_id` is a MANUAL account and is never an orphan — it was never
 * attached to a connection, so there is nothing for it to be orphaned from. Deleting one of
 * those would be the worst possible over-correction.
 */
export function findOrphanedAccounts(
  accounts: readonly ConnectableAccount[],
  survivingConnectionIds: ReadonlySet<string>,
): string[] {
  return accounts
    .filter(a => a.connection_id !== null && !survivingConnectionIds.has(a.connection_id))
    .map(a => a.id);
}

/**
 * Who owns `accounts.apr` — the provider, or the user.
 *
 * Pure and free of Deno APIs so it can be unit tested directly, same as akoya-normalize.ts.
 *
 * THE DEFECT THIS FIXES. `min_payment` has always had a real guard (`min_payment_is_manual`), but
 * `apr` had none: the sync computed `account.apr ?? existing.apr`, so any APR Plaid returned
 * overwrote a rate the user had typed, every night, silently. The concrete case is Tre's Discover,
 * whose true purchase rate (~16.6%, derived from the interest actually charged) contradicts the
 * 12.89% blended figure the provider chain reports — the correction survived exactly until the
 * next sync.
 *
 * THE FLAG'S SEMANTICS, unchanged and NOT migrated: `apr_plaid_synced` means "the apr currently
 * stored came from Plaid". It was already being written; it was simply never read back. So the
 * guard needs no new column — only the discipline to consult the one that exists.
 *
 * ON NULL. `apr_plaid_synced` is nullable, and a null is NOT read as "Plaid owns it". A stored apr
 * whose flag was never set true did not come from a sync that would have set it, so the honest
 * reading is that a person put it there. The failure modes are asymmetric: treating a manual rate
 * as Plaid's destroys a number nobody can recover, while treating an old Plaid rate as manual only
 * means it stops refreshing until the user edits it — visible, and fixable in one tap.
 */

/** What the sync should do with `apr` for one account. */
export interface AprSyncDecision {
  /** The value to store. Never null when either side had one. */
  apr: number | null;
  /**
   * Whether to write `apr_plaid_synced = true`. FALSE means "leave the flag exactly as it is" —
   * never "write false" — so this can never silently reclassify a Plaid-owned rate as manual.
   */
  markPlaidSynced: boolean;
  /** True when the stored value was kept because the user owns it. Exposed for logging/tests. */
  keptManual: boolean;
}

/**
 * Resolve `apr` for one account on sync.
 *
 * - Provider returned nothing → keep what is stored, touch no flag. Absence is not a correction.
 * - Stored apr is the user's (non-null, flag not true) → keep it, and do NOT claim it for Plaid.
 * - Otherwise → the provider value wins and the flag records that it did.
 */
export function resolveAprOnSync(
  providerApr: number | null,
  existingApr: number | null,
  existingPlaidSynced: boolean | null,
): AprSyncDecision {
  if (providerApr == null) {
    return { apr: existingApr ?? null, markPlaidSynced: false, keptManual: false };
  }

  const userOwnsIt = existingApr != null && existingPlaidSynced !== true;
  if (userOwnsIt) {
    return { apr: existingApr, markPlaidSynced: false, keptManual: true };
  }

  return { apr: providerApr, markPlaidSynced: true, keptManual: false };
}

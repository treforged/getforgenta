/**
 * WHO IS ALLOWED TO LINK A BANK, AND WHY THE ANSWER IS NO LONGER "PREMIUM ONLY".
 *
 * Measured 2026-09-06: bank linking was premium-gated, so the only 2 of 31 accounts that
 * ever linked one did it BECAUSE they already had premium. Twenty-nine accounts were asked
 * for $89.99 for automatic bank sync without ever seeing it work on their own money, and
 * zero have ever paid it. The paywall now moves to the SECOND account: the first link is
 * free, so the thing being sold has been used before it is charged for.
 *
 * NOTHING WAS TAKEN OUT OF PREMIUM to make room. Premium still links up to `MAX_LINKED`
 * institutions; the free tier gained one, it did not take one.
 *
 * THE GRANT IS CONSUMED ONCE AND UNLINKING DOES NOT RETURN IT. Unlinking hard-deletes the
 * `financial_connections` row, so a gate that counted live rows would be a retry loop: link
 * free, unlink, link free again, one item Tre pays for every time. `free_bank_link_grants`
 * is the durable record, written by the service role only - see the migration header for
 * why it cannot live on `profiles`.
 *
 * IT IS CONSUMED AT TOKEN EXCHANGE, NOT WHEN A LINK TOKEN IS ISSUED. Plaid bills on the
 * item. Somebody who opens Link and backs out has cost nothing, and burning their one free
 * link on an abandoned flow would be charging them for our own modal.
 */

// deno-lint-ignore no-explicit-any
type Client = any;

export const FREE_LINK_LIMIT = 1;

export type BankLinkDecision =
  | { allowed: true; tier: 'premium' }
  | { allowed: true; tier: 'free' }
  | { allowed: false; reason: 'free_link_used'; status: 402 }
  | { allowed: false; reason: 'max_linked'; status: 422 };

/** True when the account holds an active or trialing premium subscription. */
export async function isPremiumActive(supabase: Client, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_subscriptions')
    .select('plan, subscription_status')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.plan === 'premium'
    && ['active', 'trialing'].includes(data?.subscription_status ?? '');
}

/**
 * May this account start ANOTHER bank link right now?
 *
 * Premium is bounded by `maxLinked` exactly as before. A free account is allowed only while
 * it has no live connection AND has never consumed its grant - both checks are required.
 * The live-connection check stops a second SIMULTANEOUS link; the grant check stops the
 * unlink-and-relink loop that the live-connection check alone cannot see.
 *
 * ⚠️ A read failure is treated as ALREADY CONSUMED. A gate that opens when its own lookup
 * errors is not a gate, and the thing on the other side of this one costs real money.
 */
export async function decideBankLink(
  supabase: Client,
  userId: string,
  maxLinked: number,
): Promise<BankLinkDecision> {
  const { count: liveCount } = await supabase
    .from('financial_connections')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  const live = liveCount ?? 0;

  if (await isPremiumActive(supabase, userId)) {
    return live >= maxLinked
      ? { allowed: false, reason: 'max_linked', status: 422 }
      : { allowed: true, tier: 'premium' };
  }

  if (live >= FREE_LINK_LIMIT) return { allowed: false, reason: 'free_link_used', status: 402 };

  const { data: grant, error } = await supabase
    .from('free_bank_link_grants')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || grant) return { allowed: false, reason: 'free_link_used', status: 402 };

  return { allowed: true, tier: 'free' };
}

/**
 * Record that this account's one free link has been used. Called AFTER an item exists.
 *
 * `onConflict: 'user_id'` with `ignoreDuplicates` so a retried exchange cannot overwrite the
 * original record with a later item id. The FIRST item that consumed the grant is the true
 * one, and a retry is not a second grant.
 */
export async function consumeFreeBankLink(
  supabase: Client,
  userId: string,
  provider: string,
  providerItemId: string,
): Promise<void> {
  await supabase
    .from('free_bank_link_grants')
    .upsert(
      { user_id: userId, provider, provider_item_id: providerItemId },
      { onConflict: 'user_id', ignoreDuplicates: true },
    );
}

/** The message a person sees when the paywall is the thing standing in the way. */
export const FREE_LINK_USED_MESSAGE =
  'Your free connected bank is already in use. Forgenta Premium connects up to 10 institutions.';

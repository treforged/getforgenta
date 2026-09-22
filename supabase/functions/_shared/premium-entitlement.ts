/**
 * Shared premium entitlement logic.
 *
 * This file defines the single source of truth for which subscription statuses
 * grant premium access. Both webhook writers set `subscription_status = 'past_due'`
 * on a FAILED RENEWAL while leaving `plan` as 'premium'. See
 * `revenuecat-webhook/index.ts` (BILLING_ISSUE) and `stripe-webhook/index.ts`
 * (invoice.payment_failed).
 *
 * Before this module every reader required status in ('active','trialing'), so
 * a paying customer whose card bounced was locked out INSTANTLY - which defeats
 * the billing grace period Tre enabled in App Store Connect.
 *
 * `past_due` therefore means "the platform is still retrying, the subscriber still
 * has access". It does NOT mean the subscription is gone; `canceled` and
 * `expired` mean that, and neither is in the list.
 *
 * The length of the grace window is decided by Apple / RevenueCat / Stripe and
 * reported through this status. This module never hard-codes a number of days and
 * never computes a window from a stored date, because the platform setting can
 * change at any time.
 *
 * This module is the ONE definition. `src/lib/premium-entitlement.ts` re-exports
 * it so the app and the edge functions cannot drift.
 *
 * Two deliberate NON-callers:
 * 1. `stripe-webhook/index.ts` line ~198 is the WRITER. Its `sub.status` is
 *    Stripe's own namespace. Treating `past_due` as active THERE would write
 *    `plan: 'premium'` permanently and grant premium forever instead of granting
 *    a grace period.
 * 2. `plaid-sync-all/index.ts` filters in Postgres with `.in()` and cannot call a
 *    JS predicate, so it carries a deliberate parallel copy of the same list.
 */

export const PREMIUM_ENTITLED_STATUSES = ['active', 'trialing', 'past_due'] as const;

export type PremiumEntitledStatus = typeof PREMIUM_ENTITLED_STATUSES[number];

/**
 * Returns true when the provided row represents a premium entitlement.
 *
 * The row is considered entitled if:
 * - `plan` equals the string 'premium', and
 * - `subscription_status` is one of the values in `PREMIUM_ENTITLED_STATUSES`.
 *
 * Any null, undefined, or malformed input safely returns false.
 */
export function isPremiumEntitled(
  row: { plan?: string | null; subscription_status?: string | null } | null | undefined,
): boolean {
  if (!row) {
    return false;
  }

  const { plan, subscription_status: status } = row;

  if (plan !== 'premium') {
    return false;
  }

  if (typeof status !== 'string') {
    return false;
  }

  return (PREMIUM_ENTITLED_STATUSES as readonly string[]).includes(status);
}

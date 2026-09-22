/**
 * What `customer.subscription.created/updated/deleted` may write to `user_subscriptions.plan`.
 *
 * ⚠️ `past_due` WRITES NO PLAN AT ALL, and that is the whole fix (ask 93d17f7e, 2026-09-22).
 * This handler used to write `plan: isActive ? 'premium' : 'free'` with isActive drawn from
 * ['active', 'trialing']. So a Stripe subscription entering `past_due` was set to FREE. The
 * entitlement predicate requires plan === 'premium', so the grace period Tre enabled could never
 * fire for a Stripe web subscriber. And `invoice.payment_failed` in the SAME file said the
 * opposite: "keep plan = premium so the user retains access during the retry window". Which
 * handler won depended on event ordering, which Stripe does not guarantee.
 *
 * ⚠️ WHY NOT JUST ADD 'past_due' TO THE ACTIVE LIST. That would WRITE plan = 'premium' on a
 * past_due subscription. A subscription created and failing its first renewal without ever having
 * been premium would then be promoted. Leaving `plan` untouched only PRESERVES what the row
 * already says: a premium row stays premium while `subscription_status = 'past_due'` carries
 * the grace, and a free row stays free.
 *
 * WHAT ENDS THE GRACE is the platform, not a date here. When Stripe gives up it moves the
 * subscription to `canceled` or `unpaid`. That writes plan = 'free', and neither status is in
 * PREMIUM_ENTITLED_STATUSES, so access ends on either half alone. This is the same exposure
 * `invoice.payment_failed` has always had: it too writes past_due and leaves plan alone.
 */
export function stripePlanWrite(status: string): { plan?: 'premium' | 'free' } {
  if (status === 'past_due') return {};
  const isActive = ['active', 'trialing'].includes(status);
  return { plan: isActive ? 'premium' : 'free' };
}

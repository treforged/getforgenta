/**
 * WHO GETS THE FIRST-YEAR INTRO OFFER ON THE WEB (ask a6375f1c, decision 994dbd43).
 *
 * Tre, 2026-10-06: Premium at $0.99/month for the first year, or $9.99 for the whole first year
 * (ask 852772a5; first said $1/$10), then the regular price. Scope: NEW subscribers only. The stores decide eligibility themselves on iOS
 * and Android; Stripe does not, so checkout asks this function before it applies a coupon.
 *
 * "New" is read from every record that could say otherwise, and the answer fails CLOSED: anyone who
 * has EVER held a subscription anywhere (Stripe, Apple, Google), is premium now, or is a comp grant
 * pays the regular price. A wrong "eligible" is a discount the business never offered; a wrong
 * "not eligible" shows the regular price, which is what they would have paid anyway.
 *
 * Pure: no Deno, no network. The Stripe history read happens in the caller and arrives as a boolean.
 */

import { isPremiumEntitled } from './premium-entitlement.ts';

export type IntroPlan = 'monthly' | 'yearly';

export interface SubscriptionRowForIntro {
  stripe_subscription_id?: string | null;
  apple_original_transaction_id?: string | null;
  purchase_provider?: string | null;
  plan?: string | null;
  subscription_status?: string | null;
  is_comp?: boolean | null;
}

export interface IntroDecision {
  eligible: boolean;
  /** Why not, for the log and the 409 body. Null when eligible. */
  reason: 'ever_subscribed' | 'currently_premium' | 'comp' | null;
}

/**
 * @param row             the user's `user_subscriptions` row, or null when there is none
 * @param stripeEverSubscribed  true when Stripe lists ANY subscription (any status) for the customer
 */
export function decideIntroEligibility(
  row: SubscriptionRowForIntro | null,
  stripeEverSubscribed: boolean,
): IntroDecision {
  // ⚠️ `is_comp` DEFAULTS TO TRUE (20260905_subscriptions_is_comp.sql): it means "no money has moved
  // yet", and the Stripe webhook sets it false on the first real payment. Read alone it marked EVERY
  // free user who had ever opened checkout as a comp grant, so one abandoned checkout cost them the
  // offer for good (measured 2026-10-06: a brand-new account was eligible, opened the monthly
  // checkout, and the next call said 'comp'). A comp GRANT is a premium plan with no money behind it.
  if (row?.is_comp && row?.plan === 'premium') return { eligible: false, reason: 'comp' };
  // The ONE premium rule (premium-entitlement.ts), never a local copy of its status list.
  if (isPremiumEntitled(row)) {
    return { eligible: false, reason: 'currently_premium' };
  }
  // ⚠️ `purchase_provider` DEFAULTS TO 'stripe' (20260423_add_revenuecat_fields.sql), so every row
  // carries it, purchase or not. Measured 2026-10-06: 6 free users with no subscription id read as
  // 'ever_subscribed' on that default alone. Only a STORE value is evidence; Stripe history comes from
  // Stripe itself (the `stripeEverSubscribed` argument).
  const everSubscribed = stripeEverSubscribed
    || !!row?.stripe_subscription_id
    || !!row?.apple_original_transaction_id
    || STORE_PROVIDERS.has(row?.purchase_provider ?? '');
  if (everSubscribed) return { eligible: false, reason: 'ever_subscribed' };
  return { eligible: true, reason: null };
}

/** Providers whose presence on a row proves a real store purchase. 'stripe' is the column default. */
const STORE_PROVIDERS: ReadonlySet<string> = new Set(['apple', 'google']);

/**
 * Stripe statuses that do NOT mean the customer ever subscribed. An abandoned checkout can leave an
 * `incomplete` subscription that expires to `incomplete_expired` with no payment ever taken.
 */
const NEVER_PAID_STRIPE_STATUSES: ReadonlySet<string> = new Set(['incomplete', 'incomplete_expired']);

/** True when a Stripe `GET /v1/subscriptions?status=all` list holds a subscription that ever started. */
export function stripeHistoryShowsSubscription(list: unknown): boolean {
  const data = (list as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return false;
  return data.some((sub) => {
    const status = (sub as { status?: unknown } | null)?.status;
    // An unreadable status fails CLOSED: it counts as a subscription.
    return typeof status !== 'string' || !NEVER_PAID_STRIPE_STATUSES.has(status);
  });
}

/** The coupon to apply, or null when the offer is not configured for that plan (fail closed). */
export function introCouponFor(
  plan: IntroPlan,
  coupons: { monthly?: string | null; yearly?: string | null },
): string | null {
  const id = (plan === 'monthly' ? coupons.monthly : coupons.yearly)?.trim();
  return id ? id : null;
}

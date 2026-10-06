import { describe, it, expect } from 'vitest';
import { decideIntroEligibility, introCouponFor, stripeHistoryShowsSubscription } from '../../../supabase/functions/_shared/intro-eligibility';
import { PREMIUM_ENTITLED_STATUSES } from '../../../supabase/functions/_shared/premium-entitlement';

describe('decideIntroEligibility - new subscribers only, fails closed', () => {
  it('a user with no row and no Stripe history is eligible', () => {
    expect(decideIntroEligibility(null, false)).toEqual({ eligible: true, reason: null });
  });

  it('a free user whose row only holds a customer id is eligible', () => {
    expect(decideIntroEligibility({ plan: 'free', subscription_status: null }, false))
      .toEqual({ eligible: true, reason: null });
  });

  it('any Stripe subscription in the history, even a cancelled one, is not eligible', () => {
    expect(decideIntroEligibility(null, true)).toEqual({ eligible: false, reason: 'ever_subscribed' });
  });

  it.each([
    ['stripe_subscription_id', { stripe_subscription_id: 'sub_123' }],
    ['apple_original_transaction_id', { apple_original_transaction_id: '1000000' }],
    ['purchase_provider', { purchase_provider: 'google' }],
  ])('a past %s means not eligible', (_name, row) => {
    expect(decideIntroEligibility({ plan: 'free', ...row }, false))
      .toEqual({ eligible: false, reason: 'ever_subscribed' });
  });

  it('the column DEFAULT purchase_provider=stripe alone is not a purchase (6 free users read ever_subscribed on it, 2026-10-06)', () => {
    expect(decideIntroEligibility({ plan: 'free', subscription_status: 'inactive', is_comp: true, purchase_provider: 'stripe' }, false))
      .toEqual({ eligible: true, reason: null });
  });

  it.each(['testimonial_reward', 'streak_reward'])('a LAPSED %s comp (never paid) stays eligible', (provider) => {
    expect(decideIntroEligibility({ plan: 'free', subscription_status: 'canceled', is_comp: true, purchase_provider: provider }, false))
      .toEqual({ eligible: true, reason: null });
  });

  it('an OPEN testimonial comp is not eligible (comp)', () => {
    expect(decideIntroEligibility({ plan: 'premium', subscription_status: 'active', is_comp: true, purchase_provider: 'testimonial_reward' }, false))
      .toEqual({ eligible: false, reason: 'comp' });
  });

  it('a past apple provider is still not eligible', () => {
    expect(decideIntroEligibility({ plan: 'free', purchase_provider: 'apple' }, false))
      .toEqual({ eligible: false, reason: 'ever_subscribed' });
  });

  it.each([...PREMIUM_ENTITLED_STATUSES])('premium with status %s is not eligible', (status) => {
    expect(decideIntroEligibility({ plan: 'premium', subscription_status: status }, false))
      .toEqual({ eligible: false, reason: 'currently_premium' });
  });

  it('a comp grant is not eligible, and comp wins over every other reason', () => {
    expect(decideIntroEligibility({ is_comp: true, plan: 'premium', subscription_status: 'active' }, true))
      .toEqual({ eligible: false, reason: 'comp' });
  });

  it('a FREE row is eligible even though is_comp defaults to true (one abandoned checkout must not cost the offer)', () => {
    expect(decideIntroEligibility({ is_comp: true, plan: 'free', subscription_status: 'inactive' }, false))
      .toEqual({ eligible: true, reason: null });
  });

  it('a lapsed comp grant (premium plan, no money) is still not eligible', () => {
    expect(decideIntroEligibility({ is_comp: true, plan: 'premium', subscription_status: 'canceled' }, false))
      .toEqual({ eligible: false, reason: 'comp' });
  });

  it('a lapsed premium row with no subscription ids still fails on the Stripe history', () => {
    expect(decideIntroEligibility({ plan: 'premium', subscription_status: 'canceled' }, true))
      .toEqual({ eligible: false, reason: 'ever_subscribed' });
  });
});

describe('introCouponFor - no coupon configured means no offer', () => {
  const coupons = { monthly: 'intro-monthly', yearly: ' intro-yearly ' };
  it('returns the plan\'s coupon, trimmed', () => {
    expect(introCouponFor('monthly', coupons)).toBe('intro-monthly');
    expect(introCouponFor('yearly', coupons)).toBe('intro-yearly');
  });
  it('returns null for a missing or blank coupon', () => {
    expect(introCouponFor('monthly', {})).toBeNull();
    expect(introCouponFor('yearly', { yearly: '   ' })).toBeNull();
    expect(introCouponFor('monthly', { monthly: null, yearly: 'x' })).toBeNull();
  });
});

describe('stripeHistoryShowsSubscription - an abandoned checkout is not a subscription', () => {
  it('an empty or unreadable list is no history', () => {
    expect(stripeHistoryShowsSubscription({ data: [] })).toBe(false);
    expect(stripeHistoryShowsSubscription(null)).toBe(false);
  });
  it('incomplete and incomplete_expired alone are not history', () => {
    expect(stripeHistoryShowsSubscription({ data: [{ status: 'incomplete' }, { status: 'incomplete_expired' }] })).toBe(false);
  });
  it.each([...PREMIUM_ENTITLED_STATUSES, 'canceled', 'unpaid', 'paused'])('a %s subscription is history', (status) => {
    expect(stripeHistoryShowsSubscription({ data: [{ status: 'incomplete_expired' }, { status }] })).toBe(true);
  });
  it('a subscription with no readable status fails closed', () => {
    expect(stripeHistoryShowsSubscription({ data: [{}] })).toBe(true);
  });
});

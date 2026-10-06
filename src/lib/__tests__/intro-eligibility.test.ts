import { describe, it, expect } from 'vitest';
import { decideIntroEligibility, introCouponFor } from '../../../supabase/functions/_shared/intro-eligibility';
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

  it.each([...PREMIUM_ENTITLED_STATUSES])('premium with status %s is not eligible', (status) => {
    expect(decideIntroEligibility({ plan: 'premium', subscription_status: status }, false))
      .toEqual({ eligible: false, reason: 'currently_premium' });
  });

  it('a comp grant is not eligible, and comp wins over every other reason', () => {
    expect(decideIntroEligibility({ is_comp: true, plan: 'premium', subscription_status: 'active' }, true))
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

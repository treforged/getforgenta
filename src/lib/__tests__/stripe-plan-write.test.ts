import { describe, it, expect } from 'vitest';
import { stripePlanWrite } from '../../../supabase/functions/_shared/stripe-plan-write';
import { isPremiumEntitled } from '../../../supabase/functions/_shared/premium-entitlement';

/**
 * ask 93d17f7e - a Stripe subscription entering past_due must KEEP the plan it had, so the grace
 * period Tre enabled can fire. It must not be demoted to free, and it must not be promoted to
 * premium either. Both halves are asserted, because either one alone is satisfied by a broken
 * writer.
 */
describe('stripePlanWrite', () => {
  it('writes premium for a live subscription and free for a dead one', () => {
    expect(stripePlanWrite('active')).toEqual({ plan: 'premium' });
    expect(stripePlanWrite('trialing')).toEqual({ plan: 'premium' });
    for (const dead of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
      expect(stripePlanWrite(dead)).toEqual({ plan: 'free' });
    }
  });

  it('writes NO plan key at all for past_due - not premium, not free', () => {
    const w = stripePlanWrite('past_due');
    expect(w).toEqual({});
    expect('plan' in w).toBe(false);
  });
});

/** The row as the webhook's update leaves it, applied to the row that was already there. */
const afterUpdate = (row: { plan: string; subscription_status: string }, status: string) =>
  ({ ...row, subscription_status: status, ...stripePlanWrite(status) });

describe('the grace period, end to end through the entitlement predicate', () => {
  it('a premium subscriber whose renewal fails KEEPS access while Stripe retries', () => {
    const row = afterUpdate({ plan: 'premium', subscription_status: 'active' }, 'past_due');
    expect(row.plan).toBe('premium');
    expect(isPremiumEntitled(row)).toBe(true);
  });

  it('and LOSES it when Stripe gives up - canceled or unpaid', () => {
    for (const end of ['canceled', 'unpaid']) {
      const graced = afterUpdate({ plan: 'premium', subscription_status: 'active' }, 'past_due');
      const ended = afterUpdate(graced, end);
      expect(ended.plan).toBe('free');
      expect(isPremiumEntitled(ended)).toBe(false);
    }
  });

  it('a FREE row that goes past_due is NOT promoted to premium', () => {
    const row = afterUpdate({ plan: 'free', subscription_status: 'incomplete' }, 'past_due');
    expect(row.plan).toBe('free');
    expect(isPremiumEntitled(row)).toBe(false);
  });
});

/**
 * THE SDK MUST BE CONFIGURED FOR THE RIGHT PERSON, AND FOR THE RETURNING ONE.
 *
 * `Purchases.configure({ appUserID })` is what ties a purchase to a human being. Two ways that
 * went wrong, both found on 2026-09-05 while answering why the app has eleven subscription rows
 * and no income:
 *
 *  1. A bare `configured` boolean meant "the SDK is configured", not "configured for THIS
 *     person". A second user arriving on a live SDK would have had their entitlements attached
 *     to the first user's RevenueCat customer.
 *  2. Nothing here proves it, but it is why this file exists: AuthContext only called
 *     initRevenueCat on SIGNED_IN, never on INITIAL_SESSION, so a returning user who stayed
 *     signed in never configured the SDK at all — and every purchase call returns null without
 *     it. See AuthContext.tsx for that half.
 *
 * Would-fail checks: go back to a boolean latch and "reconfigures when a DIFFERENT user signs
 * in" fails, because the second configure is skipped; drop the logOut before it and
 * "hangs up on the previous customer first" fails, which is the call that stops the new user's
 * purchases landing on the old customer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  native: true,
  configureCalls: [] as { apiKey: string; appUserID: string }[],
  logOutCalls: 0,
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => h.native,
    getPlatform: () => 'ios',
  },
}));

vi.mock('@revenuecat/purchases-capacitor', () => ({
  Purchases: {
    configure: async (opts: { apiKey: string; appUserID: string }) => { h.configureCalls.push(opts); },
    logOut: async () => { h.logOutCalls += 1; },
  },
}));

import {
  initRevenueCat, logOutRevenueCat, isRevenueCatConfigured, __resetRevenueCatForTests,
} from '@/lib/purchases';

describe('RevenueCat identity', () => {
  beforeEach(() => {
    h.native = true;
    h.configureCalls = [];
    h.logOutCalls = 0;
    __resetRevenueCatForTests();
    vi.stubEnv('VITE_REVENUECAT_IOS_API_KEY', 'appl_test_key');
  });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('configures with the Supabase user id, so a purchase attaches to the buyer', async () => {
    await initRevenueCat('user-a');
    expect(h.configureCalls).toHaveLength(1);
    expect(h.configureCalls[0].appUserID).toBe('user-a');
    expect(isRevenueCatConfigured()).toBe(true);
  });

  it('does not reconfigure for the SAME user', async () => {
    await initRevenueCat('user-a');
    await initRevenueCat('user-a');
    expect(h.configureCalls).toHaveLength(1);
    expect(h.logOutCalls).toBe(0);
  });

  it('hangs up on the previous customer first, then reconfigures for a DIFFERENT user', async () => {
    await initRevenueCat('user-a');
    await initRevenueCat('user-b');

    expect(h.logOutCalls).toBe(1);
    expect(h.configureCalls.map(c => c.appUserID)).toEqual(['user-a', 'user-b']);
  });

  it('is not configured after signing out, so a stale customer cannot be charged', async () => {
    await initRevenueCat('user-a');
    await logOutRevenueCat();
    expect(isRevenueCatConfigured()).toBe(false);
    expect(h.logOutCalls).toBe(1);
  });

  it('does nothing at all on web', async () => {
    h.native = false;
    await initRevenueCat('user-a');
    expect(h.configureCalls).toHaveLength(0);
    expect(isRevenueCatConfigured()).toBe(false);
  });
});

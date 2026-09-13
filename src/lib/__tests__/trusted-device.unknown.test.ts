// @vitest-environment jsdom
//
/**
 * "NOT TRUSTED" AND "COULD NOT LOOK" ARE DIFFERENT ANSWERS.
 *
 * Tre, 2026-09-13: "keep me logged in." The most likely cause measured that day was not the idle
 * timeout being wrong and not the token expiring — it was `isDeviceTrusted` mapping EVERY failure
 * to `false`. One `profiles` read that did not come back took his trusted browser from the
 * 12-hour leash to the 10-minute one, and the toast then told him he was signed out "due to 10
 * minutes of inactivity". True sentence, wrong reason, and no way for him to tell.
 *
 * ⚠️ THIS IS NOT AN EDGE CASE ON THIS INSTANCE. `profiles` is bimodal — median 347ms against a
 * p95 of 5082ms, with 504s in the same 24 hours (ask 73df5d2b). A transient failure of that read
 * is ordinary, and it landed on the behaviour users notice most.
 *
 * ⚠️ THE SECURITY HALF IS DELIBERATELY UNCHANGED, and the last case pins it. `isDeviceTrusted`
 * still fails CLOSED, because its other caller gates 2FA: an unreadable profile must never skip a
 * prompt. Only the idle leash consumes the third state. A "simplification" that makes the boolean
 * return true on `unknown` would turn a network blip into a 2FA bypass.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const state = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as unknown },
  throws: false,
  deviceId: 'device-abc' as string | null,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            if (state.throws) throw new Error('network down');
            return state.result;
          },
        }),
      }),
      update: () => ({ eq: async () => ({ data: null, error: null }) }),
    }),
  },
}));

import { readDeviceTrust, isDeviceTrusted } from '@/lib/trusted-device';

const TRUST_KEY = 'forged:trusted_device_id';
const USER = 'user-1';
const fresh = () => new Date().toISOString();

beforeEach(() => {
  state.throws = false;
  state.result = { data: null, error: null };
  localStorage.setItem(TRUST_KEY, 'device-abc');
});
afterEach(() => { localStorage.clear(); vi.clearAllMocks(); });

describe('readDeviceTrust — the three answers are distinguishable', () => {
  it('TRUSTED: the profile lists this device and the grant is fresh', async () => {
    state.result = { data: { trusted_devices: [{ device_id: 'device-abc', last_seen: fresh() }] }, error: null };
    expect(await readDeviceTrust(USER)).toBe('trusted');
  });

  it('UNTRUSTED: the profile was read and this device is not on it', async () => {
    state.result = { data: { trusted_devices: [{ device_id: 'someone-else', last_seen: fresh() }] }, error: null };
    expect(await readDeviceTrust(USER)).toBe('untrusted');
  });

  it('⚠️ THE DEFECT — an ERROR is UNKNOWN, not untrusted', async () => {
    // The old boolean returned false here, which is what shortened the leash.
    state.result = { data: null, error: { message: 'timeout' } };
    expect(await readDeviceTrust(USER)).toBe('unknown');
  });

  it('⚠️ AND A THROW IS UNKNOWN TOO — offline is not a revocation', async () => {
    state.throws = true;
    expect(await readDeviceTrust(USER)).toBe('unknown');
  });

  it('no local device id is a genuine UNTRUSTED, not an unknown', async () => {
    // This device has never been trusted. That is a reading, and it must not keep a stale
    // "trusted" standing in the caller.
    localStorage.removeItem(TRUST_KEY);
    expect(await readDeviceTrust(USER)).toBe('untrusted');
  });

  it('an EXPIRED grant reads untrusted, not unknown — the lapse is a real answer', async () => {
    const longAgo = new Date(Date.now() - 400 * 24 * 3600_000).toISOString();
    state.result = { data: { trusted_devices: [{ device_id: 'device-abc', last_seen: longAgo }] }, error: null };
    expect(await readDeviceTrust(USER)).toBe('untrusted');
  });
});

describe('isDeviceTrusted — still fails CLOSED, because it gates 2FA', () => {
  it.each([
    ['an error', () => { state.result = { data: null, error: { message: 'timeout' } }; }],
    ['a throw', () => { state.throws = true; }],
  ])('%s does NOT skip the prompt', async (_label, arrange) => {
    arrange();
    expect(await isDeviceTrusted(USER)).toBe(false);
  });

  it('and a real grant still returns true, so the fail-closed default is not just "always false"', async () => {
    state.result = { data: { trusted_devices: [{ device_id: 'device-abc', last_seen: fresh() }] }, error: null };
    expect(await isDeviceTrusted(USER)).toBe(true);
  });
});

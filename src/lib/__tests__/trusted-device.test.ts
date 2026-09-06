// @vitest-environment jsdom
// (jsdom, unusually for a lib test: the module under test re-exports through `@/lib/supabase`,
// whose import touches `localStorage` — and the migration under test IS localStorage behavior.)
//
// The trust grant that skips 2FA now also picks the idle timeout, so its expiry rule and the key
// migration both need pinning. Synthetic values only.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTrustedDeviceId, isTrustRecordFresh, TRUSTED_DEVICE_KEY, TRUST_LIFETIME_MS,
  shouldTouchLastSeen, TOUCH_THROTTLE_MS,
} from '../trusted-device';

const NOW = new Date('2026-08-13T12:00:00Z').getTime();

describe('isTrustRecordFresh', () => {
  it('accepts a grant inside its lifetime', () => {
    expect(isTrustRecordFresh({ trusted_at: new Date(NOW - TRUST_LIFETIME_MS + 60_000).toISOString() }, NOW)).toBe(true);
  });

  it('rejects a grant past its lifetime', () => {
    expect(isTrustRecordFresh({ trusted_at: new Date(NOW - TRUST_LIFETIME_MS - 60_000).toISOString() }, NOW)).toBe(false);
  });

  it('rejects an unparseable date rather than trusting it', () => {
    expect(isTrustRecordFresh({ trusted_at: 'not a date' }, NOW)).toBe(false);
  });

  // ── The sliding window (2026-09-06) ────────────────────────────────────────
  //
  // The bug this closes, measured on Tre's own profile: a phone in DAILY USE went quietly
  // untrusted exactly 30 days after `trusted_at` and dropped from the 12-hour idle leash to the
  // 10-minute one, with nothing on screen to explain it. His iPhone (trusted 2026-07-13) and his
  // PC (trusted 2026-08-05) had BOTH expired — which is his "it keeps logging out on mobile".

  it('keeps a device trusted when the GRANT is old but it was seen recently', () => {
    // The whole point. Without the last_seen arm this is false and the user is signed out.
    expect(isTrustRecordFresh({
      trusted_at: new Date(NOW - TRUST_LIFETIME_MS - 60_000).toISOString(),
      last_seen: new Date(NOW - 60_000).toISOString(),
    }, NOW)).toBe(true);
  });

  it('still expires a device that has not been seen for the whole lifetime', () => {
    // The security property that must survive the fix: an untouched device loses trust.
    expect(isTrustRecordFresh({
      trusted_at: new Date(NOW - TRUST_LIFETIME_MS - 60_000).toISOString(),
      last_seen: new Date(NOW - TRUST_LIFETIME_MS - 60_000).toISOString(),
    }, NOW)).toBe(false);
  });

  it('falls back to trusted_at when last_seen is missing or unparseable', () => {
    expect(isTrustRecordFresh({
      trusted_at: new Date(NOW - 60_000).toISOString(),
    }, NOW)).toBe(true);
    expect(isTrustRecordFresh({
      trusted_at: new Date(NOW - 60_000).toISOString(),
      last_seen: 'not a date',
    }, NOW)).toBe(true);
    expect(isTrustRecordFresh({
      trusted_at: new Date(NOW - TRUST_LIFETIME_MS - 60_000).toISOString(),
      last_seen: 'not a date',
    }, NOW)).toBe(false);
  });

  it('takes the LATER of the two, not whichever it reads first', () => {
    // last_seen BEFORE trusted_at (a clock skew or a reordered write) must not shorten the grant.
    expect(isTrustRecordFresh({
      trusted_at: new Date(NOW - 60_000).toISOString(),
      last_seen: new Date(NOW - TRUST_LIFETIME_MS - 60_000).toISOString(),
    }, NOW)).toBe(true);
  });
});

describe('shouldTouchLastSeen — the throttle on writing a sighting back', () => {
  it('does not write when the record was touched recently', () => {
    expect(shouldTouchLastSeen({ last_seen: new Date(NOW - 60_000).toISOString() }, NOW)).toBe(false);
  });

  it('writes once the throttle window has passed', () => {
    expect(shouldTouchLastSeen({ last_seen: new Date(NOW - TOUCH_THROTTLE_MS - 1).toISOString() }, NOW)).toBe(true);
  });

  it('writes when last_seen is unparseable, so a broken record repairs itself', () => {
    expect(shouldTouchLastSeen({ last_seen: 'not a date' }, NOW)).toBe(true);
  });

  it('does nothing without a record', () => {
    expect(shouldTouchLastSeen(undefined, NOW)).toBe(false);
  });

  it('throttles well inside the trust lifetime, or the window would not actually slide', () => {
    // A throttle longer than the lifetime would make the sliding window decorative.
    expect(TOUCH_THROTTLE_MS).toBeLessThan(TRUST_LIFETIME_MS);
  });
});

describe('getTrustedDeviceId — the key migration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads the canonical key', () => {
    localStorage.setItem(TRUSTED_DEVICE_KEY, 'dev-1');
    expect(getTrustedDeviceId()).toBe('dev-1');
  });

  it('migrates the legacy forged: spelling and removes it', () => {
    // The bug this fixes: Auth wrote `forgenta:…` while Settings read `forged:…`, so the Settings
    // page never recognized the device it was on. Old profiles still carry the legacy key.
    localStorage.setItem('forged:trusted_device_id', 'dev-legacy');
    expect(getTrustedDeviceId()).toBe('dev-legacy');
    expect(localStorage.getItem(TRUSTED_DEVICE_KEY)).toBe('dev-legacy');
    expect(localStorage.getItem('forged:trusted_device_id')).toBeNull();
  });

  it('prefers the canonical key when both exist', () => {
    localStorage.setItem(TRUSTED_DEVICE_KEY, 'dev-current');
    localStorage.setItem('forged:trusted_device_id', 'dev-stale');
    expect(getTrustedDeviceId()).toBe('dev-current');
  });

  it('returns null when neither exists — never invents an id', () => {
    expect(getTrustedDeviceId()).toBeNull();
  });
});

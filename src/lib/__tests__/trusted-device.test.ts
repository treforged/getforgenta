// @vitest-environment jsdom
// (jsdom, unusually for a lib test: the module under test re-exports through `@/lib/supabase`,
// whose import touches `localStorage` — and the migration under test IS localStorage behavior.)
//
// The trust grant that skips 2FA now also picks the idle timeout, so its expiry rule and the key
// migration both need pinning. Synthetic values only.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTrustedDeviceId, isTrustRecordFresh, TRUSTED_DEVICE_KEY, TRUST_LIFETIME_MS,
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

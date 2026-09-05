// REGISTRATION HAS TO BE ABLE TO RECOVER.
//
// ⚠️ THE DEFECT THIS GUARDS IS NOT ABOUT ONE PHONE. `registerForPush` fires in exactly one place —
// `AuthContext`, on `SIGNED_IN || INITIAL_SESSION` — so it only runs when a session is
// established. iOS routinely RESUMES an app from memory rather than cold-starting it, and a
// resumed app does not re-run sign-in. A device whose registration fails once therefore may NEVER
// try again: no token, no notifications, nothing re-attempting until the person signs out and back
// in, which almost nobody does. Measured 2026-09-05: 48 candidates, all unreachable.
//
// The retry runs on somebody's phone and makes a network call, so "can it loop" is not a question
// to settle by reading the code. The decision is pure and pinned here.

import { describe, it, expect } from 'vitest';
import {
  shouldRetryPushRegistration, PUSH_RETRY_COOLDOWN_MS,
} from '@/lib/push-retry';

const base = { isNative: true, hasToken: false, now: 10_000_000, lastAttempt: 0 };

describe('shouldRetryPushRegistration', () => {
  it('retries for a native device with no token', () => {
    expect(shouldRetryPushRegistration(base)).toBe(true);
  });

  it('⚠️ never retries once a token exists — a working device must not re-register for ever', () => {
    expect(shouldRetryPushRegistration({ ...base, hasToken: true })).toBe(false);
  });

  it('does nothing on the web, where there is nothing to register with', () => {
    expect(shouldRetryPushRegistration({ ...base, isNative: false })).toBe(false);
  });

  it('⚠️ WILL NOT FIRE ON EVERY FOREGROUND — that is how a phone is normally used', () => {
    const now = 10_000_000;
    // Backgrounded and foregrounded a second later: no attempt.
    expect(shouldRetryPushRegistration({ ...base, now, lastAttempt: now - 1_000 })).toBe(false);
    // Still inside the window near its end.
    expect(shouldRetryPushRegistration({
      ...base, now, lastAttempt: now - (PUSH_RETRY_COOLDOWN_MS - 1),
    })).toBe(false);
  });

  it('retries again once the cooldown has genuinely elapsed', () => {
    const now = 10_000_000;
    expect(shouldRetryPushRegistration({
      ...base, now, lastAttempt: now - PUSH_RETRY_COOLDOWN_MS,
    })).toBe(true);
  });

  it('has a cooldown long enough to be meaningful, so the constant cannot be trimmed to nothing', () => {
    // A guard that is one second long is not a guard. Pinned so a later "tuning" cannot silently
    // turn this into a request per foreground.
    expect(PUSH_RETRY_COOLDOWN_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('the token check beats the cooldown — order of guards matters', () => {
    // A device with a token must not retry even after any amount of time.
    expect(shouldRetryPushRegistration({
      ...base, hasToken: true, lastAttempt: 0, now: Number.MAX_SAFE_INTEGER,
    })).toBe(false);
  });
});

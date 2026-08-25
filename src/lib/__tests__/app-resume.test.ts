// WARNING: what this protects. Tre, 2026-08-24: "if a user leaves the app running in the background
// for too long, the app stays stuck on the cover screen. it should auto refresh." The half of that
// which lives in JS is the session going stale while the WebView was suspended. The two things that
// must stay true here are that no step can hang, and that "nothing answered" never gets rounded up
// into "you are signed out".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import {
  recoverSession,
  RESUME_STALE_MS,
  RESUME_PROBE_TIMEOUT_MS,
  RESUME_EXPIRY_MARGIN_MS,
  type ResumeAuth,
} from '../app-resume';

const NOW = 1_800_000_000_000; // fixed clock; the probe takes `now` so nothing here depends on real time

/** A session that expires `seconds` from NOW. Only `expires_at` is read by the probe. */
function sessionExpiringIn(seconds: number): Session {
  return { expires_at: Math.floor(NOW / 1000) + seconds } as Session;
}

function auth(overrides: Partial<ResumeAuth>): ResumeAuth {
  return {
    getSession: async () => ({ data: { session: sessionExpiringIn(3600) }, error: null }),
    refreshSession: async () => ({ data: { session: sessionExpiringIn(3600) }, error: null }),
    ...overrides,
  };
}

const AWAY = RESUME_STALE_MS + 1;

describe('a short trip out of the app is not a stale session', () => {
  it('does no work at all below the staleness threshold', async () => {
    const getSession = vi.fn(async () => ({ data: { session: sessionExpiringIn(3600) }, error: null }));
    const outcome = await recoverSession(auth({ getSession }), RESUME_STALE_MS - 1, NOW);
    expect(outcome).toBe('skipped');
    // The point of the threshold: flicking to a text message must not cost a round trip.
    expect(getSession).not.toHaveBeenCalled();
  });
});

describe('a session that survived the background is left alone', () => {
  it('reports active without refreshing when the token is comfortably valid', async () => {
    const refreshSession = vi.fn(async () => ({ data: { session: sessionExpiringIn(3600) }, error: null }));
    const outcome = await recoverSession(auth({ refreshSession }), AWAY, NOW);
    expect(outcome).toBe('active');
    expect(refreshSession).not.toHaveBeenCalled();
  });
});

describe('a session that went stale while the app was suspended is refreshed', () => {
  it('refreshes an already-expired token and reports refreshed', async () => {
    const refreshSession = vi.fn(async () => ({ data: { session: sessionExpiringIn(3600) }, error: null }));
    const outcome = await recoverSession(
      auth({ getSession: async () => ({ data: { session: sessionExpiringIn(-7200) }, error: null }), refreshSession }),
      AWAY,
      NOW,
    );
    expect(outcome).toBe('refreshed');
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  // The margin exists so the refresh happens BEFORE the first 401, not after it.
  it('refreshes a token that is valid but about to expire', async () => {
    const stillValidButNearly = Math.floor((RESUME_EXPIRY_MARGIN_MS / 1000) / 2);
    const outcome = await recoverSession(
      auth({ getSession: async () => ({ data: { session: sessionExpiringIn(stillValidButNearly) }, error: null }) }),
      AWAY,
      NOW,
    );
    expect(outcome).toBe('refreshed');
  });

  // An unknown expiry is treated as expired. One wasted request beats one lost session.
  it('refreshes when the session carries no expiry at all', async () => {
    const outcome = await recoverSession(
      auth({ getSession: async () => ({ data: { session: {} as Session }, error: null }) }),
      AWAY,
      NOW,
    );
    expect(outcome).toBe('refreshed');
  });
});

describe('an unrecoverable session ends on the sign-in screen, never on a cover', () => {
  it('reports signed-out when storage no longer holds a session', async () => {
    const outcome = await recoverSession(
      auth({ getSession: async () => ({ data: { session: null }, error: null }) }),
      AWAY,
      NOW,
    );
    expect(outcome).toBe('signed-out');
  });

  it('reports signed-out when the refresh token has been revoked', async () => {
    const revoked = Object.assign(new Error('Invalid Refresh Token'), { name: 'AuthApiError' });
    const outcome = await recoverSession(
      auth({
        getSession: async () => ({ data: { session: sessionExpiringIn(-7200) }, error: null }),
        refreshSession: async () => ({ data: { session: null }, error: revoked }),
      }),
      AWAY,
      NOW,
    );
    expect(outcome).toBe('signed-out');
  });

  it('reports signed-out when the refresh returns no session and no error', async () => {
    const outcome = await recoverSession(
      auth({
        getSession: async () => ({ data: { session: sessionExpiringIn(-7200) }, error: null }),
        refreshSession: async () => ({ data: { session: null }, error: null }),
      }),
      AWAY,
      NOW,
    );
    expect(outcome).toBe('signed-out');
  });
});

describe('nothing answering is not the same as being signed out', () => {
  // ⚠️ THE ONE THAT MATTERS. Coming back to the app on a train must not sign the user out. supabase
  // marks a transport failure with AuthRetryableFetchError and removes the session itself when the
  // token is genuinely gone, so this is the line between the two.
  it('reports unreachable, not signed-out, when the refresh fails on the network', async () => {
    const offline = Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError' });
    const outcome = await recoverSession(
      auth({
        getSession: async () => ({ data: { session: sessionExpiringIn(-7200) }, error: null }),
        refreshSession: async () => ({ data: { session: null }, error: offline }),
      }),
      AWAY,
      NOW,
    );
    expect(outcome).toBe('unreachable');
  });

  it('reports unreachable when the session read itself errors', async () => {
    const outcome = await recoverSession(
      auth({ getSession: async () => ({ data: { session: null }, error: new Error('boom') }) }),
      AWAY,
      NOW,
    );
    expect(outcome).toBe('unreachable');
  });

  it('reports unreachable when the session read throws rather than returning an error', async () => {
    const outcome = await recoverSession(
      auth({ getSession: async () => { throw new Error('boom'); } }),
      AWAY,
      NOW,
    );
    expect(outcome).toBe('unreachable');
  });
});

describe('no step of the probe can hang, because a hang is the bug being fixed', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('gives up on a getSession that never settles', async () => {
    const never = new Promise<never>(() => {});
    const pending = recoverSession(auth({ getSession: () => never }), AWAY, NOW);
    await vi.advanceTimersByTimeAsync(RESUME_PROBE_TIMEOUT_MS + 1);
    await expect(pending).resolves.toBe('unreachable');
  });

  it('gives up on a refreshSession that never settles', async () => {
    const never = new Promise<never>(() => {});
    const pending = recoverSession(
      auth({
        getSession: async () => ({ data: { session: sessionExpiringIn(-7200) }, error: null }),
        refreshSession: () => never,
      }),
      AWAY,
      NOW,
    );
    await vi.advanceTimersByTimeAsync(RESUME_PROBE_TIMEOUT_MS + 1);
    await expect(pending).resolves.toBe('unreachable');
  });

  // A rejection that lands after the deadline has already been declared must not escape as an
  // unhandled rejection, which in this app would be reported as a crash.
  it('survives a probe that rejects after its deadline has passed', async () => {
    const onUnhandled = vi.fn();
    process.on('unhandledRejection', onUnhandled);
    try {
      const late = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('too late')), RESUME_PROBE_TIMEOUT_MS * 2);
      });
      const pending = recoverSession(auth({ getSession: () => late }), AWAY, NOW);
      await vi.advanceTimersByTimeAsync(RESUME_PROBE_TIMEOUT_MS + 1);
      await expect(pending).resolves.toBe('unreachable');
      await vi.advanceTimersByTimeAsync(RESUME_PROBE_TIMEOUT_MS * 2);
      await vi.advanceTimersByTimeAsync(0);
      expect(onUnhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

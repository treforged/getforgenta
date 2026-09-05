// @vitest-environment jsdom
//
// WARNING: what this protects. The idle timeout used to be skipped entirely on native, on the
// stated grounds that "native apps use PIN/biometric lock for security". They do not: `AppLockProvider`
// and `AppLockScreen` are exported and never mounted by anything (`App.tsx` renders neither), so the
// exemption left the phone with no idle protection at all while the web app signed people out after
// ten minutes. Tre, 2026-08-25: stop skipping it on native. Mounting the lock is a separate decision
// and is deliberately NOT what these tests describe.
//
// The three things that have to stay true:
//   1. a phone left alone gets signed out on the same clock as a browser tab,
//   2. the check happens the MOMENT the app is picked up again, because iOS freezes the interval
//      while the WebView is suspended and it would otherwise be up to 30 seconds late,
//   3. a sign-out that Supabase refuses (offline) is never reported as a sign-out that happened.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const IDLE_TIMEOUT_MS = 10 * MINUTE;
const IDLE_CHECK_INTERVAL_MS = 30_000;
const LAST_ACTIVITY_KEY = 'forged:last_activity';

type SessionResult = { data: { session: Session | null }; error: unknown };

const h = vi.hoisted(() => ({
  native: false,
  trusted: false,
  appStateHandlers: [] as ((state: { isActive: boolean }) => void)[],
  authHandlers: [] as ((event: string, session: Session | null) => void)[],
  revenueCatInits: [] as string[],
  getSession: vi.fn<() => Promise<SessionResult>>(),
  refreshSession: vi.fn<() => Promise<SessionResult>>(),
  startAutoRefresh: vi.fn<() => Promise<void>>(),
  signOut: vi.fn<(opts?: unknown) => Promise<{ error: unknown }>>(),
  toast: {
    info: vi.fn<(m: string) => void>(),
    warning: vi.fn<(m: string) => void>(),
    error: vi.fn<(m: string) => void>(),
    success: vi.fn<(m: string) => void>(),
  },
  debugLog: vi.fn<(event: string) => Promise<void>>(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => h.native },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (_event: string, cb: (state: { isActive: boolean }) => void) => {
      h.appStateHandlers.push(cb);
      return { remove: () => { h.appStateHandlers = h.appStateHandlers.filter(x => x !== cb); } };
    },
  },
}));

vi.mock('sonner', () => ({ toast: h.toast }));
vi.mock('@/lib/debugLog', () => ({ debugLog: (e: string) => h.debugLog(e) }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => h.getSession(),
      refreshSession: () => h.refreshSession(),
      startAutoRefresh: () => h.startAutoRefresh(),
      signOut: async (opts?: unknown) => {
        const result = await h.signOut(opts);
        // The real client only emits SIGNED_OUT when it actually removed the session. A refused
        // sign-out (`GoTrueClient._signOut` returns the error before `_removeSession`) emits
        // nothing, and that asymmetry is exactly what the offline test below measures.
        if (!result.error) h.authHandlers.forEach(cb => cb('SIGNED_OUT', null));
        return result;
      },
      onAuthStateChange: (cb: (event: string, session: Session | null) => void) => {
        h.authHandlers.push(cb);
        return { data: { subscription: { unsubscribe: () => { h.authHandlers = h.authHandlers.filter(x => x !== cb); } } } };
      },
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' } }) },
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
    }),
    functions: { invoke: async () => ({ data: null, error: null }) },
  },
}));

// Native/vendor edges AuthProvider pulls in. Not what is under test.
vi.mock('@/lib/purchases', () => ({
  initRevenueCat: async (id: string) => { h.revenueCatInits.push(id); },
  logOutRevenueCat: async () => {},
}));
vi.mock('@/lib/monitoring', () => ({ identifyMonitoringUser: () => {} }));
vi.mock('@/lib/analytics', () => ({ maybeTrackOAuthSignUp: () => {} }));
vi.mock('@/lib/trusted-device', () => ({ isDeviceTrusted: async () => h.trusted }));

import { AuthProvider } from '@/contexts/AuthContext';
import { DemoProvider } from '@/contexts/DemoContext';
import ResumeRecovery from '@/components/shared/ResumeRecovery';

const expiring = (seconds: number) => ({ expires_at: Math.floor(NOW / 1000) + seconds }) as Session;
const SIGNED_IN: SessionResult = {
  data: { session: { ...expiring(3600), user: { id: 'u1', email: 'a@b.c' } } as Session },
  error: null,
};

/** The app as a signed-in person actually has it: a real screen, and `/auth` to fall back to. */
function renderSignedIn({ withResume = false }: { withResume?: boolean } = {}) {
  h.getSession.mockResolvedValue(SIGNED_IN);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <DemoProvider>
          <AuthProvider>
            {withResume ? <ResumeRecovery /> : null}
            <Routes>
              <Route path="/dashboard" element={<div>signed-in surface</div>} />
              <Route path="/auth" element={<div>sign in</div>} />
            </Routes>
          </AuthProvider>
        </DemoProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Waits until the idle watcher is actually armed.
 *
 * Seeding the activity stamp is the first thing the effect does, so the stamp appearing is the
 * observable "this device is being watched". On native before the fix it never appears, which is
 * the bug stated as a failing assertion.
 */
async function waitForIdleWatcher() {
  await waitFor(() => expect(localStorage.getItem(LAST_ACTIVITY_KEY)).toBeTruthy());
}

/** Moves the wall clock forward and lets the 30-second checker tick once. */
async function idleFor(ms: number) {
  vi.setSystemTime(NOW + ms);
  await act(async () => { vi.advanceTimersByTime(IDLE_CHECK_INTERVAL_MS); });
}

/** Backgrounds the app and brings it back `awayMs` later, on the signal that platform uses. */
async function backgroundAndReturn(awayMs: number) {
  vi.setSystemTime(NOW);
  await act(async () => {
    if (h.native) h.appStateHandlers.forEach(cb => cb({ isActive: false }));
    else { setVisibility('hidden'); document.dispatchEvent(new Event('visibilitychange')); }
  });
  // ⚠️ NO TIMER ADVANCE. This is the native hazard written down: iOS suspends the web content
  // process, so the interval does NOT tick while the app is in a pocket. Only the wall clock moves.
  vi.setSystemTime(NOW + awayMs);
  await act(async () => {
    if (h.native) h.appStateHandlers.forEach(cb => cb({ isActive: true }));
    else { setVisibility('visible'); document.dispatchEvent(new Event('visibilitychange')); }
  });
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

/**
 * How many times the app has ASKED Supabase to end the session.
 *
 * ⚠️ ONE SIGN-OUT IS TWO CALLS, and always has been. `signOutWithBroadcast` posts on the
 * `forged_auth` BroadcastChannel, and the spec delivers to every other channel OBJECT of that name
 * including the one this same document is listening on (`AuthContext` cross-tab handler), which
 * calls `auth.signOut()` again. Harmless in production — the second lands on an already-cleared
 * session — but it means a raw call count is not the measure of "signed out once". `toast.info` is.
 */
const signOutAttempts = () => h.signOut.mock.calls.length;

beforeEach(() => {
  h.native = false;
  h.trusted = false;
  h.appStateHandlers = [];
  h.authHandlers = [];
  h.getSession.mockReset().mockResolvedValue(SIGNED_IN);
  h.refreshSession.mockReset().mockResolvedValue({ data: { session: expiring(3600) }, error: null });
  h.startAutoRefresh.mockReset().mockResolvedValue(undefined);
  h.signOut.mockReset().mockResolvedValue({ error: null });
  h.toast.info.mockReset();
  h.toast.warning.mockReset();
  h.toast.error.mockReset();
  h.toast.success.mockReset();
  h.debugLog.mockReset().mockResolvedValue(undefined);
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
  setVisibility('visible');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

describe('the idle timeout runs on native, because nothing else was guarding the phone', () => {
  it('signs a native app out after the same ten idle minutes as the web app', async () => {
    h.native = true;
    renderSignedIn();
    await waitForIdleWatcher();

    await idleFor(IDLE_TIMEOUT_MS + MINUTE);

    await waitFor(() => expect(h.toast.info).toHaveBeenCalledTimes(1));
    expect(h.toast.info).toHaveBeenCalledWith('You were signed out due to 10 minutes of inactivity.');
    expect(await screen.findByText('sign in')).toBeTruthy();
  });

  it('leaves a native app alone at nine minutes, so the leash is the web leash and not a shorter one', async () => {
    h.native = true;
    renderSignedIn();
    await waitForIdleWatcher();

    await idleFor(9 * MINUTE);

    expect(h.signOut).not.toHaveBeenCalled();
    expect(screen.getByText('signed-in surface')).toBeTruthy();
  });

  it('warns at eight minutes on native, the same two-minute notice a browser tab gets', async () => {
    h.native = true;
    renderSignedIn();
    await waitForIdleWatcher();

    await idleFor(8 * MINUTE + 30_000);

    expect(h.toast.warning).toHaveBeenCalledWith('Your session will expire in 2 minutes due to inactivity.');
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it('still honours a trusted device on native: twelve hours, not ten minutes', async () => {
    h.native = true;
    h.trusted = true;
    renderSignedIn();
    await waitForIdleWatcher();
    // The trust probe is a network read; the leash it picks is only correct once it has answered.
    await act(async () => { await Promise.resolve(); });

    await idleFor(30 * MINUTE);
    expect(h.signOut).not.toHaveBeenCalled();

    await idleFor(13 * 60 * MINUTE);
    await waitFor(() => expect(h.toast.info).toHaveBeenCalledTimes(1));
    expect(h.toast.info).toHaveBeenCalledWith('You were signed out after 12 hours of inactivity.');
  });

  // Demo mode is covered by the same test: it never holds a user, so there is no account to sign
  // out of and nothing to arm.
  it('never arms for a device with no signed-in user', async () => {
    h.native = true;
    h.getSession.mockResolvedValue({ data: { session: null }, error: null });
    renderSignedIn();

    await idleFor(IDLE_TIMEOUT_MS + MINUTE);

    expect(h.signOut).not.toHaveBeenCalled();
    expect(localStorage.getItem(LAST_ACTIVITY_KEY)).toBeNull();
  });
});

describe('the web behaviour is unchanged, which is the point of doing it this way', () => {
  it('signs a browser tab out after ten idle minutes', async () => {
    renderSignedIn();
    await waitForIdleWatcher();

    await idleFor(IDLE_TIMEOUT_MS + MINUTE);

    await waitFor(() => expect(h.toast.info).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('sign in')).toBeTruthy();
  });

  it('resets the clock on the same activity events', async () => {
    renderSignedIn();
    await waitForIdleWatcher();

    vi.setSystemTime(NOW + 9 * MINUTE);
    await act(async () => { window.dispatchEvent(new Event('keydown')); });
    expect(localStorage.getItem(LAST_ACTIVITY_KEY)).toBe(String(NOW + 9 * MINUTE));

    // Nine more minutes of typing-then-idle is still under the leash from the LAST keystroke.
    await idleFor(18 * MINUTE);
    expect(h.signOut).not.toHaveBeenCalled();
  });
});

describe('coming back from the background, which is the only signal native can trust', () => {
  // ⚠️ THE HAZARD THIS EXISTS FOR. iOS suspends the WebView, so the 30-second interval does not run
  // while the phone is in a pocket. Without a resume-time check the dashboard, with its balances, is
  // on screen for up to half a minute for whoever picked the phone up.
  it('signs out the instant a native app is reopened, without waiting for the next interval tick', async () => {
    h.native = true;
    renderSignedIn();
    await waitForIdleWatcher();
    await waitFor(() => expect(h.appStateHandlers.length).toBeGreaterThan(0));

    await backgroundAndReturn(30 * MINUTE);

    // ⚠️ NO TIMER TICK BETWEEN THOSE TWO LINES. The sign-out came from the resume signal alone.
    await waitFor(() => expect(h.toast.info).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('sign in')).toBeTruthy();
  });

  // ⚠️ THE COST OF KEEPING THE WEB LISTENERS REGISTERED ON NATIVE. iOS can deliver all three on the
  // way back. They must add up to one sign-out and one message, not three of each.
  it('signs out once even when appStateChange, visibilitychange and focus all land together', async () => {
    h.native = true;
    renderSignedIn();
    await waitForIdleWatcher();
    await waitFor(() => expect(h.appStateHandlers.length).toBeGreaterThan(0));

    vi.setSystemTime(NOW + 30 * MINUTE);
    await act(async () => {
      h.appStateHandlers.forEach(cb => cb({ isActive: true }));
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(h.toast.info).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('sign in')).toBeTruthy();
  });

  it('leaves a short app-switch alone, so reading a text message is not a sign-out', async () => {
    h.native = true;
    renderSignedIn();
    await waitForIdleWatcher();
    await waitFor(() => expect(h.appStateHandlers.length).toBeGreaterThan(0));

    await backgroundAndReturn(2 * MINUTE);

    expect(h.signOut).not.toHaveBeenCalled();
    expect(screen.getByText('signed-in surface')).toBeTruthy();
  });

  // ⚠️ HOW THE TWO PATHS COMPOSE. `ResumeRecovery` re-resolves the session on the same
  // `appStateChange`, and the idle check runs off it too. They must not fight: the person lands on
  // the sign-in screen once, not on a screen that never changes and not half signed out.
  it('lands on sign-in exactly once when the resume probe runs alongside it', async () => {
    h.native = true;
    renderSignedIn({ withResume: true });
    await waitForIdleWatcher();
    // idle watcher + resume recovery + push-registration retry (added 2026-09-05).
    // ⚠️ COUNTED, NOT LOOSENED. This assertion exists because these handlers must not fight, and a
    // `toBeGreaterThan` here would stop noticing when a fourth arrives — which is the point.
    await waitFor(() => expect(h.appStateHandlers.length).toBe(3));

    await backgroundAndReturn(30 * MINUTE);

    expect(await screen.findByText('sign in')).toBeTruthy();
    await waitFor(() => expect(h.startAutoRefresh).toHaveBeenCalled());
    // Told once, not twice, and the resume probe did not pile a second sign-out on top: it only
    // forces one (`{ scope: 'local' }`) for a user the app still thinks is signed in, and by then
    // the idle path had already ended the session.
    expect(h.toast.info).toHaveBeenCalledTimes(1);
    expect(h.signOut).not.toHaveBeenCalledWith({ scope: 'local' });
    expect(h.toast.info).toHaveBeenCalledWith('You were signed out due to 10 minutes of inactivity.');
  });
});

describe('a sign-out that did not happen is never reported as one', () => {
  // ⚠️ SUPABASE CAN REFUSE. `auth.signOut()` calls `/logout` first and, when nothing answers,
  // returns the error WITHOUT clearing the local session. Before this, the idle path had already
  // deleted the activity stamp by then, so the timeout was silently defeated until the next
  // keystroke and the user had been told they were signed out while still signed in.
  const offline = () => Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError' });

  // Deliberately on WEB, where the idle timeout already ran before this slice: it isolates the
  // silent-failure fix from the native change, and both platforms reach the same code.
  it('keeps the leash armed and says so when the network is gone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.signOut.mockResolvedValue({ error: offline() });
    renderSignedIn();
    await waitForIdleWatcher();

    // ⚠️ CAPTURED, NOT ASSUMED. This used to assert the stamp equalled `String(NOW)`, which
    // silently assumed the mount had happened on the same millisecond as `setSystemTime(NOW)`.
    // These timers run with `shouldAdvanceTime`, so the clock moves in real time and the stamp
    // written at mount is NOW + however long the render took — a ~20ms drift that failed only
    // under full-suite load. A suite with a known flake trains everyone to read red as "probably
    // the flaky one", which is how a real failure gets waved through.
    const stampBefore = localStorage.getItem(LAST_ACTIVITY_KEY);
    expect(stampBefore).not.toBeNull();

    await idleFor(IDLE_TIMEOUT_MS + MINUTE);

    await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));
    // Still signed in, and told the truth about it.
    expect(screen.getByText('signed-in surface')).toBeTruthy();
    expect(h.toast.info).not.toHaveBeenCalled();
    expect(h.toast.error).toHaveBeenCalledWith(
      'Your session timed out but we could not sign you out. Check your connection.',
    );
    // The stamp is back EXACTLY as it was, so the next check re-runs the sign-out rather than
    // reading a fresh clock and giving the session another ten minutes. Comparing it to the
    // captured value is also the stronger assertion: it fails if the stamp is refreshed to the
    // current time, which is the actual bug, whereas `String(NOW)` conflated "restored" with
    // "mounted at exactly NOW".
    expect(localStorage.getItem(LAST_ACTIVITY_KEY)).toBe(stampBefore);
    expect(Number(localStorage.getItem(LAST_ACTIVITY_KEY))).toBeLessThan(Date.now() - IDLE_TIMEOUT_MS);
  });

  it('retries on the next check, and does not repeat the message every thirty seconds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.native = true;
    h.signOut.mockResolvedValue({ error: offline() });
    renderSignedIn();
    await waitForIdleWatcher();

    await idleFor(IDLE_TIMEOUT_MS + MINUTE);
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledTimes(1));
    const afterFirstAttempt = signOutAttempts();

    h.signOut.mockResolvedValue({ error: null });
    await idleFor(IDLE_TIMEOUT_MS + 2 * MINUTE);

    // It tried again on the very next check rather than waiting for a keystroke that, on an idle
    // phone, is never coming.
    await waitFor(() => expect(signOutAttempts()).toBeGreaterThan(afterFirstAttempt));
    expect(h.toast.error).toHaveBeenCalledTimes(1); // said once, not once every thirty seconds
    expect(await screen.findByText('sign in')).toBeTruthy();
  });

  // ⚠️ THE PURCHASE PATH FOR A RETURNING USER.
  //
  // `Purchases.configure` is what makes the RevenueCat SDK usable at all: without it,
  // getOfferings, purchasePackage and restorePurchases every one return null, so the paywall
  // has nothing to show and Restore Purchases silently does nothing.
  //
  // It used to be called only on SIGNED_IN. Supabase fires INITIAL_SESSION when it rehydrates a
  // session from storage, which is what happens on nearly every launch of the mobile app -- a
  // person who stays signed in never sees SIGNED_IN again. So the SDK was never configured for
  // exactly the users most likely to buy. This is the same event that was missed once before,
  // in the Google OAuth popup hang (7108311a), and it survives because it never fires in a
  // fresh-login test.
  //
  // Would-fail check: drop 'INITIAL_SESSION' from the condition in AuthContext and the first
  // case here fails with an empty array.
  describe('RevenueCat is configured for a RESTORED session, not only a fresh sign-in', () => {
    it('configures on INITIAL_SESSION, which is what a returning user actually fires', async () => {
      renderSignedIn();
      await waitFor(() => expect(h.authHandlers.length).toBeGreaterThan(0));
      h.revenueCatInits = [];

      h.authHandlers.forEach(cb => cb('INITIAL_SESSION', { user: { id: 'user-restored' } } as unknown as Session));

      await waitFor(() => expect(h.revenueCatInits).toEqual(['user-restored']));
    });

    it('still configures on a fresh SIGNED_IN', async () => {
      renderSignedIn();
      await waitFor(() => expect(h.authHandlers.length).toBeGreaterThan(0));
      h.revenueCatInits = [];

      h.authHandlers.forEach(cb => cb('SIGNED_IN', { user: { id: 'user-fresh' } } as unknown as Session));

      await waitFor(() => expect(h.revenueCatInits).toContain('user-fresh'));
    });

    it('configures nothing when there is no user on the event', async () => {
      renderSignedIn();
      await waitFor(() => expect(h.authHandlers.length).toBeGreaterThan(0));
      h.revenueCatInits = [];

      h.authHandlers.forEach(cb => cb('INITIAL_SESSION', null));

      await new Promise(r => setTimeout(r, 20));
      expect(h.revenueCatInits).toEqual([]);
    });
  });
});

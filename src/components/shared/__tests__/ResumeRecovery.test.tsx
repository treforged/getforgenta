// @vitest-environment jsdom
//
// WARNING: what this protects. Tre, 2026-08-24: "if a user leaves the app running in the background
// for too long, the app stays stuck on the cover screen. it should auto refresh." Nothing in the app
// reacted to coming back before this component existed, so the three things that must stay true are
// that BOTH platform signals drive the recovery, that a session which cannot be recovered ends on
// the sign-in screen rather than on a screen that never changes, and that a network blip does not
// sign anybody out.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';

const NOW = 1_800_000_000_000;
const expiring = (seconds: number) => ({ expires_at: Math.floor(NOW / 1000) + seconds }) as Session;

/** Both auth reads answer in the same shape, and every test needs the nullable/error variants. */
type SessionResult = { data: { session: Session | null }; error: unknown };

const h = vi.hoisted(() => ({
  native: false,
  appStateHandlers: [] as ((state: { isActive: boolean }) => void)[],
  authHandlers: [] as ((event: string, session: Session | null) => void)[],
  getSession: vi.fn<() => Promise<SessionResult>>(),
  refreshSession: vi.fn<() => Promise<SessionResult>>(),
  startAutoRefresh: vi.fn<() => Promise<void>>(),
  signOut: vi.fn<(opts?: unknown) => Promise<{ error: unknown }>>(),
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

vi.mock('@/lib/debugLog', () => ({ debugLog: (e: string) => h.debugLog(e) }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => h.getSession(),
      refreshSession: () => h.refreshSession(),
      startAutoRefresh: () => h.startAutoRefresh(),
      signOut: async (opts?: unknown) => {
        const result = await h.signOut(opts);
        // The real client emits SIGNED_OUT from here, and that emission is the whole point of the
        // call: it is what moves the app off the screen it is stuck on.
        h.authHandlers.forEach(cb => cb('SIGNED_OUT', null));
        return result;
      },
      onAuthStateChange: (cb: (event: string, session: Session | null) => void) => {
        h.authHandlers.push(cb);
        return { data: { subscription: { unsubscribe: () => { h.authHandlers = h.authHandlers.filter(x => x !== cb); } } } };
      },
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' } }) },
    },
  },
}));

// Native/vendor edges AuthProvider pulls in. Not what is under test.
vi.mock('@/lib/purchases', () => ({ initRevenueCat: async () => {}, logOutRevenueCat: async () => {} }));
vi.mock('@/lib/monitoring', () => ({ identifyMonitoringUser: () => {} }));
vi.mock('@/lib/analytics', () => ({ maybeTrackOAuthSignUp: () => {} }));
vi.mock('@/lib/trusted-device', () => ({ isDeviceTrusted: async () => false }));

import ResumeRecovery from '../ResumeRecovery';
import { RESUME_STALE_MS } from '@/lib/app-resume';
import { AuthProvider } from '@/contexts/AuthContext';
import { DemoProvider } from '@/contexts/DemoContext';

const LONG_ENOUGH = RESUME_STALE_MS + 5_000;

const SIGNED_IN = { data: { session: { ...expiring(3600), user: { id: 'u1', email: 'a@b.c' } } as Session }, error: null };

/**
 * The app as it is when the bug bites: signed in on a real screen, then away long enough that the
 * session is gone by the time it comes back. The first `getSession` is AuthProvider restoring the
 * user on mount; everything after it is the resume probe finding what is left.
 */
function renderSignedInThen(afterResume: SessionResult) {
  let call = 0;
  h.getSession.mockImplementation(async () => (call++ === 0 ? SIGNED_IN : afterResume));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <DemoProvider>
          <AuthProvider>
            <ResumeRecovery />
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

/** Sends the app away and brings it back `awayMs` later, on whichever signal the platform uses. */
async function goAwayAndReturn(awayMs: number) {
  const leaveAt = NOW;
  vi.setSystemTime(leaveAt);
  // The user was using the app right up to the moment they left. Without this the idle timeout in
  // AuthContext reads a last-activity stamp from before the clock was moved, decides the session has
  // been idle for decades, and signs the user out from its OWN visibilitychange handler, which is
  // real behaviour on web (AuthContext.tsx checkIdle), just not what these tests are measuring.
  localStorage.setItem('forged:last_activity', String(leaveAt));
  await act(async () => {
    if (h.native) h.appStateHandlers.forEach(cb => cb({ isActive: false }));
    else { setVisibility('hidden'); document.dispatchEvent(new Event('visibilitychange')); }
  });
  vi.setSystemTime(leaveAt + awayMs);
  await act(async () => {
    if (h.native) h.appStateHandlers.forEach(cb => cb({ isActive: true }));
    else { setVisibility('visible'); document.dispatchEvent(new Event('visibilitychange')); }
  });
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
}

beforeEach(() => {
  h.native = false;
  h.appStateHandlers = [];
  h.authHandlers = [];
  h.getSession.mockReset().mockResolvedValue({ data: { session: expiring(3600) }, error: null });
  h.refreshSession.mockReset().mockResolvedValue({ data: { session: expiring(3600) }, error: null });
  h.startAutoRefresh.mockReset().mockResolvedValue(undefined);
  h.signOut.mockReset().mockResolvedValue({ error: null });
  h.debugLog.mockReset().mockResolvedValue(undefined);
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setVisibility('visible');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanup();
});

describe('the web tab recovers on visibilitychange', () => {
  it('re-resolves and refreshes a token that expired while the tab was hidden', async () => {
    h.getSession.mockResolvedValue({ data: { session: expiring(-7200) }, error: null });
    render(<ResumeRecovery />);

    await goAwayAndReturn(LONG_ENOUGH);

    await waitFor(() => expect(h.refreshSession).toHaveBeenCalledTimes(1));
    expect(h.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it('does nothing for a tab that was only hidden for a moment', async () => {
    render(<ResumeRecovery />);
    await goAwayAndReturn(RESUME_STALE_MS - 1_000);
    await waitFor(() => expect(h.startAutoRefresh).toHaveBeenCalledTimes(1));
    expect(h.getSession).not.toHaveBeenCalled();
    expect(h.refreshSession).not.toHaveBeenCalled();
  });
});

describe('the native app recovers on appStateChange, which is the signal it can trust', () => {
  it('refreshes a token that expired while the WebView was suspended', async () => {
    h.native = true;
    h.getSession.mockResolvedValue({ data: { session: expiring(-7200) }, error: null });
    render(<ResumeRecovery />);
    await waitFor(() => expect(h.appStateHandlers.length).toBe(1));

    await goAwayAndReturn(LONG_ENOUGH);

    await waitFor(() => expect(h.refreshSession).toHaveBeenCalledTimes(1));
    expect(h.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(h.signOut).not.toHaveBeenCalled();
  });

  // ⚠️ PLATFORM SEPARATION. Native must not ALSO run off visibilitychange: both signals arrive on
  // iOS and the second one would race the first one's refresh.
  it('ignores visibilitychange on native so the two signals cannot double up', async () => {
    h.native = true;
    h.getSession.mockResolvedValue({ data: { session: expiring(-7200) }, error: null });
    render(<ResumeRecovery />);
    await waitFor(() => expect(h.appStateHandlers.length).toBe(1));

    vi.setSystemTime(NOW);
    await act(async () => { setVisibility('hidden'); document.dispatchEvent(new Event('visibilitychange')); });
    vi.setSystemTime(NOW + LONG_ENOUGH);
    await act(async () => { setVisibility('visible'); document.dispatchEvent(new Event('visibilitychange')); });

    expect(h.startAutoRefresh).not.toHaveBeenCalled();
    expect(h.getSession).not.toHaveBeenCalled();
  });

  it('stops listening when it unmounts', async () => {
    h.native = true;
    const { unmount } = render(<ResumeRecovery />);
    await waitFor(() => expect(h.appStateHandlers.length).toBe(1));
    unmount();
    expect(h.appStateHandlers.length).toBe(0);
  });
});

describe('a session that cannot be recovered lands on sign-in, never on a screen that never changes', () => {
  it('forces a local sign-out when the tokens are gone from storage', async () => {
    renderSignedInThen({ data: { session: null }, error: null });
    expect(await screen.findByText('signed-in surface')).toBeTruthy();

    await goAwayAndReturn(LONG_ENOUGH);

    await waitFor(() => expect(h.signOut).toHaveBeenCalledTimes(1));
    expect(h.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('forces a local sign-out when the refresh token has been revoked', async () => {
    h.refreshSession.mockResolvedValue({
      data: { session: null },
      error: Object.assign(new Error('Invalid Refresh Token'), { name: 'AuthApiError' }),
    });
    renderSignedInThen({ data: { session: expiring(-7200) }, error: null });
    expect(await screen.findByText('signed-in surface')).toBeTruthy();

    await goAwayAndReturn(LONG_ENOUGH);

    await waitFor(() => expect(h.signOut).toHaveBeenCalledWith({ scope: 'local' }));
  });

  // The end-to-end claim: the sign-out above is not a bare call, it is what actually moves the app.
  it('puts the whole app on /auth, proving the failure path exits the gate', async () => {
    renderSignedInThen({ data: { session: null }, error: null });
    expect(await screen.findByText('signed-in surface')).toBeTruthy();

    await goAwayAndReturn(LONG_ENOUGH);

    expect(await screen.findByText('sign in')).toBeTruthy();
  });

  // ⚠️ THE OTHER HALF OF THE SAME RULE, and the one that is easy to get wrong: "no session" is the
  // normal state of somebody reading the landing page. Recovering them onto a sign-in form because
  // they left the tab open would be taking a public page away from a visitor.
  it('leaves a visitor who was never signed in exactly where they were', async () => {
    h.getSession.mockResolvedValue({ data: { session: null }, error: null });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/']}>
          <DemoProvider>
            <AuthProvider>
              <ResumeRecovery />
              <Routes>
                <Route path="/" element={<div>public landing</div>} />
                <Route path="/auth" element={<div>sign in</div>} />
              </Routes>
            </AuthProvider>
          </DemoProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('public landing')).toBeTruthy();

    await goAwayAndReturn(LONG_ENOUGH);

    await waitFor(() => expect(h.getSession).toHaveBeenCalledTimes(2)); // mount, then the resume probe
    expect(h.signOut).not.toHaveBeenCalled();
    expect(screen.getByText('public landing')).toBeTruthy();
  });
});

describe('a network blip is not a sign-out', () => {
  it('leaves the session alone when the refresh could not reach Supabase', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.getSession.mockResolvedValue({ data: { session: expiring(-7200) }, error: null });
    h.refreshSession.mockResolvedValue({
      data: { session: null },
      error: Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError' }),
    });
    render(<ResumeRecovery />);

    await goAwayAndReturn(LONG_ENOUGH);

    await waitFor(() => expect(h.debugLog).toHaveBeenCalledWith(expect.stringContaining('RESUME:unreachable')));
    expect(h.signOut).not.toHaveBeenCalled();
    // ⚠️ NOT A SILENT FAILURE. The app carries on showing what it had and the token may now be
    // stale; a resume that quietly did nothing has to be distinguishable from one that worked.
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('could not reach Supabase'));
  });

  it('says how long the app had been away, so the log can be read against the report', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    h.getSession.mockResolvedValue({ data: { session: null }, error: null });
    render(<ResumeRecovery />);

    await goAwayAndReturn(2 * 60 * 60 * 1000); // two hours, Tre's "too long"

    await waitFor(() => expect(h.debugLog).toHaveBeenCalledWith('RESUME:signed-out away=7200s'));
  });
});

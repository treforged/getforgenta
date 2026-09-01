// @vitest-environment jsdom
// The OAuth popup has to close ITSELF, and for months it did not.
//
// Tre, 2026-09-01: "its not letting me sign in with google again. it gets stuck
// in the pop up. when i close the pop up it logs me in though." Both halves of
// that sentence are one bug. The session was created the moment the popup
// landed back on /auth with ?code=; what never happened was the popup noticing
// and closing, so the opener's poll only completed when the window was shut by
// hand and then found the session that had been there all along.
//
// The cause is an event that never arrives. supabase-js exchanges the PKCE code
// during client init, usually before this page's effect subscribes, and a
// subscriber arriving after the exchange is handed INITIAL_SESSION rather than
// SIGNED_IN. The old handler only acted on SIGNED_IN.
//
// These tests are written against the EVENT, not against the clock, so they
// cannot go green by being lucky about ordering.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

type AuthCallback = (event: string, session: unknown | null) => void;

const state = vi.hoisted(() => ({
  callbacks: [] as AuthCallback[],
  session: null as unknown,
  unsubscribed: 0,
  navigate: undefined as unknown,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: AuthCallback) => {
        state.callbacks.push(cb);
        return { data: { subscription: { unsubscribe: () => { state.unsubscribed += 1; } } } };
      },
      getSession: () => Promise.resolve({ data: { session: state.session } }),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }),
  },
}));

const navigateSpy = vi.hoisted(() => vi.fn());
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => navigateSpy };
});

async function renderAuthAt(search: string) {
  const { default: Auth } = await import('@/pages/Auth');
  return render(
    <MemoryRouter initialEntries={[`/auth${search}`]}>
      <Auth />
    </MemoryRouter>,
  );
}

const SESSION = { access_token: 'a', user: { id: 'u1' } };

let closeSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  state.callbacks = [];
  state.session = null;
  state.unsubscribed = 0;
  navigateSpy.mockReset();
  closeSpy = vi.fn();
  vi.stubGlobal('close', closeSpy);
  Object.defineProperty(window, 'close', { value: closeSpy, writable: true, configurable: true });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'opener', { value: null, writable: true, configurable: true });
  vi.unstubAllGlobals();
});

describe('OAuth popup close', () => {
  it('closes on INITIAL_SESSION, which is what PKCE actually delivers', async () => {
    Object.defineProperty(window, 'opener', { value: {}, writable: true, configurable: true });
    await renderAuthAt('?code=abc123');
    await waitFor(() => expect(state.callbacks.length).toBeGreaterThan(0));

    // The event the old handler ignored, and the reason the popup hung.
    state.callbacks.forEach((cb) => cb('INITIAL_SESSION', SESSION));

    await waitFor(() => expect(closeSpy).toHaveBeenCalled());
  });

  it('still closes on SIGNED_IN, which is what a slower exchange delivers', async () => {
    Object.defineProperty(window, 'opener', { value: {}, writable: true, configurable: true });
    await renderAuthAt('?code=abc123');
    await waitFor(() => expect(state.callbacks.length).toBeGreaterThan(0));

    state.callbacks.forEach((cb) => cb('SIGNED_IN', SESSION));

    await waitFor(() => expect(closeSpy).toHaveBeenCalled());
  });

  it('closes when the session already existed and no event ever arrives', async () => {
    // The exchange finished before this page mounted. Nothing will be emitted,
    // so the direct getSession() read is the only thing that can finish the job.
    state.session = SESSION;
    Object.defineProperty(window, 'opener', { value: {}, writable: true, configurable: true });
    await renderAuthAt('?code=abc123');

    await waitFor(() => expect(closeSpy).toHaveBeenCalled());
  });

  it('navigates instead of closing when there is no opener', async () => {
    // The same callback runs after a full-page redirect, where closing the tab
    // would take the app away with it.
    Object.defineProperty(window, 'opener', { value: null, writable: true, configurable: true });
    await renderAuthAt('?code=abc123');
    await waitFor(() => expect(state.callbacks.length).toBeGreaterThan(0));

    state.callbacks.forEach((cb) => cb('INITIAL_SESSION', SESSION));

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/dashboard', { replace: true }));
    expect(closeSpy).not.toHaveBeenCalled();
  });

  it('does nothing at all without a session, however many events arrive', async () => {
    Object.defineProperty(window, 'opener', { value: {}, writable: true, configurable: true });
    await renderAuthAt('?code=abc123');
    await waitFor(() => expect(state.callbacks.length).toBeGreaterThan(0));

    state.callbacks.forEach((cb) => cb('INITIAL_SESSION', null));
    state.callbacks.forEach((cb) => cb('SIGNED_OUT', null));

    expect(closeSpy).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalledWith('/dashboard', { replace: true });
  });
});

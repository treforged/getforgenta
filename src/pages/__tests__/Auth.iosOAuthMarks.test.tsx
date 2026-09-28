// @vitest-environment jsdom
// The iOS OAuth path writes phase marks to the DBG panel (forged:debug_log).
//
// Tre, 2026-09-28: "google and apple sign in load pretty slow". Measured from the Mac the
// same hour, our own server hops were 0.14-0.50 s (Supabase authorize) and 0.8-1.3 s
// (Google's page), so the slow part is on the device: the sheet, the code exchange, or
// the dashboard after it. These marks are the instrument that splits those phases, so the
// test asserts every mark fires, IN ORDER, on the real press path - a mark that silently
// never fires would make its phase look instant.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const marks = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/debugLog', () => ({ debugLog: (e: string) => { marks.push(e); return Promise.resolve(); } }));

vi.mock('@capacitor/core', async () => {
  const actual = await vi.importActual<typeof import('@capacitor/core')>('@capacitor/core');
  return {
    ...actual,
    Capacitor: { ...actual.Capacitor, getPlatform: () => 'ios', isNativePlatform: () => true },
  };
});

const exchange = vi.hoisted(() => vi.fn(() => Promise.resolve({ error: null })));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: () => Promise.resolve({ data: { session: null } }),
      signInWithOAuth: () => Promise.resolve({ data: { url: 'https://example.test/authorize' }, error: null }),
      exchangeCodeForSession: exchange,
      signOut: vi.fn(),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }),
  },
}));

vi.mock('@/lib/auth-session', () => ({
  AuthSession: { start: () => Promise.resolve({ url: 'com.treforged.forged://auth-callback?code=abc' }) },
}));

const navigateSpy = vi.hoisted(() => vi.fn());
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => navigateSpy };
});

afterEach(() => { cleanup(); marks.length = 0; });

describe('iOS OAuth phase marks', () => {
  it('logs every phase, in order, and still reaches the dashboard', async () => {
    const { default: Auth } = await import('@/pages/Auth');
    render(<MemoryRouter initialEntries={['/auth']}><Auth /></MemoryRouter>);

    // Positive control: the button we press is the real one on the rendered screen.
    const signIn = screen.queryAllByRole('button', { name: /^sign in$/i })[0];
    if (signIn) fireEvent.click(signIn);
    fireEvent.click(await screen.findByRole('button', { name: /continue with google/i }));

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/dashboard', { replace: true }));
    expect(exchange).toHaveBeenCalledWith('abc');

    const phases = marks
      .filter((m) => m.startsWith('OAUTH_google:'))
      .map((m) => m.split(':')[1]);
    expect(phases).toEqual(['START', 'URL_READY', 'SHEET_RETURNED', 'EXCHANGED', 'NAVIGATE_DASHBOARD']);
    for (const m of marks) expect(m).toMatch(/:\+\d+ms$/);
  });
});

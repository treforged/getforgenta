// @vitest-environment jsdom
// After an email sign-up, the page must SAY the account exists and where the link went.
//
// Until 2026-09-30 the only signal was a toast that faded in seconds, and the filled-in form
// stayed on screen. Measured on production that day: POST /auth/v1/signup 200, then the same
// empty-looking form - and 2 of 17 real email sign-ups never confirmed. These tests press the
// real form and assert on what is left ON SCREEN, never on the toast.
//
// The pair matters: a screen that always renders would pass the first test, so the second
// asserts that a sign-up which returns a session (confirmation off) does NOT show it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const state = vi.hoisted(() => ({
  signUpResult: { data: { user: { id: 'u1' } as { id: string } | null, session: null as unknown }, error: null as unknown },
  signUpCalls: 0,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: () => Promise.resolve({ data: { session: null } }),
      signUp: () => { state.signUpCalls += 1; return Promise.resolve(state.signUpResult); },
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }),
  },
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => vi.fn() };
});

const EMAIL = 'new.person@forgenta.test';

async function submitSignUp() {
  const { default: Auth } = await import('@/pages/Auth');
  render(<MemoryRouter initialEntries={['/auth']}><Auth /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Start Free' }));
  fireEvent.change(await screen.findByPlaceholderText('Your name'), { target: { value: 'New Person' } });
  const email = document.querySelector('input[type=email]') as HTMLInputElement;
  fireEvent.change(email, { target: { value: EMAIL } });
  for (const pw of Array.from(document.querySelectorAll('input[type=password]'))) {
    fireEvent.change(pw, { target: { value: 'Str0ng-pass-9!' } });
  }
  fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
  await waitFor(() => expect(state.signUpCalls).toBe(1));
}

beforeEach(() => {
  state.signUpCalls = 0;
  state.signUpResult = { data: { user: { id: 'u1' }, session: null }, error: null };
});
afterEach(() => cleanup());

describe('email sign-up confirmation screen', () => {
  it('replaces the form with the address the link went to when confirmation is pending', async () => {
    await submitSignUp();
    expect(await screen.findByText('Confirm your email')).toBeTruthy();
    expect(screen.getByText(EMAIL)).toBeTruthy();
    // The form is gone, so nobody re-submits it thinking nothing happened.
    expect(screen.queryByRole('button', { name: 'Create Account' })).toBeNull();
  });

  it('does not show it when sign-up returns a session', async () => {
    state.signUpResult = { data: { user: { id: 'u1' }, session: { access_token: 'a' } }, error: null };
    await submitSignUp();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Confirm your email')).toBeNull();
  });

  it('does not show it when sign-up fails', async () => {
    state.signUpResult = { data: { user: null, session: null }, error: new Error('Signups not allowed') };
    await submitSignUp();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Confirm your email')).toBeNull();
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeTruthy();
  });

  it('Back to Sign In opens the sign-in form with the address kept', async () => {
    await submitSignUp();
    fireEvent.click(await screen.findByRole('button', { name: 'Back to Sign In' }));
    await waitFor(() => expect(screen.queryByText('Confirm your email')).toBeNull());
    expect((document.querySelector('input[type=email]') as HTMLInputElement).value).toBe(EMAIL);
    expect(screen.queryByPlaceholderText('Your name')).toBeNull();
  });
});

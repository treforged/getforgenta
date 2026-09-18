// @vitest-environment jsdom
//
// THE COUNTRY IS DERIVED ONCE, INTO A BLANK, AND AN OPT-OUT STAYS OPTED OUT.
//
// ⚠️ THE OPT-OUT CASE IS THE LOAD-BEARING ONE, and it is the one this repo has got wrong before in
// a different shape. On 2026-09-13 the reviewer-account reset was found to be honest about writing
// its columns and useless anyway, because the APP undid the write within a second of the read-back.
// The same failure is available here: a hook that re-derives whenever it finds a null would undo
// the user's opt-out on their very next page load, the control would appear broken while actually
// being overwritten, and every unit test of the WRITE would still pass. So "does not write when
// the user has opted out" is asserted first and deliberately.
//
// ⚠️ AND THE `did not write` ASSERTIONS ARE ONLY MEANINGFUL BESIDE A POSITIVE ONE. A hook that
// never writes at all passes every negative case here and ships a feature that does nothing —
// which is precisely the state `@vercel/speed-insights` sat in for months in this same codebase.
// The first test is therefore the one that proves it CAN write.
//
// ⚠️ AND THE SIGNED-OUT CASE WAS ABSENT UNTIL 2026-09-17, WHICH IS HOW THE DEFECT SHIPPED.
// Every case below mocked `useProfile` and `useDemo` and nothing else, so `user` was never a
// variable in this file at all — the hook was only ever exercised in one authentication state,
// and the guard it actually needed was the one nobody could see was missing. On the PUBLIC
// landing page `useProfile` returns DEFAULT_PROFILE, so `!profile` was false, the write fired
// for every anonymous arrival, and the thrown SIGNED_OUT_READ_ONLY was toasted at a visitor who
// had never had a session. Nothing here went red, because a fixture that is always signed in
// cannot take the signed-out branch.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const state = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  loading: false,
  isDemo: false,
  user: { id: 'u1' } as { id: string } | null,
  mutate: vi.fn(),
  derived: 'US' as string | null,
}));

vi.mock('@/hooks/useSupabaseData', () => ({
  useProfile: () => ({ data: state.profile, loading: state.loading, update: { mutate: state.mutate } }),
}));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: state.isDemo }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('@/lib/derive-country', () => ({
  readCountrySignals: () => ({ timeZone: 'America/New_York', languages: ['en-US'] }),
  deriveCountry: () => state.derived,
}));

import { useDerivedCountry, COUNTRY_OPT_OUT_FLAG } from '@/hooks/useDerivedCountry';

function Probe() {
  useDerivedCountry();
  return null;
}

beforeEach(() => {
  state.profile = { country_code: null, tour_flags: {} };
  state.loading = false;
  state.isDemo = false;
  state.user = { id: 'u1' };
  state.derived = 'US';
  state.mutate = vi.fn();
});
afterEach(cleanup);

describe('useDerivedCountry', () => {
  it('WRITES the derived country into a blank field — the case a do-nothing hook fails', () => {
    render(<Probe />);
    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(state.mutate).toHaveBeenCalledWith({ country_code: 'US' });
  });

  it('does NOT overwrite a country that is already set', () => {
    state.profile = { country_code: 'GB', tour_flags: {} };
    render(<Probe />);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('does NOT refill after the user opted out — the opt-out must survive a page load', () => {
    state.profile = { country_code: null, tour_flags: { [COUNTRY_OPT_OUT_FLAG]: true } };
    render(<Probe />);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('writes NOTHING rather than a guess when no signal is conclusive', () => {
    state.derived = null;
    render(<Probe />);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('is inert in demo mode', () => {
    state.isDemo = true;
    render(<Probe />);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('waits for the profile rather than writing against a missing one', () => {
    state.loading = true;
    state.profile = null;
    render(<Probe />);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('is inert with NO SIGNED-IN USER — the public landing page', () => {
    // The state a real anonymous arrival is in: a DEFAULT_PROFILE with a blank country and no
    // opt-out flag, which is exactly the shape this hook exists to fill. Only `user` separates
    // it from a signed-in user who genuinely needs the write.
    state.user = null;
    render(<Probe />);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('writes once, not once per render', () => {
    const { rerender } = render(<Probe />);
    rerender(<Probe />);
    rerender(<Probe />);
    expect(state.mutate).toHaveBeenCalledTimes(1);
  });
});

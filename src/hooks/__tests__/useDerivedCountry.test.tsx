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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const state = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  loading: false,
  isDemo: false,
  mutate: vi.fn(),
  derived: 'US' as string | null,
}));

vi.mock('@/hooks/useSupabaseData', () => ({
  useProfile: () => ({ data: state.profile, loading: state.loading, update: { mutate: state.mutate } }),
}));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: state.isDemo }) }));
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

  it('writes once, not once per render', () => {
    const { rerender } = render(<Probe />);
    rerender(<Probe />);
    rerender(<Probe />);
    expect(state.mutate).toHaveBeenCalledTimes(1);
  });
});

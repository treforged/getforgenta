// @vitest-environment jsdom
//
// THE GLOBAL BOARD'S EMPTY STATE IS THE FEATURE, SO IT IS WHAT THIS FILE TESTS HARDEST.
//
// Tre, 2026-09-13, asked for a global and country leaderboard and, in the same breath, for the
// guarantee: "Make sure it's secure, and nobody else can just really gonna be accessed anybody's
// else as, like, information or universal status."
//
// Measured that day: 49 accounts exist and exactly ONE has opted any metric in. With a cohort of
// one, a median IS that person's own number and "better than 0%" names them. So the server withholds
// every statistic below a floor of 20, and this card has to render that withholding as a WAIT rather
// than as a SCORE. A null percentage drawn as 0% would turn a privacy floor into "you are last" —
// a confident zero, invented, and demoralising.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  data: null as unknown,
  isLoading: false,
  error: null as unknown,
}));

vi.mock('@/hooks/useSupabaseData', () => ({
  // The card reads the profile for `country_code` and the opt-out flag. Mocked rather than wrapped
  // in a QueryClientProvider so these tests keep asserting the RENDERED SENTENCES, which is what
  // they were written for -- the privacy wording is the thing that must not regress.
  useProfile: () => ({ data: { country_code: 'US', tour_flags: {} }, loading: false, update: { mutate: vi.fn() } }),
}));

vi.mock('@/hooks/useGlobalLeaderboard', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useGlobalLeaderboard')>(
    '@/hooks/useGlobalLeaderboard',
  );
  return {
    // `hasEnoughPeople` is the REAL one on purpose: it encodes "null means not enough, never zero",
    // which is the rule under test. Mocking it would test the mock.
    hasEnoughPeople: actual.hasEnoughPeople,
    useGlobalLeaderboard: () => state,
  };
});

import { GlobalStandingCard } from '../GlobalStandingCard';

beforeEach(() => { state.data = null; state.isLoading = false; state.error = null; });
afterEach(cleanup);

const standing = (over: Record<string, unknown> = {}) => ({
  cohortSize: 40, minCohort: 20, yourBucket: 50, betterThanPct: 62, medianBucket: 45, ...over,
});

describe('below the floor — a wait, never a score', () => {
  it('⚠️ NEVER RENDERS THE WITHHELD PERCENTAGE AS 0%', () => {
    state.data = standing({ cohortSize: 1, betterThanPct: null, medianBucket: null });
    render(<GlobalStandingCard metric="goal_progress" label="Savings goal progress" />);
    expect(screen.queryByText(/ahead of/)).toBeNull();
    expect(screen.queryByText(/0%/)).toBeNull();
  });

  it('says how many are taking part and how many are needed, so the wait is explained', () => {
    state.data = standing({ cohortSize: 1, betterThanPct: null, medianBucket: null });
    render(<GlobalStandingCard metric="goal_progress" label="Savings goal progress" />);
    expect(screen.getByText(/Only 1 person is sharing this so far/)).toBeTruthy();
    expect(screen.getByText(/until 20 are taking part/)).toBeTruthy();
  });

  it('reads naturally when nobody at all is sharing', () => {
    state.data = standing({ cohortSize: 0, yourBucket: null, betterThanPct: null, medianBucket: null });
    render(<GlobalStandingCard metric="goal_progress" label="Savings goal progress" />);
    expect(screen.getByText(/Nobody is sharing this yet/)).toBeTruthy();
  });
});

describe('above the floor — the percentage, and only the percentage', () => {
  it('states the share you are ahead of and the size of the cohort', () => {
    state.data = standing();
    render(<GlobalStandingCard metric="goal_progress" label="Savings goal progress" />);
    expect(screen.getByText('62%')).toBeTruthy();
    expect(screen.getByText(/of the 40 people sharing/)).toBeTruthy();
  });

  it('⚠️ NAMES NOBODY, EVER — the whole constraint, asserted on the rendered text', () => {
    state.data = standing();
    const { container } = render(<GlobalStandingCard metric="goal_progress" label="Savings goal progress" />);
    expect(container.textContent).toMatch(/Nobody sees your name, your amounts or your accounts/);
    // There is no code path that could render one, but asserting it on the OUTPUT is what survives
    // somebody later adding a "top sharers" list to this card.
    expect(container.textContent).not.toMatch(/@/);
  });
});

describe('what it refuses to draw', () => {
  it('renders nothing for a metric the app does not measure', () => {
    // `debt_payoff` is in UNSOURCED_METRICS: nothing computes it, so there is no standing to report
    // and a card saying "not enough people" would blame the cohort for our own gap.
    state.data = standing();
    const { container } = render(<GlobalStandingCard metric="debt_payoff" label="Debt paid down" />);
    expect(container.textContent).toBe('');
  });

  it('⚠️ SAYS SO WHEN THE READ FAILED, rather than drawing a low standing', () => {
    // A standing that could not be loaded is not a bad standing.
    state.error = new Error('network');
    render(<GlobalStandingCard metric="goal_progress" label="Savings goal progress" />);
    expect(screen.getByText(/Could not load how you compare/)).toBeTruthy();
    expect(screen.queryByText(/ahead of/)).toBeNull();
  });

  it('draws nothing while loading — a blank beats a wrong number that then changes', () => {
    state.isLoading = true;
    const { container } = render(<GlobalStandingCard metric="goal_progress" label="Savings goal progress" />);
    expect(container.textContent).toBe('');
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LeaderboardShareToggles } from '../LeaderboardShareToggles';
import { UNSOURCED_METRICS, type LeaderboardMetric } from '@/lib/leaderboard-metrics';

/**
 * These assert the PRIVACY DEFAULT, which is the one thing about this control that must never be
 * wrong: a metric with no row is OFF, and a metric whose state could not be read is not drawn as
 * off either - because a switch reading "Off" is a claim that nothing is being shared.
 *
 * ⚠️ Pressing a button is not the assertion. Each press asserts the CHANGE it requested - which
 * metric, and to which state - because a handler that throws nothing and does nothing looks
 * identical to one that works.
 */

const mutate = vi.fn();
const state = {
  loading: false,
  error: null as Error | null,
  enabled: new Set<LeaderboardMetric>(),
};

vi.mock('@/hooks/useLeaderboardShares', () => ({
  useLeaderboardShares: () => ({
    rows: [],
    loading: state.loading,
    error: state.error,
    refetch: vi.fn(),
    isEnabled: (m: LeaderboardMetric) => state.enabled.has(m),
    enabledMetrics: [...state.enabled],
    setEnabled: { mutate, isPending: false },
  }),
}));

beforeEach(() => {
  mutate.mockClear();
  state.loading = false;
  state.error = null;
  state.enabled = new Set();
});

describe('LeaderboardShareToggles', () => {
  it('defaults every metric to Off when no row exists', () => {
    render(<LeaderboardShareToggles />);
    // ⚠️ STATE COMES FROM `aria-checked` NOW, not from a word. The control is a switch, so the
    // assertion reads the same thing a screen reader and a sighted user both read.
    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(4);
    expect(switches.every(s => s.getAttribute('aria-checked') === 'false')).toBe(true);
  });

  it('shows only the metrics that are actually on as Sharing', () => {
    // Uses a SOURCED metric deliberately. This case used `debt_payoff`, which the app does not
    // measure — see `UNSOURCED_METRICS`. A stale `enabled` flag there now renders OFF, which is the
    // point of the case below, so asserting "on" here would be asserting the bug.
    state.enabled = new Set<LeaderboardMetric>(['savings_streak']);
    render(<LeaderboardShareToggles />);
    const switches = screen.getAllByRole('switch');
    expect(switches.filter(s => s.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(switches.filter(s => s.getAttribute('aria-checked') === 'false')).toHaveLength(3);
  });

  it('turning one ON requests exactly that metric, enabled true', () => {
    render(<LeaderboardShareToggles />);
    fireEvent.click(screen.getByLabelText('Share Savings goal progress with friends'));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ metric: 'goal_progress', enabled: true });
  });

  it('turning one OFF requests enabled false - the direction that must never be wrong', () => {
    state.enabled = new Set<LeaderboardMetric>(['savings_streak']);
    render(<LeaderboardShareToggles />);
    // ⚠️ THE LABEL NAMES THE SETTING, NOT THE ACTION, and does not flip with state: a switch
    // announces its own on/off through `role` + `aria-checked`, so a label that also flipped
    // would say the opposite of what the control reports.
    fireEvent.click(screen.getByLabelText('Share Savings streak with friends'));
    expect(mutate).toHaveBeenCalledWith({ metric: 'savings_streak', enabled: false });
  });

  it('does NOT draw switches in the off position when the state could not be read', () => {
    state.error = new Error('nope');
    render(<LeaderboardShareToggles />);
    // The point is unchanged and is the important one: an unreadable state must not be DRAWN as
    // off, because that would claim nothing is being shared.
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.getByText(/could not load your sharing settings/i)).toBeTruthy();
  });

  it('says the default out loud, because a privacy default nobody can see is not trusted', () => {
    render(<LeaderboardShareToggles />);
    expect(screen.getByText(/off until you turn it on/i)).toBeTruthy();
  });

  it('promises no amounts, on every row', () => {
    render(<LeaderboardShareToggles />);
    expect(screen.getByText(/never the goal or the amount/i)).toBeTruthy();
    expect(screen.getByText(/never a balance/i)).toBeTruthy();
    expect(screen.getByText(/never which/i)).toBeTruthy();
    expect(screen.getByText(/never the figure/i)).toBeTruthy();
  });

  it('cannot be pressed while read-only', () => {
    render(<LeaderboardShareToggles readOnly />);
    fireEvent.click(screen.getByLabelText('Share Savings goal progress with friends'));
    expect(mutate).not.toHaveBeenCalled();
  });
});

/**
 * ⚠️ A SWITCH NOTHING CAN FILL MUST NOT LOOK LIKE A SWITCH THAT IS WORKING.
 *
 * Measured on Tre's account, 2026-09-13: all four metrics `enabled`, a real accepted friendship,
 * and only `goal_progress` and `savings_streak` had ever written a snapshot row. So his stale
 * `enabled = true` must read as OFF rather than as "sharing". Drawing it on would be the app
 * claiming to publish something it has never published, on a privacy control.
 *
 * ⚠️ THE UNSOURCED SET IS DERIVED FROM `UNSOURCED_METRICS`, NEVER TYPED OUT HERE. It was
 * hand-named until 2026-09-15, and wiring `budget_adherence` turned this suite red for the one
 * reason a suite must never go red: the TEST held a second copy of the list. A hand-named
 * inventory is blind to the entry somebody just changed.
 */
describe('metrics the app cannot measure', () => {
  it('renders an UNSOURCED metric as off even when a stale row says it is enabled', () => {
    // The set is DERIVED, so this keeps testing whatever is unsourced today. The guard below is
    // what stops it quietly becoming a test of nothing once every metric is wired.
    expect(UNSOURCED_METRICS.length).toBeGreaterThan(0);
    state.enabled = new Set<LeaderboardMetric>(UNSOURCED_METRICS);
    render(<LeaderboardShareToggles />);
    const on = screen.getAllByRole('switch').filter(s => s.getAttribute('aria-checked') === 'true');
    expect(on).toHaveLength(0);
  });

  it('refuses the press, so nobody can switch on something that would stay empty', () => {
    render(<LeaderboardShareToggles />);
    fireEvent.click(screen.getByLabelText('Share Debt paid down with friends'));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('SAYS WHY, rather than showing a dead control with no explanation', () => {
    render(<LeaderboardShareToggles />);
    expect(screen.getAllByText(/Not ready yet/).length).toBeGreaterThan(0);
  });

  it('⚠️ LEAVES THE SOURCED METRICS FULLY WORKING — the control', () => {
    // Without this, disabling everything would pass all three cases above.
    render(<LeaderboardShareToggles />);
    fireEvent.click(screen.getByLabelText('Share Savings goal progress with friends'));
    expect(mutate).toHaveBeenCalledWith({ metric: 'goal_progress', enabled: true });
  });
});

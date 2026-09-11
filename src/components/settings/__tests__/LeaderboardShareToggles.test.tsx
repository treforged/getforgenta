// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LeaderboardShareToggles } from '../LeaderboardShareToggles';
import type { LeaderboardMetric } from '@/lib/leaderboard-metrics';

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
    const offs = screen.getAllByText('Off');
    expect(offs).toHaveLength(4);
    expect(screen.queryByText('Sharing')).toBeNull();
  });

  it('shows only the metrics that are actually on as Sharing', () => {
    state.enabled = new Set<LeaderboardMetric>(['debt_payoff']);
    render(<LeaderboardShareToggles />);
    expect(screen.getAllByText('Sharing')).toHaveLength(1);
    expect(screen.getAllByText('Off')).toHaveLength(3);
  });

  it('turning one ON requests exactly that metric, enabled true', () => {
    render(<LeaderboardShareToggles />);
    fireEvent.click(screen.getByLabelText('Share Savings goal progress'));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ metric: 'goal_progress', enabled: true });
  });

  it('turning one OFF requests enabled false - the direction that must never be wrong', () => {
    state.enabled = new Set<LeaderboardMetric>(['savings_streak']);
    render(<LeaderboardShareToggles />);
    fireEvent.click(screen.getByLabelText('Stop sharing Savings streak'));
    expect(mutate).toHaveBeenCalledWith({ metric: 'savings_streak', enabled: false });
  });

  it('does NOT draw switches in the off position when the state could not be read', () => {
    state.error = new Error('nope');
    render(<LeaderboardShareToggles />);
    expect(screen.queryByText('Off')).toBeNull();
    expect(screen.queryByText('Sharing')).toBeNull();
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
    fireEvent.click(screen.getByLabelText('Share Savings goal progress'));
    expect(mutate).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FriendsLeaderboard } from '../FriendsLeaderboard';
import { buildLeaderboardRows } from '@/lib/leaderboard-ranking';
import type { LeaderboardMetric } from '@/lib/leaderboard-metrics';

/**
 * ⚠️ The empty state is the screen every user will actually see - 0 friendships and 0 published
 * snapshots app-wide as of 2026-09-11 - so it is tested first and hardest.
 *
 * The rows are built by the REAL `buildLeaderboardRows`, not by a hand-written fixture, so these
 * assertions cannot drift from the ranking they are supposed to render.
 */

const WEEK = '2026-09-07';
const LAST_WEEK = '2026-08-31';

const state = {
  loading: false,
  error: null as Error | null,
  snapshots: [] as Array<{ userId: string; metric: LeaderboardMetric; bucketValue: number; week: string }>,
  friends: [] as Array<{ userId: string; label: string }>,
};

vi.mock('@/hooks/useFriendLeaderboard', () => ({
  useFriendLeaderboard: (friends: Array<{ userId: string; label: string }>, metric: LeaderboardMetric) => ({
    rows: buildLeaderboardRows(friends, state.snapshots, metric, WEEK),
    loading: state.loading,
    error: state.error,
    week: WEEK,
  }),
}));

function renderBoard() {
  return render(<FriendsLeaderboard friends={state.friends} />);
}

beforeEach(() => {
  state.loading = false;
  state.error = null;
  state.snapshots = [];
  state.friends = [{ userId: 'a', label: 'Alex' }, { userId: 'b', label: 'Bo' }];
});

describe('FriendsLeaderboard - the empty room', () => {
  it('says nobody is sharing, rather than drawing an empty table', () => {
    renderBoard();
    expect(screen.getByText(/nobody is sharing/i)).toBeTruthy();
    expect(screen.queryByText('Alex')).toBeNull();
  });

  it('explains that sharing is off until you turn it on', () => {
    renderBoard();
    expect(screen.getByText(/none of them is on until you turn it on/i)).toBeTruthy();
  });

  it('treats a stale-only board as empty, since nothing current is being compared', () => {
    state.snapshots = [{ userId: 'a', metric: 'goal_progress', bucketValue: 60, week: LAST_WEEK }];
    renderBoard();
    expect(screen.getByText(/nobody is sharing/i)).toBeTruthy();
  });

  it('does NOT show an error as an empty board', () => {
    state.error = new Error('nope');
    renderBoard();
    expect(screen.queryByText(/nobody is sharing/i)).toBeNull();
    expect(screen.getByText(/could not load the leaderboard/i)).toBeTruthy();
  });
});

describe('FriendsLeaderboard - what it shows', () => {
  it('shows a friend who has not opted in as Private, never as 0', () => {
    state.snapshots = [{ userId: 'a', metric: 'goal_progress', bucketValue: 60, week: WEEK }];
    renderBoard();
    expect(screen.getByText('60%')).toBeTruthy();
    expect(screen.getByText('Private')).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('keeps a non-sharing friend in the list, so a short list cannot say who opted out', () => {
    state.snapshots = [{ userId: 'a', metric: 'goal_progress', bucketValue: 60, week: WEEK }];
    renderBoard();
    expect(screen.getByText('Alex')).toBeTruthy();
    expect(screen.getByText('Bo')).toBeTruthy();
  });

  it('marks last week as not updated rather than showing it as current', () => {
    state.snapshots = [
      { userId: 'a', metric: 'goal_progress', bucketValue: 60, week: WEEK },
      { userId: 'b', metric: 'goal_progress', bucketValue: 95, week: LAST_WEEK },
    ];
    renderBoard();
    expect(screen.getByText(/not updated this week/i)).toBeTruthy();
    expect(screen.queryByText('95%')).toBeNull();
  });

  it('renders a streak in weeks, not as a percentage', () => {
    state.snapshots = [{ userId: 'a', metric: 'savings_streak', bucketValue: 7, week: WEEK }];
    renderBoard();
    fireEvent.click(screen.getByText('Savings streak'));
    expect(screen.getByText('7 weeks')).toBeTruthy();
  });
});

describe('FriendsLeaderboard - a rank is not a tie-break', () => {
  it('says TIED rather than silently ordering two equal friends', () => {
    state.snapshots = [
      { userId: 'a', metric: 'goal_progress', bucketValue: 60, week: WEEK },
      { userId: 'b', metric: 'goal_progress', bucketValue: 60, week: WEEK },
    ];
    renderBoard();
    expect(screen.getAllByText(/\(tied\)/)).toHaveLength(2);
    expect(screen.getAllByText('=1')).toHaveLength(2);
  });

  it('shows no position at all when only one friend is sharing', () => {
    state.snapshots = [{ userId: 'a', metric: 'goal_progress', bucketValue: 60, week: WEEK }];
    renderBoard();
    expect(screen.queryByText('1')).toBeNull();
    expect(screen.getByText(/nothing to compare yet/i)).toBeTruthy();
  });

  it('numbers distinct values normally', () => {
    state.snapshots = [
      { userId: 'a', metric: 'goal_progress', bucketValue: 60, week: WEEK },
      { userId: 'b', metric: 'goal_progress', bucketValue: 20, week: WEEK },
    ];
    renderBoard();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByText(/\(tied\)/)).toBeNull();
  });
});

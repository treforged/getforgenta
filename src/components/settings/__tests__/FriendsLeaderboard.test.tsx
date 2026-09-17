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

// The friends board now also renders the GLOBAL standing card beneath it. That card owns a
// `useQuery`, and this file renders without a QueryClientProvider, so it is stubbed here — these
// cases are about the FRIENDS board. `GlobalStandingCard.test.tsx` is where the card is exercised
// for real, and the case at the bottom of this file asserts it is actually mounted, so the stub
// cannot quietly become a way of not rendering it at all.
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
    hasEnoughPeople: actual.hasEnoughPeople,
    useGlobalLeaderboard: () => ({
      data: { cohortSize: 1, minCohort: 20, yourBucket: 5, betterThanPct: null, medianBucket: null },
      isLoading: false,
      error: null,
    }),
  };
});

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
  /**
   * ⚠️ THIS CASE USED TO ASSERT THE DEFECT. It required `Alex` to be ABSENT when nobody was
   * sharing, and passed for days while enforcing exactly the behaviour Tre reported on
   * 2026-09-15 as "the friends leaderboard is not showing" (ask `a6c2de42`): with one friend
   * and no published snapshot, the board rendered a sentence and no rows at all.
   *
   * It also contradicted two headers in the source it was testing — `FriendsLeaderboard`'s
   * ("never by being left out") and `isEmptyRoom`'s ("collapsing them would tell someone with
   * five friends to go and invite somebody"). The rows are the board; the sentence explains it.
   */
  it('still shows every friend as a row, with the sentence explaining why they read Private', () => {
    renderBoard();
    expect(screen.getByText(/nobody is sharing/i)).toBeTruthy();
    expect(screen.getByText('Alex')).toBeTruthy();
    expect(screen.getByText('Bo')).toBeTruthy();
    expect(screen.getAllByText('Private')).toHaveLength(2);
  });

  it('tells someone with NOBODY that they have nobody, not that one of them is sharing', () => {
    state.friends = [];
    renderBoard();
    expect(screen.getByText(/nobody here yet/i)).toBeTruthy();
    // ⚠️ PINS THE MUTUAL REQUIREMENT, which the old copy never stated. The board is governed by
    // `active_friend_ids()`, whose follows arm joins follows to itself and demands `accepted` in
    // BOTH directions - so a one-way follower sees nothing. The previous wording also told people
    // to "add one", which pointed at the add-a-friend form that no longer exists.
    expect(screen.getByText(/follow each other/i)).toBeTruthy();
    expect(screen.queryByText(/nothing to compare yet/i)).toBeNull();
    expect(screen.queryByText(/nobody is sharing/i)).toBeNull();
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

/**
 * ⚠️ THE GLOBAL CARD IS ACTUALLY MOUNTED HERE, and this is the case that stops the stub above from
 * becoming a way of silently not rendering it. An export with no caller is the defect this feature
 * already shipped once — `proposeReconciliation` sat exported, documented and uncalled for a week —
 * so the mount is asserted rather than assumed.
 */
describe('FriendsLeaderboard - the global standing sits under the friends', () => {
  it('renders the global card, and shows its floor as a wait rather than a score', () => {
    render(<FriendsLeaderboard friends={[]} />);
    expect(screen.getByText(/Everyone on Forgenta/)).toBeTruthy();
    expect(screen.getByText(/until 20 are taking part/)).toBeTruthy();
    expect(screen.queryByText(/ahead of/)).toBeNull();
  });
});

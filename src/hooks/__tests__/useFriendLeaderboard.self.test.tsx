// @vitest-environment jsdom
//
// YOU ARE ON YOUR OWN LEADERBOARD.
//
// Tre, 2026-09-15 (ask `a6c2de42`): "the friends leaderboard is not showing". Measured on his own
// account the same day: `leaderboard_shares` had goal_progress enabled for him and
// `leaderboard_snapshots` held his bucket for the exact metric and the exact week the card was
// displaying — and the card rendered ONE row, for the other person, reading "Private". The board
// could place everybody except the person reading it.
//
// ⚠️ THE ASSERTION IS A POSITIVE ONE, DELIBERATELY. "His row is missing" and "the board is empty"
// are the same absence, and an absence-only test is satisfied by the feature being dead — this
// portfolio has that recorded twice. So the case below requires TWO rows with the RIGHT VALUES:
// his at 5%, the friend at Private. One row is the defect; two rows with his reading Private is a
// different defect, and this fails on both.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const SELF = 'self-user-id';
const FRIEND = 'friend-user-id';
const WEEK_ROW = { user_id: SELF, metric: 'goal_progress', bucket_value: 5, week: '' };

const state = { rows: [] as Array<Record<string, unknown>> };

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: SELF } }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));

// The ids the query actually asked for, captured so the test can prove self was REQUESTED and not
// merely rendered — a row built client-side from nothing would satisfy a render-only assertion.
const asked: string[][] = [];
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: (_col: string, ids: string[]) => {
          asked.push(ids);
          return { eq: () => Promise.resolve({ data: state.rows, error: null }) };
        },
      }),
    }),
  },
}));

import { useFriendLeaderboard } from '../useFriendLeaderboard';
import { weekStart } from '@/lib/leaderboard-metrics';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const friends = [{ userId: FRIEND, label: 'Tre' }];

beforeEach(() => {
  asked.length = 0;
  state.rows = [{ ...WEEK_ROW, week: weekStart(new Date()) }];
});

describe('useFriendLeaderboard puts the reader on the board', () => {
  it('asks the database for the signed-in user as well as the friends', async () => {
    renderHook(() => useFriendLeaderboard(friends, 'goal_progress'), { wrapper });
    await waitFor(() => expect(asked.length).toBeGreaterThan(0));
    expect(asked[0]).toContain(SELF);
    expect(asked[0]).toContain(FRIEND);
  });

  it('renders HIS published bucket alongside the friend, not just the friend', async () => {
    const { result } = renderHook(() => useFriendLeaderboard(friends, 'goal_progress'), { wrapper });
    // ⚠️ WAIT ON THE VALUE, NOT ON THE ROW COUNT. The rows are built from the participant list, so
    // there are 2 of them on the FIRST render, before the query has resolved - `toHaveLength(2)`
    // returns instantly and would assert against an empty board that had not loaded yet.
    await waitFor(() => expect(result.current.rows.find((r) => r.userId === SELF)?.state).toBe('value'));
    const self = result.current.rows.find((r) => r.userId === SELF);
    const friend = result.current.rows.find((r) => r.userId === FRIEND);
    expect(self).toMatchObject({ label: 'You', state: 'value', value: 5 });
    expect(friend).toMatchObject({ label: 'Tre', state: 'private', value: null });
  });

  it('gives the reader no snapshot the same PRIVATE reading a friend gets, never a zero', async () => {
    // Opted in but nothing published yet is not 0%. A zero would be a number he never earned, and
    // it would place him last in a ranking he is not in.
    state.rows = [];
    const { result } = renderHook(() => useFriendLeaderboard(friends, 'goal_progress'), { wrapper });
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.rows.every((r) => r.state === 'private' && r.value === null)).toBe(true);
  });
});

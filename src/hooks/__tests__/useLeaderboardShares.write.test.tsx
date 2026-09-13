// @vitest-environment jsdom
//
// THE SHARING TOGGLE WROTE NOTHING, AND SAID NOTHING.
//
// Tre, 2026-09-13: "the button saying, like, turning on or off for each tab, um, is not showing
// properly or, like, it's not switching to off. It's not switching back on... the buttons are not
// doing anything. They just kinda click and that's it." And separately: "both the user accounts I
// have access to... I have them set to on to share their progresses, but the data is not showing
// on either account, on either side."
//
// MEASURED AGAINST PRODUCTION THE SAME DAY, signed in as him: `leaderboard_shares` held ZERO rows,
// and the hook's `upsert` returned **"permission denied for table leaderboard_shares"** while an
// insert of the granted columns and an update of the granted columns each returned OK.
//
// ⚠️ THE GRANTS WERE RIGHT; THE WRITE WAS WRONG. `20260826_friend_links.sql` grants
// `insert (user_id, metric, enabled, updated_at)` and `update (enabled, updated_at)` — a row's
// identity is deliberately not editable. An upsert is INSERT … ON CONFLICT DO UPDATE and PostgREST
// puts every supplied column into the update, so the conflict path asked to update `user_id` and
// `metric` and was refused. Do not "fix" this by widening the grant.
//
// ⚠️ AND THE WHOLE CHAIN FOLLOWED FROM IT: no share rows means the publisher correctly writes no
// snapshots, which means both users' leaderboards are empty. One refused write explained every
// symptom he reported.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  /** Every write the hook attempted, in order, with the columns it actually sent. */
  calls: [] as { op: string; payload: Record<string, unknown> }[],
  updateMatches: 1,
  insertError: null as { code: string; message: string } | null,
  toasts: [] as string[],
}));

vi.mock('sonner', () => ({ toast: { error: (m: string) => state.toasts.push(m) } }));

vi.mock('@/integrations/supabase/client', () => {
  const from = () => ({
    select: () => ({ eq: () => ({ data: state.rows, error: null }) }),
    update: (payload: Record<string, unknown>) => {
      state.calls.push({ op: 'update', payload });
      const chain = {
        eq: () => chain,
        select: async () => ({
          data: Array.from({ length: state.updateMatches }, () => ({ id: 'row-1' })),
          error: null,
        }),
      };
      return chain;
    },
    insert: async (payload: Record<string, unknown>) => {
      state.calls.push({ op: 'insert', payload });
      return { error: state.insertError };
    },
  });
  return { supabase: { from } };
});

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));

import { useLeaderboardShares } from '@/hooks/useLeaderboardShares';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  state.rows = []; state.calls = []; state.updateMatches = 1;
  state.insertError = null; state.toasts = [];
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function toggle(enabled: boolean) {
  const { result } = renderHook(() => useLeaderboardShares(), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => { await result.current.setEnabled.mutateAsync({ metric: 'goal_progress', enabled }); });
  return result;
}

describe('useLeaderboardShares — the write must stay inside the granted columns', () => {
  it('⚠️ NEVER SENDS user_id OR metric IN AN UPDATE — that is the exact refusal', async () => {
    await toggle(true);
    const update = state.calls.find(c => c.op === 'update');
    expect(update).toBeTruthy();
    expect(Object.keys(update!.payload).sort()).toEqual(['enabled', 'updated_at']);
    // Stated as its own assertion because it is the defect, not a detail of it.
    expect(update!.payload).not.toHaveProperty('user_id');
    expect(update!.payload).not.toHaveProperty('metric');
  });

  it('updates an existing row and does NOT insert a second one', async () => {
    state.updateMatches = 1;
    await toggle(false);
    expect(state.calls.map(c => c.op)).toEqual(['update']);
  });

  it('inserts when no row matched, with exactly the insert-granted columns', async () => {
    state.updateMatches = 0;
    await toggle(true);
    expect(state.calls.map(c => c.op)).toEqual(['update', 'insert']);
    const insert = state.calls.find(c => c.op === 'insert')!;
    expect(Object.keys(insert.payload).sort()).toEqual(['enabled', 'metric', 'updated_at', 'user_id']);
  });

  it('a racing duplicate (23505) is success — the row the user wanted exists', async () => {
    // The unique index is what replaced the upsert's double-tap safety, so this path is load-bearing.
    state.updateMatches = 0;
    state.insertError = { code: '23505', message: 'duplicate key' };
    await expect(toggle(true)).resolves.toBeTruthy();
    expect(state.toasts).toHaveLength(0);
  });

  it('⚠️ A REAL FAILURE IS SAID OUT LOUD — it used to be silent, which is why he reported it', async () => {
    // There was no onError at all. A privacy switch that fails quietly leaves the user believing
    // they changed something; that is worse than an error.
    state.updateMatches = 0;
    state.insertError = { code: '42501', message: 'permission denied for table leaderboard_shares' };
    const { result } = renderHook(() => useLeaderboardShares(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.setEnabled.mutateAsync({ metric: 'goal_progress', enabled: true }).catch(() => {});
    });
    await waitFor(() => expect(state.toasts.length).toBeGreaterThan(0));
    expect(state.toasts[0]).toMatch(/permission denied/i);
  });
});

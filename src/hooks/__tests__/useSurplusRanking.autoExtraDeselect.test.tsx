// @vitest-environment jsdom
/**
 * "once it comes true it should auto deselect" (Tre, 2026-08-25) — the WRITE, not the plan.
 *
 * `planAutoExtraDeselect` is proved pure in `auto-extra-waterfall.test.ts`; this proves the hook
 * actually issues the update, issues it ONCE, and refuses in every case where there is no column to
 * write to or no permission to write it. The real `surplus-ranking` module runs here; only supabase,
 * the two contexts, the data hooks and the toast are faked, so a change to the rule shows up as a
 * change in what lands on the database.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Update = { table: string; patch: Record<string, unknown>; id: string };
const updates: Update[] = [];
const toasts: string[] = [];
let updateError: { message: string } | null = null;

let isDemo = false;
let user: { id: string } | null = { id: 'user-1' };
let goals: Record<string, unknown>[] = [];
let carFunds: Record<string, unknown>[] = [];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: (_c: string, id: string) => ({
          eq: async () => {
            updates.push({ table, patch, id });
            return { error: updateError };
          },
        }),
      }),
    }),
  },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo }) }));
vi.mock('sonner', () => ({
  toast: {
    info: (m: string) => { toasts.push(m); },
    success: (m: string) => { toasts.push(m); },
    error: (m: string) => { toasts.push(m); },
  },
}));
vi.mock('@/hooks/useSupabaseData', () => ({
  useSavingsGoals: () => ({ data: goals, loading: false }),
  useCarFunds: () => ({ data: carFunds, loading: false }),
  useAccounts: () => ({ data: [], loading: false }),
  useProfile: () => ({ data: { cards_sort_order: 0, cards_surplus_share: null } }),
  useDebts: () => ({ data: [] }),
  useRecurringRules: () => ({ data: [] }),
}));

import { useSurplusRanking } from '../useSurplusRanking';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// ⚠️ EVERY TEST USES ITS OWN GOAL ID. The session guard is module-scoped on purpose (it has to
// survive a remount), so an id one test has already deselected would make the next one pass
// without measuring anything. Same reason `useOnboardingStatus.test.tsx` mints a user per test.
const goalRow = (over: Record<string, unknown> = {}) => ({
  id: 'g-1', name: 'Emergency Fund', target_amount: 20000, current_amount: 20000,
  auto_extra: true, sort_order: 0, surplus_share: null, target_date: null,
  created_at: '2026-01-01T00:00:00Z', ...over,
});

beforeEach(() => {
  updates.length = 0;
  toasts.length = 0;
  updateError = null;
  isDemo = false;
  user = { id: 'user-1' };
  goals = [];
  carFunds = [];
});

describe('useSurplusRanking — auto extra switches itself off when the goal is met', () => {
  it('writes auto_extra false for a funded goal, and says so', async () => {
    goals = [goalRow({ id: 'g-funded' })];
    renderHook(() => useSurplusRanking(), { wrapper });
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toEqual({
      table: 'savings_goals',
      patch: { auto_extra: false, auto_extra_auto_cleared: true },
      id: 'g-funded',
    });
    expect(toasts).toEqual(['Emergency Fund is done. Auto extra moved to the next item.']);
  });

  it('writes it exactly once, even while the refetch has not landed and the row still reads true', async () => {
    goals = [goalRow({ id: 'g-once' })];
    const { rerender, unmount } = renderHook(() => useSurplusRanking(), { wrapper });
    await waitFor(() => expect(updates).toHaveLength(1));

    // ⚠️ A NEW ARRAY, same content. Re-rendering with the identical reference would leave `rows`
    // memoised and the effect would not re-enter at all, so the assertion would pass without
    // measuring the guard. This forces the effect to re-run against a row that still reads
    // `auto_extra: true` — the window between the write and the refetch, and the same shape as a
    // user re-ticking a finished row by hand.
    goals = [goalRow({ id: 'g-once' })];
    rerender();
    await new Promise(r => setTimeout(r, 20));
    expect(updates).toHaveLength(1);

    // And it survives a remount, which a per-instance ref would not.
    unmount();
    goals = [goalRow({ id: 'g-once' })];
    renderHook(() => useSurplusRanking(), { wrapper });
    await new Promise(r => setTimeout(r, 20));
    expect(updates).toHaveLength(1);
  });

  it('leaves a goal that still has something to go alone', async () => {
    goals = [goalRow({ id: 'g-partial', current_amount: 12_000 })];
    renderHook(() => useSurplusRanking(), { wrapper });
    await new Promise(r => setTimeout(r, 20));
    expect(updates).toEqual([]);
  });

  it('leaves a funded goal that was never opted in alone', async () => {
    goals = [goalRow({ id: 'g-optedout', auto_extra: false })];
    renderHook(() => useSurplusRanking(), { wrapper });
    await new Promise(r => setTimeout(r, 20));
    expect(updates).toEqual([]);
  });

  it('leaves a goal already marked auto_extra_auto_cleared alone, even freshly mounted', async () => {
    // A fresh id, so the in-session Set (module-scoped, see useSurplusRanking.ts) is empty for it
    // -- the ONLY thing standing between a re-fight and leaving it alone is the persisted column
    // read off the row itself. This is the reload case: a page load rebuilds the Set from nothing.
    goals = [goalRow({ id: 'g-persisted', auto_extra_auto_cleared: true })];
    renderHook(() => useSurplusRanking(), { wrapper });
    await new Promise(r => setTimeout(r, 20));
    expect(updates).toEqual([]);
  });

  it('never writes in demo mode, which has no database behind it', async () => {
    isDemo = true;
    goals = [goalRow({ id: 'g-demo' })];
    renderHook(() => useSurplusRanking(), { wrapper });
    await new Promise(r => setTimeout(r, 20));
    expect(updates).toEqual([]);
  });

  it('switches a fully saved car fund off through the car_funds table', async () => {
    carFunds = [{
      id: 'cf-1', vehicle_name: 'C5', phase: 'saving', down_payment_goal: 7700,
      current_saved: 7700, saved_source: 'percent', saved_percent: 100, gift_contribution: 0,
      auto_extra: true, sort_order: 1, surplus_share: null, linked_account: null,
      planned_purchase_date: null, created_at: '2026-01-01T00:00:00Z',
    }];
    renderHook(() => useSurplusRanking(), { wrapper });
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toEqual({
      table: 'car_funds',
      patch: { auto_extra: false, auto_extra_auto_cleared: true },
      id: 'cf-1',
    });
  });

  it('does not mark a failed write as done, so the next pass retries it', async () => {
    // A failure that quietly recorded itself as done would leave the switch stuck on with nothing
    // ever coming back for it. It is logged (console.error) rather than toasted, matching the
    // sibling background write in `useAutoEndReconcile`, and the retry is what makes that safe.
    updateError = { message: 'network' };
    goals = [goalRow({ id: 'g-retry' })];
    const { rerender } = renderHook(() => useSurplusRanking(), { wrapper });
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(toasts).toEqual([]);

    updateError = null;
    goals = [goalRow({ id: 'g-retry' })];
    rerender();
    await waitFor(() => expect(updates).toHaveLength(2));
    expect(toasts).toHaveLength(1);
  });
});

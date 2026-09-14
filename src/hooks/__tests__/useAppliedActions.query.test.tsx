// @vitest-environment jsdom
//
// THE QUERY MUST FETCH BOTH POPULATIONS, OR ONE CONSUMER GOES SILENTLY INERT.
//
// ⚠️ THIS IS THE DEFECT THAT WAS "CAUGHT ONLY IN A BROWSER", TESTED AT THE LAYER IT ACTUALLY LIVED
// IN. `useAppliedActions` once carried `.is('undone_at', null)`. That is right for the undo banner
// and silently wrong for everything else: `chargesWithUndoneDecision` reads exactly the rows that
// predicate removed, so it returned an EMPTY set in every case that mattered and the auto-apply
// guard built on it could never fire. Inert by construction. Every unit test passed, because they
// inject the set directly — the only thing that found it was pressing undo in a browser and
// watching the charge re-apply 17 seconds later.
//
// A one-off browser press does not stop it coming back. What stops it is asserting the SHAPE OF THE
// QUERY against what the consumers need, which is what this file does: run the hook's own queryFn
// against a client that RECORDS what was asked for.
//
// ⚠️ WHAT THIS DOES NOT DO, said plainly: it does not exercise PostgREST, RLS, or the round trip. It
// proves the request this hook builds is one that can return both populations. The remaining browser
// work — BankActivity's per-row `linkOneWithUndo` and the batch panel, against the reviewer seed —
// is still open and still needs a signed-in reviewer session.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/** Every filter and option the queryFn applied, in order. */
const calls = vi.hoisted(() => ({
  table: '' as string,
  select: '' as string,
  filters: [] as { op: string; args: unknown[] }[],
  limit: null as number | null,
}));

vi.mock('@/integrations/supabase/client', () => {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  const record = (op: string) => (...args: unknown[]) => {
    if (op === 'select') calls.select = String(args[0] ?? '');
    else if (op === 'limit') calls.limit = Number(args[0]);
    else calls.filters.push({ op, args });
    return chain;
  };
  for (const op of ['select', 'order', 'limit', 'eq', 'is', 'not', 'neq', 'in', 'filter', 'gte', 'lte']) {
    chain[op] = record(op);
  }
  // The chain is awaited at the end of the builder, so it has to be thenable.
  (chain as unknown as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: [], error: null });
  return {
    supabase: {
      from: (table: string) => { calls.table = table; return chain; },
    },
  };
});

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useAppliedActions } from '../useAppliedActions';

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    children,
  );

beforeEach(() => {
  calls.table = '';
  calls.select = '';
  calls.filters = [];
  calls.limit = null;
});

async function runQuery() {
  renderHook(() => useAppliedActions(), { wrapper });
  await waitFor(() => expect(calls.table).toBe('applied_actions'));
}

describe('the applied-actions read', () => {
  it('⚠️ APPLIES NO FILTER ON `undone_at` — the predicate that made a consumer inert', async () => {
    // `offerableUndos` wants the rows where it is null; `chargesWithUndoneDecision` wants the rows
    // where it is set. Narrowing here cannot serve both, so the narrowing belongs at the point of
    // use and never in the fetch.
    await runQuery();
    const undoneFilters = calls.filters.filter(f =>
      f.args.some(a => typeof a === 'string' && a.includes('undone_at')),
    );
    expect(undoneFilters, 'a filter on undone_at empties chargesWithUndoneDecision').toEqual([]);
  });

  it('selects `undone_at`, because both readers decide on it', async () => {
    await runQuery();
    expect(calls.select).toContain('undone_at');
  });

  it('selects the fields the undo steps are rebuilt from', async () => {
    // `steps` is the reversal plan itself; without it an action is a label with no undo behind it.
    await runQuery();
    for (const field of ['id', 'kind', 'label', 'steps', 'created_at']) {
      expect(calls.select).toContain(field);
    }
  });

  it('⚠️ KEEPS A WINDOW WIDE ENOUGH FOR BOTH POPULATIONS', async () => {
    // The limit was raised from 20 when the fetch stopped excluding undone rows: it now spans both,
    // and a user who has undone a lot would otherwise push their still-reversible actions out of
    // the window and lose the undo banner — a filter change quietly costing a feature.
    await runQuery();
    expect(calls.limit).not.toBeNull();
    expect(calls.limit!).toBeGreaterThanOrEqual(50);
  });

  it('reads newest first, which is what "the thing you just did" means', async () => {
    await runQuery();
    const order = calls.filters.find(f => f.op === 'order');
    expect(order, 'no ordering applied').toBeTruthy();
    expect(order!.args[0]).toBe('created_at');
    expect(order!.args[1]).toMatchObject({ ascending: false });
  });
});

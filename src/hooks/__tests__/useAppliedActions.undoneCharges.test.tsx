// @vitest-environment jsdom
//
// THE GUARD THAT COULD NEVER FIRE — auto-apply redoing a decision the user had just undone.
//
// Shipped 2026-09-13 and caught in a BROWSER, not here. `linkMemoryVerdict` gained a
// `previously-undone` gate fed by `undoneChargeIds`, and that gate was inert by construction:
// this hook's query carried `.is('undone_at', null)`, so the rows the set is derived from were
// filtered out before it ever saw them. The set was always empty. Undo, and the charge came
// back 17 seconds later — measured against server `created_at`, not the client clock.
//
// ⚠️ WHY THE UNIT TESTS COULD NOT SEE IT. `auto-apply.linkMemoryVerdict.test.ts` passes the set
// in directly, so it proves the GATE works and says nothing about whether anything ever fills it.
// A green there over an empty producer is exactly the shape this repo keeps finding.
//
// ⚠️ AND WHY THE MOCK RECORDS THE FILTER. A mock that simply ignored `.is()` would return the
// undone row anyway and pass against the broken code — a harness agreeing with the defect.
//
// ⚠️ MEASURED, NOT ASSUMED — RESTORING THE ORIGINAL `.is('undone_at', null)` TURNS EXACTLY ONE
// CASE RED: "THE CAUSE". The other three stay GREEN, because this mock is an in-memory stub and
// cannot actually filter. So the recorded-predicate assertion is the ONLY load-bearing guard
// here, and "THE OUTCOME" is a statement about the lib wiring rather than about the query.
// Said plainly because a reader counting four passing tests would otherwise assume any of them
// would have caught this, and three of them would not.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  /** Every `.is(column, value)` the query builder was asked for. */
  isCalls: [] as [string, unknown][],
}));

vi.mock('@/integrations/supabase/client', () => {
  const builder = () => {
    const chain = {
      is: (col: string, val: unknown) => { state.isCalls.push([col, val]); return chain; },
      order: () => chain,
      limit: async () => ({ data: state.rows, error: null }),
      then: undefined,
    };
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table !== 'applied_actions') throw new Error(`unexpected table ${table}`);
        return { select: () => builder() };
      },
    },
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

import { useAppliedActions } from '@/hooks/useAppliedActions';

/**
 * ⚠️ `created_at` IS RELATIVE TO NOW, AND IT USED TO BE A HARDCODED INSTANT.
 *
 * It read `'2026-09-13T15:48:59.000Z'` — the moment the defect was captured. `offerableUndos`
 * only offers rows newer than `UNDO_OFFER_WINDOW_HOURS` (24), so this fixture aged out of the
 * window at 2026-09-14T15:48:59Z and TWO tests here went red on their own, with nothing in the
 * product having changed. Measured at the time of the fix: the row was 29.81 hours old.
 *
 * Proven both ways before touching it — the SAME row, through the SAME function, differing only
 * in the injected `now`: offered at `2026-09-13T15:49:30Z`, dropped at `2026-09-14T21:37:00Z`.
 * So the window was the discriminator and the hook was never at fault.
 *
 * A test that passes on the day it is written and fails a day later is a CLOCK dependency wearing
 * a fixture's clothes, and bumping the date would only re-arm it. The window itself is still
 * covered deterministically in `src/lib/__tests__/applied-actions.test.ts`, which injects `now`
 * and pins `UNDO_OFFER_WINDOW_HOURS + 1` — so making this fixture always-fresh removes no
 * coverage. Same `at(hoursAgo)` idiom as that file, deliberately.
 */
const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000).toISOString();

const row = (id: string, chargeId: string, undoneAt: string | null) => ({
  id,
  kind: 'deck_decision',
  label: 'Decided CITY POWER & LIGHT',
  steps: [{ write: 'removeReviews', chargeId }],
  created_at: at(1),
  undone_at: undoneAt,
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => { state.rows = []; state.isCalls = []; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('useAppliedActions — the undone rows must survive the fetch', () => {
  it('THE CAUSE: the query does not filter undone rows away', async () => {
    state.rows = [row('a1', 'charge-1', at(0.5))];
    const { result } = renderHook(() => useAppliedActions(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // `.is('undone_at', null)` here is what made the guard inert. Any predicate that drops
    // undone rows at the source breaks `undoneChargeIds` no matter how correct the lib is.
    expect(state.isCalls).not.toContainEqual(['undone_at', null]);
  });

  it('THE OUTCOME: an undone decision names its charge', async () => {
    state.rows = [row('a1', 'charge-1', at(0.5))];
    const { result } = renderHook(() => useAppliedActions(), { wrapper });
    await waitFor(() => expect(result.current.undoneChargeIds.size).toBe(1));
    expect(result.current.undoneChargeIds.has('charge-1')).toBe(true);
  });

  it('THE CONTROL: a still-reversible decision is NOT treated as undone', async () => {
    // Without this, a bug that returned every charge id would satisfy the case above and would
    // switch auto-apply off for decisions nobody objected to.
    state.rows = [row('a2', 'charge-2', null)];
    const { result } = renderHook(() => useAppliedActions(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.undoneChargeIds.size).toBe(0);
    // And it is still offered as an undo, which is the other half of the same row.
    expect(result.current.actions.map(a => a.id)).toEqual(['a2']);
  });

  it('the two views split one fetch: reversible rows are offered, undone rows are remembered', async () => {
    state.rows = [
      row('a1', 'charge-1', at(0.5)),
      row('a2', 'charge-2', null),
    ];
    const { result } = renderHook(() => useAppliedActions(), { wrapper });
    await waitFor(() => expect(result.current.undoneChargeIds.size).toBe(1));
    expect(result.current.undoneChargeIds.has('charge-1')).toBe(true);
    // The banner must not offer to reverse something already reversed.
    expect(result.current.actions.map(a => a.id)).toEqual(['a2']);
  });
});

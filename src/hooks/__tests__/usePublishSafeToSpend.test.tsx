// @vitest-environment jsdom
//
// ONLY THE SETTLED FIGURE IS PUBLISHED (ask 1dc2c388). Measured 2026-10-01 on Tre's account: the
// dashboard first rendered $1,462.31 while its queries loaded, then settled on $1,408.31. A
// once-a-minute throttle wrote the interim figure and blocked the right one, so Leo would have
// read a number the screen never kept. These cases press the hook with that exact sequence.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import type { SafeToSpendResult } from '@/lib/safe-to-spend';

const state = vi.hoisted(() => ({ upserts: [] as Record<string, unknown>[] }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      upsert: (row: Record<string, unknown>) => {
        state.upserts.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

import { usePublishSafeToSpend } from '@/hooks/usePublishSafeToSpend';
import { SETTLE_MS } from '@/lib/safe-to-spend-snapshot';

const fig = (amount: number): SafeToSpendResult => ({
  kind: 'figure', amount, lowPoint: amount, lowDate: '2026-10-10', payday: '2026-10-02', floor: 0,
  horizon: '2026-10-31', cappedAfterPayday: true,
});

describe('usePublishSafeToSpend', () => {
  beforeEach(() => { state.upserts = []; vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("writes the SETTLED figure only: $1,462.31 then $1,408.31 within the settle window -> one write of 140831", () => {
    const { rerender } = renderHook((p: { r: SafeToSpendResult }) =>
      usePublishSafeToSpend({ result: p.r, userId: 'u1', disabled: false }), { initialProps: { r: fig(1462.31) } });
    vi.advanceTimersByTime(SETTLE_MS - 1000);
    rerender({ r: fig(1408.31) });
    vi.advanceTimersByTime(SETTLE_MS);
    expect(state.upserts.map(u => u.amount_cents)).toEqual([140831]);
  });

  it('a new result object with the same numbers does not restart the timer or write twice', () => {
    const { rerender } = renderHook((p: { r: SafeToSpendResult }) =>
      usePublishSafeToSpend({ result: p.r, userId: 'u1', disabled: false }), { initialProps: { r: fig(1408.31) } });
    vi.advanceTimersByTime(SETTLE_MS - 1000);
    rerender({ r: fig(1408.31) });
    vi.advanceTimersByTime(1000);
    expect(state.upserts).toHaveLength(1);
    rerender({ r: fig(1408.31) });
    vi.advanceTimersByTime(SETTLE_MS * 2);
    expect(state.upserts).toHaveLength(1);
  });

  it('never writes in demo or partner view, and never an empty result', () => {
    renderHook(() => usePublishSafeToSpend({ result: fig(1408.31), userId: 'u1', disabled: true }));
    renderHook(() => usePublishSafeToSpend({ result: { kind: 'empty', missing: 'no-payday' }, userId: 'u1', disabled: false }));
    vi.advanceTimersByTime(SETTLE_MS * 3);
    expect(state.upserts).toHaveLength(0);
  });
});

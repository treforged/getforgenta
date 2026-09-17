// @vitest-environment jsdom
//
// "RESET TO DEFAULTS" MUST STICK, AND IT DID NOT.
//
// This is the ONLY route a user with a saved layout has to the current first-run stack. It matters
// more than usual right now: `transactions_spending` was defaulted OFF on 2026-09-17, and
// `mergeSavedLayout` preserves the stored flag for every widget a saved layout already knows, so
// the 2 profiles that carry one (tre@treforged.com and reviewer@treforged.com) can reach that new
// default ONLY by pressing this button. A racy reset makes that route unreliable for the one
// person most likely to press it.
//
// ⚠️ THE DEFECT: `resetLayout` set `initialized.current = false` before calling `setLayout`.
// That RE-ARMS the initialisation effect, whose whole job is to overwrite local state with
// whatever the profile says. The write is debounced 800ms, so any profile refetch landing inside
// that window returns the OLD row and the effect stamps the user's stale layout straight back
// over the reset they just asked for. The pending write still fires, so the DATABASE ends up on
// the default while the SCREEN shows the old layout - the two disagree until a reload.
//
// The `initialized.current = false` line buys nothing: `setLayout(DEFAULT_LAYOUT)` already sets
// state AND persists. Its only effect is to re-open the door the flag exists to keep shut.
//
// WHAT THIS DOES NOT COVER: the real Supabase write (mocked here), the 800ms debounce timing
// itself, and anything visual. It pins the state machine, which is where the defect lives.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const profileRef = { current: null as unknown };
const loadingRef = { current: false };

vi.mock('@/hooks/useSupabaseData', () => ({
  useProfile: () => ({ data: profileRef.current, loading: loadingRef.current }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));

const updateSpy = vi.fn().mockResolvedValue({ error: null });
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: () => ({ update: (...a: unknown[]) => { updateSpy(...a); return { eq: () => Promise.resolve({ error: null }) }; } }) },
}));

import { useDashboardLayout } from '../useDashboardLayout';
import { DEFAULT_LAYOUT, WIDGET_META, type WidgetConfig } from '@/lib/dashboard-widgets';

/** A saved layout that has every widget ON — the shape both real saved profiles carry. */
const savedAllVisible = () => WIDGET_META.map(w => ({ id: w.id, visible: true }));

const visibleOf = (id: string, layout: readonly WidgetConfig[]) =>
  layout.find(w => w.id === id)?.visible;

beforeEach(() => {
  updateSpy.mockClear();
  loadingRef.current = false;
  // A NEW ARRAY EACH TIME. Reusing one object across tests would let a stale reference decide
  // whether the initialisation effect re-runs, which is the very thing under test.
  profileRef.current = { dashboard_layout: savedAllVisible() };
});

describe('reset to defaults', () => {
  it('CONTROL: the saved layout loads first, and it disagrees with the default', () => {
    // Without this the test below is satisfied by a hook that ignores saved layouts entirely —
    // "reset worked" and "the saved layout was never applied" would look identical.
    const { result } = renderHook(() => useDashboardLayout());

    expect(visibleOf('transactions_spending', result.current.layout)).toBe(true);
    expect(visibleOf('transactions_spending', DEFAULT_LAYOUT)).toBe(false);
  });

  it('moves the layout to the default', () => {
    const { result } = renderHook(() => useDashboardLayout());
    act(() => { result.current.resetLayout(); });

    expect(visibleOf('transactions_spending', result.current.layout)).toBe(false);
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
  });

  it('SURVIVES A PROFILE REFETCH THAT STILL RETURNS THE OLD ROW', () => {
    // The real race: the write is debounced 800ms, so a refetch inside that window hands back the
    // pre-reset row. A new object with identical contents is exactly what a refetch produces, and
    // it is what re-runs the initialisation effect.
    const { result, rerender } = renderHook(() => useDashboardLayout());
    act(() => { result.current.resetLayout(); });
    expect(visibleOf('transactions_spending', result.current.layout)).toBe(false);

    act(() => {
      profileRef.current = { dashboard_layout: savedAllVisible() };
    });
    rerender();

    // Before the fix this read `true`: the effect stamped the stale saved layout back over the
    // reset, while the pending write still put the default in the database.
    expect(
      visibleOf('transactions_spending', result.current.layout),
      'the stale profile overwrote the reset the user just asked for',
    ).toBe(false);
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
  });

  it('still lets an ordinary edit persist after a reset', () => {
    // Guards the lazy fix. Pinning `initialized` permanently true would stop the revert AND could
    // break normal operation; a reset must not leave the hook inert.
    const { result } = renderHook(() => useDashboardLayout());
    act(() => { result.current.resetLayout(); });

    const edited = DEFAULT_LAYOUT.map(w =>
      w.id === 'transactions_spending' ? { ...w, visible: true } : w);
    act(() => { result.current.setLayout(edited); });

    expect(visibleOf('transactions_spending', result.current.layout)).toBe(true);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

/**
 * The recorder must CALL the fill - a green helper test says nothing about the wiring.
 *
 * Paired cases: a balance and an empty newest row MUST fill; a null balance (no projection yet)
 * and an already-filled row MUST NOT. Either half alone passes against a broken recorder.
 */

const upsertMutate = vi.fn();
const fillMutate = vi.fn();
let snapshots: Array<{ snapshot_date: string; revolving_balance: number | null }> = [];

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/hooks/useSupabaseData', () => ({
  useAccounts: () => ({ data: [] }),
  useAssets: () => ({ data: [] }),
  useLiabilities: () => ({ data: [] }),
  useCarFunds: () => ({ data: [] }),
  useNetWorthSnapshots: () => ({
    data: snapshots,
    loading: false,
    upsert: { mutate: upsertMutate },
    fillRevolving: { mutate: fillMutate },
  }),
}));

import { useNetWorthSnapshotRecorder } from '../useNetWorthSnapshotRecorder';

describe('useNetWorthSnapshotRecorder - revolving fill', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 23, 12, 0, 0)); // local 2026-09-23
    upsertMutate.mockReset();
    fillMutate.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('fills the newest row when a balance exists and the row has none', () => {
    snapshots = [
      { snapshot_date: '2026-09-10', revolving_balance: null },
      { snapshot_date: '2026-09-20', revolving_balance: null },
    ];
    renderHook(() => useNetWorthSnapshotRecorder(1234.56));
    expect(fillMutate).toHaveBeenCalledTimes(1);
    expect(fillMutate.mock.calls[0][0]).toEqual({ snapshot_date: '2026-09-20', revolving_balance: 1234.56 });
  });

  it('writes nothing while there is no projection (null balance)', () => {
    snapshots = [{ snapshot_date: '2026-09-20', revolving_balance: null }];
    renderHook(() => useNetWorthSnapshotRecorder(null));
    expect(fillMutate).not.toHaveBeenCalled();
  });

  it('never overwrites a recorded balance', () => {
    snapshots = [{ snapshot_date: '2026-09-20', revolving_balance: 900 }];
    renderHook(() => useNetWorthSnapshotRecorder(1234.56));
    expect(fillMutate).not.toHaveBeenCalled();
  });

  it('fills once the projection arrives on a later render', () => {
    snapshots = [{ snapshot_date: '2026-09-20', revolving_balance: null }];
    const { rerender } = renderHook(({ bal }) => useNetWorthSnapshotRecorder(bal), {
      initialProps: { bal: null as number | null },
    });
    expect(fillMutate).not.toHaveBeenCalled();
    rerender({ bal: 50 });
    expect(fillMutate).toHaveBeenCalledTimes(1);
  });
});

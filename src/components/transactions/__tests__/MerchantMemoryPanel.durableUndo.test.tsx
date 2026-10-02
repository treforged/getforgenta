// @vitest-environment jsdom
//
// MERCHANT MEMORY APPLIES BY DEFAULT, AND ITS UNDO HOLDS (b64a094e).
//
// Tre, 2026-10-01: merchant memory should apply without asking. The prompt is gone, so these assert
// the WRITES happen (a panel that renders nothing and does nothing would pass any "the prompt is
// gone" check), and that the undo carries the risk the prompt used to:
//   * applying RECORDS a reversal plan, computed while the previous categories are still known
//   * undoing REPLAYS that plan and only then marks the record reversed
//   * an UNDONE CHARGE is not re-applied on the next mount. The undo makes it uncategorized again,
//     so without the durable guard the automatic pass labels it straight back. The merchant's NEW
//     charges still apply: the guard is per charge, not per merchant.
//   * nothing applies while the undo record is being refetched (the pre-undo cache would lie)
//   * a FAILED undo marks nothing, so the remainder stays reversible

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import MerchantMemoryPanel from '../MerchantMemoryPanel';

type Write = { chargeId: string; key: string; label: string; category: string; previousCategory: string | null };

const mocks = vi.hoisted(() => ({
  writes: [] as { chargeId: string; key: string; label: string; category: string; previousCategory: string | null }[],
  undone: new Set<string>(),
  undoneUnknown: false,
  latest: null as unknown,
  record: { mutateAsync: vi.fn() },
  markUndone: { mutateAsync: vi.fn() },
}));

vi.mock('@/hooks/useMerchantMemory', () => ({
  useMerchantMemory: () => ({ pass: { writes: mocks.writes, byMerchant: [] }, isLoading: false }),
}));
vi.mock('@/hooks/useAppliedActions', () => ({
  useAppliedActions: () => ({
    latest: mocks.latest,
    record: mocks.record,
    markUndone: mocks.markUndone,
    stepsOf: (row: { steps: unknown }) => row.steps as never,
    undoneChargeIds: mocks.undone,
    undoneUnknown: mocks.undoneUnknown,
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), message: vi.fn(), error: vi.fn() } }));

const setCategory = { mutateAsync: vi.fn() };

const COSTCO: Write = { chargeId: 'c1', key: 'COSTCO', label: 'Costco', category: 'Groceries', previousCategory: null };
// Labelled more than one way. It used to wait behind "Apply to N past charges"; it no longer does.
const MIXED: Write = { chargeId: 'c2', key: 'MIXED', label: 'Mixed', category: 'Shopping', previousCategory: null };

const APPLIED = {
  id: 'a1',
  kind: 'merchant_retro_pass',
  label: 'Categorized 2 charges from merchants you have labeled before',
  steps: [
    { write: 'setCategory', chargeId: 'c2', category: null },
    { write: 'setCategory', chargeId: 'c1', category: null },
  ],
  created_at: new Date().toISOString(),
  undone_at: null,
};

beforeEach(() => {
  mocks.writes = [COSTCO, MIXED];
  mocks.undone = new Set();
  mocks.undoneUnknown = false;
  mocks.latest = null;
  mocks.record.mutateAsync.mockReset().mockResolvedValue({ id: 'a1' });
  mocks.markUndone.mutateAsync.mockReset().mockResolvedValue(undefined);
  setCategory.mutateAsync.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('applying by default', () => {
  it('writes EVERY merchant with no press, including one labelled more than one way', async () => {
    render(<MerchantMemoryPanel setCategory={setCategory} />);
    await waitFor(() => expect(setCategory.mutateAsync).toHaveBeenCalledTimes(2));
    expect(setCategory.mutateAsync).toHaveBeenCalledWith({ syncedTransactionId: 'c1', category: 'Groceries' });
    expect(setCategory.mutateAsync).toHaveBeenCalledWith({ syncedTransactionId: 'c2', category: 'Shopping' });
    expect(screen.queryByRole('button', { name: /Apply to/i })).toBeNull();
  });

  it('records the PREVIOUS categories, newest first', async () => {
    render(<MerchantMemoryPanel setCategory={setCategory} />);
    await waitFor(() => expect(mocks.record.mutateAsync).toHaveBeenCalledTimes(1));
    const arg = mocks.record.mutateAsync.mock.calls[0][0] as { kind: string; steps: unknown[] };
    expect(arg.kind).toBe('merchant_retro_pass');
    expect(arg.steps).toEqual(APPLIED.steps);
  });
});

describe('undoing', () => {
  beforeEach(() => { mocks.latest = APPLIED; mocks.writes = []; });

  it('offers the undo from the STORED record, so it survives a reload', () => {
    render(<MerchantMemoryPanel setCategory={setCategory} />);
    expect(screen.getByText(/Categorized 2 charges/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Undo/i })).toBeTruthy();
  });

  it('replays every step, then marks the record reversed', async () => {
    render(<MerchantMemoryPanel setCategory={setCategory} />);
    fireEvent.click(screen.getByRole('button', { name: /Undo/i }));

    await waitFor(() => expect(mocks.markUndone.mutateAsync).toHaveBeenCalledWith('a1'));
    expect(setCategory.mutateAsync).toHaveBeenCalledTimes(2);
    expect(setCategory.mutateAsync).toHaveBeenCalledWith({ syncedTransactionId: 'c2', category: null });
    expect(setCategory.mutateAsync).toHaveBeenCalledWith({ syncedTransactionId: 'c1', category: null });
  });

  it('does NOT mark it reversed when the replay fails part way', async () => {
    setCategory.mutateAsync
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('network'));

    render(<MerchantMemoryPanel setCategory={setCategory} />);
    fireEvent.click(screen.getByRole('button', { name: /Undo/i }));

    await waitFor(() => expect(setCategory.mutateAsync).toHaveBeenCalledTimes(2));
    expect(mocks.markUndone.mutateAsync).not.toHaveBeenCalled();
  });
});

describe('an undone charge stays undone', () => {
  it('is NOT re-applied on the next mount, while a NEW charge from the same merchant still is', async () => {
    // The next visit after an undo: c1 and c2 are uncategorized again and the durable record says
    // the user took them back. c3 is a fresh Costco charge nobody has decided about.
    const C3: Write = { ...COSTCO, chargeId: 'c3' };
    mocks.writes = [COSTCO, MIXED, C3];
    mocks.undone = new Set(['c1', 'c2']);
    render(<MerchantMemoryPanel setCategory={setCategory} />);
    await waitFor(() => expect(mocks.record.mutateAsync).toHaveBeenCalledTimes(1));
    expect(setCategory.mutateAsync).toHaveBeenCalledTimes(1);
    expect(setCategory.mutateAsync).toHaveBeenCalledWith({ syncedTransactionId: 'c3', category: 'Groceries' });
  });

  it('applies nothing while the undo record is being refetched', async () => {
    // Straight after an undo the cached set is the PRE-undo one, so acting on it would re-apply the
    // charges just taken back. Nothing may run until it is current.
    mocks.undoneUnknown = true;
    render(<MerchantMemoryPanel setCategory={setCategory} />);
    await new Promise(r => setTimeout(r, 50));
    expect(setCategory.mutateAsync).not.toHaveBeenCalled();
  });
});

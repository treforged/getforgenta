// @vitest-environment jsdom
//
// THE PANEL'S PROMISE, MADE TRUE.
//
// Its copy tells the user the pass "undoes in one press". Until 2026-09-12 that was true only
// while the panel was on screen: the applied pass lived in `useState`, so a reload or a navigation
// silently turned the promise false. Tre reported the general version of this as "There's no easy
// way to undo this action."
//
// So these assert the two halves that make the promise real:
//   * applying RECORDS a reversal plan, computed while the previous categories are still known
//   * undoing REPLAYS that plan and only then marks the record reversed
//
// The third test is the one that matters most and is the easiest to get wrong: a FAILED undo must
// NOT mark the record undone, or the remainder becomes unreachable and the user is left with a
// half-undone pass and nothing left to press.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import MerchantMemoryPanel from '../MerchantMemoryPanel';

const mocks = vi.hoisted(() => ({
  pass: {
    writes: [
      { chargeId: 'c1', category: 'Groceries', previousCategory: null },
      { chargeId: 'c2', category: 'Gas', previousCategory: 'Other' },
    ],
    byMerchant: [{ key: 'COSTCO', label: 'Costco', category: 'Groceries', count: 2 }],
  },
  // Both merchants deliberately UNSETTLED, so nothing auto-applies and these tests keep
  // exercising the confirm path they were written for. The auto path has its own tests.
  rules: {} as Record<string, { decidedCount: number; conflictingCount: number }>,
  latest: null as unknown,
  record: { mutateAsync: vi.fn().mockResolvedValue({ id: 'a1' }) },
  markUndone: { mutateAsync: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@/hooks/useMerchantMemory', () => ({
  useMerchantMemory: () => ({ pass: mocks.pass, rules: mocks.rules, isLoading: false }),
}));
vi.mock('@/hooks/useAppliedActions', () => ({
  useAppliedActions: () => ({
    latest: mocks.latest,
    record: mocks.record,
    markUndone: mocks.markUndone,
    stepsOf: (row: { steps: unknown }) => row.steps as never,
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), message: vi.fn(), error: vi.fn() } }));

const setCategory = { mutateAsync: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  mocks.latest = null;
  mocks.record.mutateAsync.mockClear().mockResolvedValue({ id: 'a1' });
  mocks.markUndone.mutateAsync.mockClear().mockResolvedValue(undefined);
  setCategory.mutateAsync.mockClear().mockResolvedValue(undefined);
});
afterEach(cleanup);

const APPLIED = {
  id: 'a1',
  kind: 'merchant_retro_pass',
  label: 'Categorized 2 charges from merchants you have labeled before',
  steps: [
    { write: 'setCategory', chargeId: 'c2', category: 'Other' },
    { write: 'setCategory', chargeId: 'c1', category: null },
  ],
  created_at: new Date().toISOString(),
  undone_at: null,
};

describe('applying records a durable reversal plan', () => {
  it('stores the PREVIOUS categories, which are only knowable at apply time', async () => {
    render(<MerchantMemoryPanel setCategory={setCategory} />);
    // Two presses on purpose -- the panel confirms before a bulk write, and that confirm step is
    // the behaviour being preserved, not bypassed.
    fireEvent.click(screen.getByRole('button', { name: /Apply to 2 past charges/i }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm . label 2/i }));

    await waitFor(() => expect(mocks.record.mutateAsync).toHaveBeenCalled());
    const arg = mocks.record.mutateAsync.mock.calls[0][0] as {
      kind: string; steps: { chargeId: string; category: string | null }[];
    };
    expect(arg.kind).toBe('merchant_retro_pass');
    // Newest first, each restoring what the charge had BEFORE the pass.
    expect(arg.steps).toEqual([
      { write: 'setCategory', chargeId: 'c2', category: 'Other' },
      { write: 'setCategory', chargeId: 'c1', category: null },
    ]);
  });
});

describe('undoing replays the stored plan', () => {
  beforeEach(() => { mocks.latest = APPLIED; });

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
    expect(setCategory.mutateAsync).toHaveBeenCalledWith({ syncedTransactionId: 'c2', category: 'Other' });
    expect(setCategory.mutateAsync).toHaveBeenCalledWith({ syncedTransactionId: 'c1', category: null });
  });

  it('does NOT mark it reversed when the replay fails part way', async () => {
    // The half that did not happen must stay reversible. Marking it undone here would retire the
    // record while the work was incomplete, leaving no way to finish it.
    setCategory.mutateAsync
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('network'));

    render(<MerchantMemoryPanel setCategory={setCategory} />);
    fireEvent.click(screen.getByRole('button', { name: /Undo/i }));

    await waitFor(() => expect(setCategory.mutateAsync).toHaveBeenCalledTimes(2));
    expect(mocks.markUndone.mutateAsync).not.toHaveBeenCalled();
  });
});

/**
 * THE PROMPT DISAPPEARING — Tre, 2026-09-12: "this section shouldn't exist. it should auto apply."
 *
 * ⚠️ THESE ASSERT THE WRITES HAPPEN, not that the panel hid. A component that renders nothing and
 * also does nothing would pass any "the prompt is gone" check, and would be the worse outcome: his
 * charges silently left unlabelled instead of silently labelled.
 */
describe('auto-applying the settled merchants', () => {
  beforeEach(() => {
    mocks.latest = null;
    // COSTCO settled; NEWPLACE labelled once, so not yet a habit.
    mocks.pass = {
      writes: [
        { chargeId: 'c1', key: 'COSTCO', category: 'Groceries', previousCategory: null },
        { chargeId: 'c2', key: 'NEWPLACE', category: 'Dining', previousCategory: null },
      ],
      byMerchant: [
        { key: 'COSTCO', label: 'Costco', category: 'Groceries', count: 1 },
        { key: 'NEWPLACE', label: 'New Place', category: 'Dining', count: 1 },
      ],
    } as never;
    mocks.rules = {
      COSTCO: { decidedCount: 9, conflictingCount: 0 },
      NEWPLACE: { decidedCount: 1, conflictingCount: 0 },
    };
  });

  it('writes the settled merchant with NO press at all', async () => {
    render(<MerchantMemoryPanel setCategory={setCategory} />);
    await waitFor(() => expect(setCategory.mutateAsync).toHaveBeenCalledWith(
      { syncedTransactionId: 'c1', category: 'Groceries' },
    ));
    // And ONLY that one — the unsettled merchant is still his to decide.
    expect(setCategory.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('records a durable undo for what it did without asking', async () => {
    // The half he is NOT watching is the half that most needs to be reversible.
    render(<MerchantMemoryPanel setCategory={setCategory} />);
    await waitFor(() => expect(mocks.record.mutateAsync).toHaveBeenCalled());
    const arg = mocks.record.mutateAsync.mock.calls[0][0] as { steps: { chargeId: string }[] };
    expect(arg.steps.map(st => st.chargeId)).toEqual(['c1']);
  });

  it('still ASKS about the merchant labelled inconsistently — the panel shrinks, it does not vanish', async () => {
    mocks.rules = {
      COSTCO: { decidedCount: 12, conflictingCount: 4 },
      NEWPLACE: { decidedCount: 1, conflictingCount: 0 },
    };
    render(<MerchantMemoryPanel setCategory={setCategory} />);
    // Nothing auto-applied, and both remain on offer.
    expect(await screen.findByText(/Apply to 2 past charges/i)).toBeTruthy();
    expect(setCategory.mutateAsync).not.toHaveBeenCalled();
  });
});

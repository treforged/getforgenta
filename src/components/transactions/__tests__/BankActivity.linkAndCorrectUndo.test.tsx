// @vitest-environment jsdom
//
// "LINK AND CORRECT" WAS THE LAST PER-ROW WRITE WITH NO DURABLE UNDO, and the absence was honest
// rather than an oversight: the three original step kinds could not put a ledger amount back, so
// recording a link-only reversal would have given the user a button that removes the link, leaves
// the corrected figure standing, and reports success — a partial undo presented as a complete one,
// on a money page. `restoreTransaction` is what ends that.
//
// ⚠️ EVERY ASSERTION HERE IS ABOUT A CHANGE, NOT ABOUT THE ABSENCE OF AN ERROR. Pressing this
// button threw nothing before the fix either; it linked, corrected, and recorded no way back. A
// test that pressed it and checked the page survived passed against the defect every single time.
//
// ⚠️ AND THE UNDO IS ASSERTED BY REPLAY, not only by the record being written. Two of the three
// durable undo kinds in this repo were recorded correctly and offered to nobody for weeks, with a
// green suite over them the whole time. Writing the record was never the promise.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  save: vi.fn().mockResolvedValue(undefined),
  record: vi.fn().mockResolvedValue(null),
  updateLedger: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  setCategory: vi.fn().mockResolvedValue(undefined),
  markUndone: vi.fn().mockResolvedValue(undefined),
  latest: null as Record<string, unknown> | null,
}));

const ACCOUNT = {
  id: 'acc-1', user_id: 'u1', name: 'Everyday Checking', account_type: 'checking',
  balance: 4200, active: true, created_at: '2026-01-01T00:00:00Z',
};

/** What the person TYPED before the money moved — an estimate, which is the whole premise. */
const LEDGER_TXN = {
  id: 'txn-9', user_id: 'u1', amount: 50, date: '2026-09-01', type: 'expense',
  category: 'Car', payment_source: 'acc-1', origin: 'manual', note: 'Gas',
};

/** What the bank actually charged. Outflow-positive, per Stage A's convention. */
const CHARGE = {
  id: 'stx-9', user_id: 'u1', account_id: 'acc-1', amount: 52.3, date: '2026-09-02',
  pending: false, name: 'SHELL OIL', merchant_name: 'SHELL', category: null,
};

vi.mock('@/hooks/useSupabaseData', async () => {
  const review = await import('@/lib/synced-transaction-review');
  const importer = await import('@/lib/synced-transaction-import');
  return {
    useAllSyncedTransactions: () => ({ data: [CHARGE], isLoading: false }),
    useSyncedTransactionReviews: () => ({
      data: [],
      save: { mutate: vi.fn(), mutateAsync: mocks.save },
      setCategory: { mutate: vi.fn(), mutateAsync: mocks.setCategory },
      remove: { mutate: vi.fn(), mutateAsync: mocks.remove },
      removeLink: { mutate: vi.fn() },
      importToLedger: { mutate: vi.fn(), mutateAsync: vi.fn() },
      undoImport: { mutate: vi.fn(), mutateAsync: vi.fn() },
    }),
    useAccounts: () => ({ data: [ACCOUNT], loading: false }),
    useRecurringRules: () => ({ data: [], loading: false }),
    useTransactions: () => ({
      data: [LEDGER_TXN], loading: false,
      update: { mutate: vi.fn(), mutateAsync: mocks.updateLedger },
    }),
    usePaymentPlans: () => ({ data: [], loading: false }),
    useCarFunds: () => ({ data: [], loading: false }),
    useAllCarBuildItems: () => ({ data: [] }),
    isHandledReview: review.isHandledReview,
    isLinkStatus: review.isLinkStatus,
    findExclusiveReview: review.findExclusiveReview,
    planLedgerImport: importer.planLedgerImport,
  };
});

vi.mock('@/hooks/useBankReviewQueue', () => ({
  useBankReviewQueue: () => ({
    queue: {
      needsDecision: [CHARGE],
      suggestions: { [CHARGE.id]: { ledgerTxn: LEDGER_TXN } },
      suggestedCount: 1,
    },
    reviewsByCharge: {},
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useCrowdCategories', () => ({ useCrowdCategories: () => ({ crowd: {} }) }));
vi.mock('@/hooks/useAppliedActions', async () => {
  // The REAL `parseUndoSteps`. Stubbing it would let this file agree with itself about a step
  // shape the boundary validator would reject.
  const applied = await import('@/lib/applied-actions');
  return {
    useAppliedActions: () => ({
      actions: [], latest: mocks.latest, isLoading: false,
      record: { mutateAsync: mocks.record },
      markUndone: { mutateAsync: mocks.markUndone },
      stepsOf: (row: { steps: unknown }) => applied.parseUndoSteps(row.steps),
    }),
  };
});
vi.mock('../DecisionDeck', () => ({ default: () => null }));
vi.mock('../MerchantMemoryPanel', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import BankActivity from '../BankActivity';

beforeEach(() => {
  mocks.latest = null;
  mocks.save.mockClear().mockResolvedValue(undefined);
  mocks.record.mockClear().mockResolvedValue(null);
  mocks.updateLedger.mockClear().mockResolvedValue(undefined);
  mocks.remove.mockClear().mockResolvedValue(undefined);
  mocks.setCategory.mockClear().mockResolvedValue(undefined);
  mocks.markUndone.mockClear().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('Link and correct — the amount change is now reversible', () => {
  it('shows both figures on the button before the press', async () => {
    render(<BankActivity />);
    // A control that says only "matches" and then changes an amount did more than it said.
    expect(await screen.findByText(/Link and correct .*50.* → .*52/)).toBeTruthy();
  });

  it('records a restoreTransaction step carrying the TYPED values, not the bank\'s', async () => {
    render(<BankActivity />);
    fireEvent.click(await screen.findByText(/Link and correct/));

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    // The correction landed — amount, date and origin together.
    await waitFor(() => expect(mocks.updateLedger).toHaveBeenCalledTimes(1));
    expect(mocks.updateLedger.mock.calls[0][0]).toMatchObject({
      id: 'txn-9', amount: 52.3, date: '2026-09-02', origin: 'synced',
    });

    await waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(1));
    const steps = mocks.record.mock.calls[0][0].steps;
    expect(steps).toContainEqual({ write: 'removeReviews', chargeId: 'stx-9' });
    // THE ASSERTION THIS FILE EXISTS FOR. Before `restoreTransaction` there was no step here at
    // all, by design, because none of the three could put $50 back.
    expect(steps).toContainEqual({
      write: 'restoreTransaction', chargeId: 'stx-9', transactionId: 'txn-9',
      amount: 50, date: '2026-09-01', origin: 'manual',
    });
  });

  it('records NO restore step when the correction itself failed', async () => {
    // An undo offering to restore an amount nothing changed is a reversal of something that did
    // not happen. The link still records its own undo, because the link is what landed.
    mocks.updateLedger.mockRejectedValue(new Error('network'));
    render(<BankActivity />);
    fireEvent.click(await screen.findByText(/Link and correct/));

    await waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(1));
    const steps = mocks.record.mock.calls[0][0].steps as { write: string }[];
    expect(steps.some(s => s.write === 'restoreTransaction')).toBe(false);
    expect(steps.some(s => s.write === 'removeReviews')).toBe(true);
  });

  it('records NOTHING when the link write itself fails', async () => {
    mocks.save.mockRejectedValue(new Error('network'));
    render(<BankActivity />);
    fireEvent.click(await screen.findByText(/Link and correct/));

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.record).not.toHaveBeenCalled();
    // And nothing was corrected either — the ledger amount is untouched when the link never landed.
    expect(mocks.updateLedger).not.toHaveBeenCalled();
  });
});

describe('Link and correct — REPLAY, because a written record nobody replays is not an undo', () => {
  const STORED = {
    id: 'act-9', user_id: 'u1', kind: 'link_confirm', label: 'Linked and corrected $50 → $52.30',
    created_at: new Date().toISOString(), undone_at: null,
    steps: [
      { write: 'removeReviews', chargeId: 'stx-9' },
      {
        write: 'restoreTransaction', chargeId: 'stx-9', transactionId: 'txn-9',
        amount: 50, date: '2026-09-01', origin: 'manual',
      },
    ],
  };

  it('puts the amount, the date AND the origin back, then marks the record undone', async () => {
    mocks.latest = STORED;
    render(<BankActivity />);
    fireEvent.click(await screen.findByRole('button', { name: /undo/i }));

    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('stx-9'));
    await waitFor(() => expect(mocks.updateLedger).toHaveBeenCalledTimes(1));
    // All three, not just the amount — restoring the figure and leaving the row marked `synced`
    // would be the same partial undo one field over.
    expect(mocks.updateLedger.mock.calls[0][0]).toEqual({
      id: 'txn-9', amount: 50, date: '2026-09-01', origin: 'manual',
    });
    // Marked undone ONLY after every step landed.
    await waitFor(() => expect(mocks.markUndone).toHaveBeenCalledWith('act-9'));
  });

  it('does NOT mark the record undone when the restore fails — the rest stays offered', async () => {
    mocks.latest = STORED;
    mocks.updateLedger.mockRejectedValue(new Error('network'));
    render(<BankActivity />);
    fireEvent.click(await screen.findByRole('button', { name: /undo/i }));

    await waitFor(() => expect(mocks.updateLedger).toHaveBeenCalled());
    expect(mocks.markUndone).not.toHaveBeenCalled();
  });
});

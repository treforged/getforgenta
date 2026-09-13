// @vitest-environment jsdom
//
// A per-row link must record a DURABLE undo, exactly as the batch accept does.
//
// Tre, 2026-09-12: a confirmed transaction link had no undo and it overwrote his live expected
// numbers. `acceptAllSuggested` was made durable and the eight single-row `save.mutate(accept…)`
// call sites were left behind, writing a link and recording nothing — while the comment on the
// batch asserted "Every row it did write is individually undoable". That sentence was true of the
// batch's own record and false of the buttons, which is how the gap survived review.
//
// ⚠️ THIS FILE ASSERTS THE RECORD, NOT THE ABSENCE OF AN ERROR. Pressing "Confirm" threw nothing
// before this change either — it linked the charge and silently recorded no reversal. A smoke test
// that pressed the button and checked it did not blow up passed against the defect every time. So
// every case here asserts `record.mutateAsync` was CALLED, with the steps that actually reverse the
// write: `removeReviews` to take the link off, and `setCategory` to put back the label the
// exclusive row owned beforehand — captured before the write, because `save` writes every column
// including the nulls and the old value is gone from the row afterwards.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  save: vi.fn().mockResolvedValue(undefined),
  record: vi.fn().mockResolvedValue(null),
  updateLedgerTxn: vi.fn(),
  remove: vi.fn().mockResolvedValue(undefined),
  setCategory: vi.fn().mockResolvedValue(undefined),
  markUndone: vi.fn().mockResolvedValue(undefined),
  latest: null as Record<string, unknown> | null,
  reviews: [] as Record<string, unknown>[],
  suggestions: {} as Record<string, unknown>,
}));

const ACCOUNT = {
  id: 'acc-1', user_id: 'u1', name: 'Everyday Checking', account_type: 'checking',
  balance: 4200, active: true, created_at: '2026-01-01T00:00:00Z',
};

const RULE = {
  id: 'rule-1', user_id: 'u1', name: 'Rent', amount: 1600, rule_type: 'expense',
  frequency: 'monthly', due_day: 28, due_month: null, category: 'Bills',
  payment_source: 'acc-1', deposit_account: null, start_date: null, end_date: null,
  active: true, created_at: '2026-01-01T00:00:00Z',
};

/** Outflow-positive, per Stage A's convention. Amount sits near the rule's so the suggestion is
 *  not refused by `amountCouldSettle` — a charge too small to have settled Rent is deliberately
 *  never offered, and this file is not testing that gate. */
const CHARGE = {
  id: 'stx-1', user_id: 'u1', account_id: 'acc-1', amount: 1600, date: '2026-08-28',
  pending: false, name: 'RENT PAYMENT', merchant_name: 'RENT', category: null,
};

vi.mock('@/hooks/useSupabaseData', async () => {
  const review = await import('@/lib/synced-transaction-review');
  const importer = await import('@/lib/synced-transaction-import');
  return {
    useAllSyncedTransactions: () => ({ data: [CHARGE], isLoading: false }),
    useSyncedTransactionReviews: () => ({
      data: mocks.reviews,
      save: { mutate: vi.fn(), mutateAsync: mocks.save },
      setCategory: { mutate: vi.fn(), mutateAsync: mocks.setCategory },
      remove: { mutate: vi.fn(), mutateAsync: mocks.remove },
      removeLink: { mutate: vi.fn() },
      importToLedger: { mutate: vi.fn(), mutateAsync: vi.fn() },
      undoImport: { mutate: vi.fn(), mutateAsync: vi.fn() },
    }),
    useAccounts: () => ({ data: [ACCOUNT], loading: false }),
    useRecurringRules: () => ({ data: [RULE], loading: false }),
    useTransactions: () => ({ data: [], loading: false, update: { mutate: mocks.updateLedgerTxn } }),
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
      suggestions: mocks.suggestions,
      suggestedCount: Object.keys(mocks.suggestions).length,
    },
    reviewsByCharge: mocks.reviews.length ? { [CHARGE.id]: mocks.reviews } : {},
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useCrowdCategories', () => ({ useCrowdCategories: () => ({ crowd: {} }) }));
vi.mock('@/hooks/useAppliedActions', async () => {
  // `stepsOf` is the REAL `parseUndoSteps`. Stubbing it would leave the undo test agreeing with
  // itself about a step shape the database never validates.
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
  mocks.reviews = [];
  mocks.suggestions = { [CHARGE.id]: { rule: RULE } };
  mocks.latest = null;
  mocks.save.mockClear().mockResolvedValue(undefined);
  mocks.record.mockClear().mockResolvedValue(null);
  mocks.remove.mockClear().mockResolvedValue(undefined);
  mocks.setCategory.mockClear().mockResolvedValue(undefined);
  mocks.markUndone.mockClear().mockResolvedValue(undefined);
  mocks.updateLedgerTxn.mockClear();
});
afterEach(cleanup);

describe('Bank Activity — a per-row link is durably undoable', () => {
  it('records the reversal when a suggested rule link is confirmed', async () => {
    render(<BankActivity />);
    fireEvent.click(screen.getByText(/Confirm: Rent/));

    // The link landed...
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    // ...and so did the record that can take it back. THIS is the assertion the defect failed:
    // before the fix the press linked the charge and called nothing here.
    await waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(1));

    const recorded = mocks.record.mock.calls[0][0];
    expect(recorded.kind).toBe('link_confirm');
    expect(recorded.steps).toEqual([{ write: 'removeReviews', chargeId: 'stx-1' }]);
  });

  it('puts the previous category back, because the link write clears it', async () => {
    // The charge already carries a label the user set. `save` writes every column including the
    // nulls, so the reversal has to restore it explicitly — a bare `removeReviews` would take the
    // link off and leave the charge unlabelled, which is a second silent loss inside the undo.
    mocks.reviews = [{
      id: 'rev-1', synced_transaction_id: 'stx-1', status: 'categorized',
      category_override: 'Bills', user_id: 'u1', created_at: '2026-08-28T00:00:00Z',
    }];
    render(<BankActivity />);
    fireEvent.click(screen.getByText(/Confirm: Rent/));

    await waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(1));
    expect(mocks.record.mock.calls[0][0].steps).toEqual([
      { write: 'removeReviews', chargeId: 'stx-1' },
      { write: 'setCategory', chargeId: 'stx-1', category: 'Bills' },
    ]);
  });

  it('records NOTHING when the link write itself fails', async () => {
    // An undo offered for a write that never landed is worse than no undo: pressing it would try
    // to reverse work the database never did. The batch accept follows the same rule by appending
    // its steps only after each successful write.
    mocks.save.mockRejectedValue(new Error('network'));
    render(<BankActivity />);
    fireEvent.click(screen.getByText(/Confirm: Rent/));

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.record).not.toHaveBeenCalled();
  });
});

// ⚠️ THE RECORD WAS WRITE-ONLY UNTIL THE SURFACE BELOW EXISTED. Both the batch and the per-row
// buttons wrote `link_confirm` rows to `public.applied_actions`, and NOTHING READ THEM BACK —
// MerchantMemoryPanel is the only other consumer and it filters to `merchant_retro_pass`. Every
// test above passed against that, because they assert the record is WRITTEN. Writing it is not the
// promise; getting the numbers back is. These assert the other half.
describe('Bank Activity — a recorded link undo is actually offered and replayed', () => {
  const STORED = {
    id: 'act-1', user_id: 'u1', kind: 'link_confirm', label: 'Linked Rent',
    created_at: new Date().toISOString(), undone_at: null,
    steps: [
      { write: 'removeReviews', chargeId: 'stx-1' },
      { write: 'setCategory', chargeId: 'stx-1', category: 'Bills' },
    ],
  };

  it('offers the stored undo', () => {
    mocks.latest = STORED;
    render(<BankActivity />);
    expect(screen.getByText('Linked Rent')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });

  it('replays every step and only then marks the record undone', async () => {
    mocks.latest = STORED;
    render(<BankActivity />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    // The link comes off AND the previous label goes back. A press that did neither and still
    // reported success is the exact failure this surface exists to remove.
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('stx-1'));
    await waitFor(() => expect(mocks.setCategory).toHaveBeenCalledWith({
      syncedTransactionId: 'stx-1', category: 'Bills',
    }));
    await waitFor(() => expect(mocks.markUndone).toHaveBeenCalledWith('act-1'));
  });

  it('does NOT mark the record undone when a step fails, so the rest stays offered', async () => {
    mocks.latest = STORED;
    mocks.remove.mockRejectedValue(new Error('network'));
    render(<BankActivity />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(1));
    // Retiring the record here would leave a half-undone link with no undo left to finish it.
    expect(mocks.markUndone).not.toHaveBeenCalled();
  });

  it('offers a finished deck run too, because its own undo dies with the deck', () => {
    // `deck_decision` was write-only for the same reason `link_confirm` was. The deck's in-session
    // "Undo all" disappears when the deck closes — surviving that is the entire point of the
    // durable record, and it was never offered anywhere.
    mocks.latest = { ...STORED, kind: 'deck_decision', label: '6 charges decided' };
    render(<BankActivity />);
    expect(screen.getByText('6 charges decided')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });

  it('replays a deck run through the same executor', async () => {
    mocks.latest = { ...STORED, kind: 'deck_decision', label: '6 charges decided' };
    render(<BankActivity />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('stx-1'));
    await waitFor(() => expect(mocks.markUndone).toHaveBeenCalledWith('act-1'));
  });

  it('does NOT claim a merchant pass, which its own panel already offers', () => {
    // Two banners for one act would let the user press undo twice, the second press trying to
    // reverse work the first already reversed.
    mocks.latest = { ...STORED, kind: 'merchant_retro_pass' };
    render(<BankActivity />);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});

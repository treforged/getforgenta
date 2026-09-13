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
      setCategory: { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(undefined) },
      remove: { mutate: vi.fn(), mutateAsync: vi.fn() },
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
vi.mock('@/hooks/useAppliedActions', () => ({
  useAppliedActions: () => ({
    actions: [], latest: null, isLoading: false,
    record: { mutateAsync: mocks.record },
    markUndone: { mutateAsync: vi.fn().mockResolvedValue(undefined) },
    stepsOf: () => [],
  }),
}));
vi.mock('../DecisionDeck', () => ({ default: () => null }));
vi.mock('../MerchantMemoryPanel', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import BankActivity from '../BankActivity';

beforeEach(() => {
  mocks.reviews = [];
  mocks.suggestions = { [CHARGE.id]: { rule: RULE } };
  mocks.save.mockClear().mockResolvedValue(undefined);
  mocks.record.mockClear().mockResolvedValue(null);
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

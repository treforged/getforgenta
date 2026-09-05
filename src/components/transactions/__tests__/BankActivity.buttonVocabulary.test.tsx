// @vitest-environment jsdom
//
// Presses the buttons this slice re-classed onto the repo's `btn` vocabulary
// (`btn btn-md btn-primary`, `btn btn-md btn-secondary`, the "Load more"
// `btn btn-secondary` outlier) and asserts they still do what they did before
// the class rename — a class-only diff that silently breaks a handler is
// exactly the failure a smoke render would miss.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  saveMutateAsync: vi.fn().mockResolvedValue(undefined),
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

const charge = (id: string, name: string) => ({
  id, user_id: 'u1', account_id: 'acc-1', amount: 42.5, date: '2026-08-18',
  pending: false, name, merchant_name: name, category: null,
});

const CHARGE_1 = charge('stx-1', 'PUBLIX SUPER MARKET');
const CHARGE_2 = charge('stx-2', 'WALMART');

// 101 rows so "all activity" crosses the PAGE_SIZE=100 fold and "Show N more" renders.
const MANY_SYNCED = Array.from({ length: 101 }, (_, i) => charge(`bulk-${i}`, `MERCHANT ${i}`));

let needsDecision: Record<string, unknown>[] = [];
let allSynced: Record<string, unknown>[] = [];

vi.mock('@/hooks/useSupabaseData', async () => {
  const review = await import('@/lib/synced-transaction-review');
  const importer = await import('@/lib/synced-transaction-import');
  return {
    useAllSyncedTransactions: () => ({ data: allSynced, isLoading: false }),
    useSyncedTransactionReviews: () => ({
      data: mocks.reviews,
      save: { mutate: vi.fn(), mutateAsync: mocks.saveMutateAsync },
      setCategory: { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(undefined) },
      remove: { mutate: vi.fn(), mutateAsync: vi.fn() },
      removeLink: { mutate: vi.fn() },
      importToLedger: { mutate: vi.fn(), mutateAsync: vi.fn() },
      undoImport: { mutate: vi.fn(), mutateAsync: vi.fn() },
    }),
    useAccounts: () => ({ data: [ACCOUNT], loading: false }),
    useRecurringRules: () => ({ data: [RULE], loading: false }),
    useTransactions: () => ({ data: [], loading: false, update: { mutate: vi.fn() } }),
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
      needsDecision,
      suggestions: mocks.suggestions,
      suggestedCount: Object.keys(mocks.suggestions).length,
    },
    reviewsByCharge: {},
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useCrowdCategories', () => ({ useCrowdCategories: () => ({ crowd: {} }) }));
vi.mock('../DecisionDeck', () => ({ default: () => null }));
vi.mock('../MerchantMemoryPanel', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import BankActivity from '../BankActivity';

beforeEach(() => {
  needsDecision = [];
  allSynced = [];
  mocks.reviews = [];
  mocks.suggestions = {};
  mocks.saveMutateAsync.mockClear().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('Bank Activity — btn-vocabulary buttons still work', () => {
  it('"Accept all N suggested" (btn-secondary) reveals "Confirm — link N" (btn-primary), and pressing it writes the links', async () => {
    needsDecision = [CHARGE_1, CHARGE_2];
    allSynced = [CHARGE_1, CHARGE_2];
    mocks.suggestions = {
      [CHARGE_1.id]: { rule: RULE },
      [CHARGE_2.id]: { rule: RULE },
    };
    render(<BankActivity />);

    const acceptAllBtn = screen.getByText(/Accept all 2 suggested/i);
    expect(acceptAllBtn.className).toContain('btn-secondary');
    fireEvent.click(acceptAllBtn);

    const confirmBtn = await screen.findByText(/Confirm — link 2/i);
    expect(confirmBtn.className).toContain('btn-primary');
    fireEvent.click(confirmBtn);

    // Both suggested charges get linked — the batch write the button exists to fire.
    await waitFor(() => expect(mocks.saveMutateAsync).toHaveBeenCalledTimes(2));
    expect(mocks.saveMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ synced_transaction_id: CHARGE_1.id, rule_id: RULE.id }),
    );
    expect(mocks.saveMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ synced_transaction_id: CHARGE_2.id, rule_id: RULE.id }),
    );

    // The confirm UI closes back down once the batch finishes.
    await waitFor(() => expect(screen.queryByText(/Confirm — link/i)).toBeNull());
  });

  it('"Show N more" (btn + custom size, no bucket forced) actually reveals the next page of rows', async () => {
    allSynced = MANY_SYNCED;
    render(<BankActivity />);
    fireEvent.click(screen.getByText('All activity'));

    // 101 rows, PAGE_SIZE 100 — the 101st merchant name is off-screen until the button is pressed.
    expect(screen.queryByText('MERCHANT 100')).toBeNull();
    const loadMore = screen.getByText(/Show 1 more/i);
    expect(loadMore.className).toContain('btn-secondary');
    fireEvent.click(loadMore);

    await waitFor(() => expect(screen.queryByText('MERCHANT 100')).not.toBeNull());
    // The button describing "more to load" is gone now that everything is shown.
    expect(screen.queryByText(/Show \d+ more/i)).toBeNull();
  });
});

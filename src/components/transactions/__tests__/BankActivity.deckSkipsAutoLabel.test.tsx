// @vitest-environment jsdom
//
// dc34a4c7 — Tre, 2026-10-02: "it doesn't need to pop up with the like select category if they're
// gonna automatically be categorized." The deck opens itself and snapshots its cards, which can be
// before the merchant pass lands, so a charge the pass is about to label arrived as a card asking
// for a category. These assert the deck is never handed such a charge, and that a charge the user
// UNDID (which the pass leaves alone) is still his to decide.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  setCategory: vi.fn().mockResolvedValue(undefined),
  importToLedger: vi.fn(),
  updateLedgerTxn: vi.fn(),
  reviews: [] as Record<string, unknown>[],
  suggestions: {} as Record<string, unknown>,
  passWrites: [] as { chargeId: string; key: string; label: string; category: string; previousCategory: null }[],
  undone: new Set<string>(),
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

/** Outflow-positive, per Stage A's convention. Nothing in the app describes it. */
const CHARGE = {
  id: 'stx-1', user_id: 'u1', account_id: 'acc-1', amount: 42.5, date: '2026-08-18',
  pending: false, name: 'PUBLIX SUPER MARKET', merchant_name: 'PUBLIX', category: null,
};
const CHARGE2 = {
  id: 'stx-2', user_id: 'u1', account_id: 'acc-1', amount: 12, date: '2026-08-19',
  pending: false, name: 'CORNER CAFE', merchant_name: 'CORNER CAFE', category: null,
};

vi.mock('@/hooks/useSupabaseData', async () => {
  // The pure halves are the REAL ones: `planLedgerImport` IS the guard under test, and stubbing it
  // would leave this file agreeing with itself about nothing.
  const review = await import('@/lib/synced-transaction-review');
  const importer = await import('@/lib/synced-transaction-import');
  return {
    useAllSyncedTransactions: () => ({ data: [CHARGE, CHARGE2], isLoading: false }),
    useSyncedTransactionReviews: () => ({
      data: mocks.reviews,
      save: { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(undefined) },
      setCategory: { mutate: vi.fn(), mutateAsync: mocks.setCategory },
      remove: { mutate: vi.fn(), mutateAsync: vi.fn() },
      removeLink: { mutate: vi.fn() },
      importToLedger: { mutate: mocks.importToLedger, mutateAsync: vi.fn() },
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
      needsDecision: [CHARGE, CHARGE2],
      suggestions: mocks.suggestions,
      suggestedCount: Object.keys(mocks.suggestions).length,
    },
    reviewsByCharge: mocks.reviews.length ? { [CHARGE.id]: mocks.reviews } : {},
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useCrowdCategories', () => ({ useCrowdCategories: () => ({ crowd: {} }) }));
// These render BankActivity WITHOUT a QueryClientProvider, mocking each data hook instead, so a
// real react-query hook throws "No QueryClient set". Mocked in the same shape as its neighbours.
vi.mock('@/hooks/useAppliedActions', () => ({
  useAppliedActions: () => ({
    actions: [], latest: null, isLoading: false,
    record: { mutateAsync: vi.fn().mockResolvedValue(null) },
    markUndone: { mutateAsync: vi.fn().mockResolvedValue(undefined) },
    stepsOf: () => [],
    undoneChargeIds: mocks.undone,
    undoneUnknown: false,
  }),
}));
// The deck prints the ids of the cards it was handed, which is the thing under test.
vi.mock('../DecisionDeck', () => ({
  default: ({ cards }: { cards: { charge: { id: string } }[] }) => (
    <div data-testid="deck">{cards.map(c => c.charge.id).join(',')}</div>
  ),
}));
vi.mock('../MerchantMemoryPanel', () => ({ default: () => null }));
// BankActivity reads the merchant pass to keep auto-labelled charges out of the deck (dc34a4c7).
vi.mock('@/hooks/useMerchantMemory', () => ({
  useMerchantMemory: () => ({ pass: { writes: mocks.passWrites, byMerchant: [] }, isLoading: false, rules: {}, linkRules: {}, suppressed: {} }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import BankActivity from '../BankActivity';

const CAFE_WRITE = { chargeId: 'stx-2', key: 'CORNER CAFE', label: 'Corner Cafe', category: 'Dining', previousCategory: null };

beforeEach(() => {
  mocks.reviews = [];
  mocks.suggestions = {};
  mocks.passWrites = [];
  mocks.undone = new Set();
});
afterEach(cleanup);

describe('the deck leaves out what merchant memory is about to label', () => {
  it('hands the deck both charges when the pass has nothing for either (control)', () => {
    render(<BankActivity />);
    expect(screen.getByTestId('deck').textContent).toBe('stx-1,stx-2');
  });

  it('drops the charge the pass will label', () => {
    mocks.passWrites = [CAFE_WRITE];
    render(<BankActivity />);
    expect(screen.getByTestId('deck').textContent).toBe('stx-1');
  });

  it('keeps a charge the user undid, because the pass will not touch it', () => {
    mocks.passWrites = [CAFE_WRITE];
    mocks.undone = new Set(['stx-2']);
    render(<BankActivity />);
    expect(screen.getByTestId('deck').textContent).toBe('stx-1,stx-2');
  });
});

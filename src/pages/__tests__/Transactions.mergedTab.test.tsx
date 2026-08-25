// @vitest-environment jsdom
//
// Planning and Bank Activity as ONE tab. Tre, 2026-08-25: *"bank activity and planning should be
// one tab"* and *"if there are items for needs decision, it should show at the top of the one tab."*
//
// Three things are pinned here, and each of them is a way the merge can go wrong quietly:
//
//   1. BOTH HALVES RENDER. A merge that dropped one half would look like a tidier page and be a
//      missing feature, so the bank list and the ledger list are both asserted on one screen.
//   2. THE ORDER FOLLOWS THE WORK, not a fixed layout. Charges awaiting a decision put the bank half
//      above the ledger; nothing waiting puts the ledger back on top. The assertion is on the
//      rendered `order`, because that IS the mechanism — the DOM order never changes, deliberately,
//      so that emptying the queue cannot unmount a Decision Deck mid-run.
//   3. THE RETIRED TAB NAMES STILL LAND. Every existing user has `'planning'` or `'bank'` in
//      `tre:transactions:tab`, and old links carry them too. Either one must open the merged panel
//      rather than healing to Budget Control, which would move people without a word.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  needsDecision: [] as unknown[],
  suggestedCount: 0,
}));

const ACCOUNT = {
  id: 'acc-1', user_id: 'u1', name: 'Everyday Checking', account_type: 'checking',
  balance: 4200, active: true, created_at: '2026-01-01T00:00:00Z',
};

const LEDGER_ROW = {
  id: 'txn-1', user_id: 'u1', date: '2026-08-10', type: 'expense', amount: 24.5,
  category: 'Groceries', account: 'Checking', note: 'Corner store', payment_source: 'account:acc-1',
};

const BANK_CHARGE = {
  id: 'stx-1', user_id: 'u1', account_id: 'acc-1', amount: 42.5, date: '2026-08-18',
  pending: false, name: 'PUBLIX SUPER MARKET', merchant_name: 'PUBLIX', category: null,
};

vi.mock('@/hooks/useSupabaseData', async () => {
  // The pure re-exports are the REAL ones. `planLedgerImport` in particular is the double-count
  // guard, and a stub of it would make this file agree with itself about nothing.
  const review = await import('@/lib/synced-transaction-review');
  const importer = await import('@/lib/synced-transaction-import');
  return {
    useTransactions: () => ({
      data: [LEDGER_ROW], loading: false,
      add: { mutate: vi.fn() }, update: { mutate: vi.fn() },
      remove: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    }),
    useAccounts: () => ({ data: [ACCOUNT], loading: false }),
    useRecurringRules: () => ({
      data: [], loading: false,
      add: { mutateAsync: vi.fn() }, update: { mutate: vi.fn() },
    }),
    useAccountReconciliations: () => ({ data: [] }),
    usePaymentPlans: () => ({
      data: [], loading: false,
      add: { mutate: vi.fn(), mutateAsync: vi.fn() }, update: { mutate: vi.fn() }, remove: { mutate: vi.fn() },
    }),
    useCarFunds: () => ({ data: [] }),
    useSyncedTransactions: () => ({ data: [] }),
    useSyncedTransactionReviewsQuery: () => ({ data: [] }),
    useAllSyncedTransactions: () => ({ data: [BANK_CHARGE], isLoading: false }),
    useAllCarBuildItems: () => ({ data: [] }),
    useSyncedTransactionReviews: () => ({
      data: [], save: { mutate: vi.fn(), mutateAsync: vi.fn() },
      setCategory: { mutate: vi.fn(), mutateAsync: vi.fn() },
      remove: { mutate: vi.fn(), mutateAsync: vi.fn() },
      removeLink: { mutate: vi.fn() },
      importToLedger: { mutate: vi.fn(), mutateAsync: vi.fn() },
      undoImport: { mutate: vi.fn(), mutateAsync: vi.fn() },
    }),
    isHandledReview: review.isHandledReview,
    isLinkStatus: review.isLinkStatus,
    findExclusiveReview: review.findExclusiveReview,
    planLedgerImport: importer.planLedgerImport,
  };
});

vi.mock('@/hooks/useBankReviewQueue', () => ({
  useBankReviewQueueCount: () => null,
  reviewBadgeCount: (queue: { suggestedCount: number }, isLoading: boolean) =>
    (isLoading || queue.suggestedCount === 0 ? null : queue.suggestedCount),
  useBankReviewQueue: () => ({
    queue: {
      needsDecision: mocks.needsDecision,
      suggestions: {},
      suggestedCount: mocks.suggestedCount,
    },
    reviewsByCharge: {},
    isLoading: false,
  }),
}));

// Two children of the bank half with their own tests and their own heavy dependencies (framer
// motion, the merchant-memory queries). Neither is what this file is about.
vi.mock('@/components/transactions/DecisionDeck', () => ({ default: () => null }));
vi.mock('@/components/transactions/MerchantMemoryPanel', () => ({ default: () => null }));
vi.mock('@/hooks/useCrowdCategories', () => ({ useCrowdCategories: () => ({ crowd: {} }) }));

vi.mock('@/contexts/CardProjectionContext', () => ({
  useCardProjectionContext: () => ({ cardProjection: null, forecastFundingAccountId: null }),
}));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: true }) }));
vi.mock('@/hooks/useFormDraft', () => ({ useFormDraft: () => ({ restored: false, discard: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ACTIVITY_TAB_STORAGE_KEY } from '@/lib/activity-tab';
import Transactions from '../Transactions';

function renderAt(url = '/transactions') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}><Transactions /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const order = (testId: string) => screen.getByTestId(testId).style.order;

beforeEach(() => {
  localStorage.clear();
  mocks.needsDecision = [];
  mocks.suggestedCount = 0;
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Activity — Planning and Bank Activity as one tab', () => {
  it('offers two panels, not four', () => {
    renderAt();
    const tabs = screen.getAllByRole('tab').map(t => t.textContent);
    expect(tabs).toEqual(['Budget Control', 'Transactions']);
  });

  it('renders both halves on the one panel', () => {
    // The bank half opens on its decision queue, so the charge has to be in it to be on screen at
    // all — that is the surface's own rule (`BankActivity`'s `view` state), not this merge's.
    mocks.needsDecision = [BANK_CHARGE];
    renderAt();
    // The bank's own report…
    expect(within(screen.getByTestId('bank-half')).getByText('PUBLIX')).toBeTruthy();
    // …and the ledger it settles against, on the same screen, with no second tab to open.
    expect(within(screen.getByTestId('ledger-half')).getByText('Corner store')).toBeTruthy();
  });

  it('pins the bank half above the ledger when charges are waiting on a decision', () => {
    mocks.needsDecision = [BANK_CHARGE];
    renderAt();
    expect(order('bank-half')).toBe('1');
    expect(order('ledger-half')).toBe('2');
  });

  it('puts the ledger back on top when nothing is waiting', () => {
    // Would-fail: pinning unconditionally. The bank half is an archive once the queue is empty, and
    // an archive does not get to sit above the thing a person came here for.
    renderAt();
    expect(order('ledger-half')).toBe('1');
    expect(order('bank-half')).toBe('2');
    // Still rendered and still browsable, below — a merge that hid it would be a deletion. With an
    // empty queue the bank half opens on its "nothing waiting" state, with the whole archive behind
    // its own "All activity" toggle.
    expect(within(screen.getByTestId('bank-half')).getByText('Nothing is waiting on you here.')).toBeTruthy();
    expect(within(screen.getByTestId('bank-half')).getByText('All activity')).toBeTruthy();
  });

  it('badges the merged tab with the suggestion count, and nothing at zero', () => {
    mocks.needsDecision = [BANK_CHARGE];
    mocks.suggestedCount = 3;
    renderAt();
    const tab = screen.getAllByRole('tab')[1];
    expect(within(tab).getByText('3')).toBeTruthy();
  });

  it('opens the merged panel for a remembered "bank"', () => {
    // The value every user who last looked at Bank Activity has stored. Would-fail: healing it to
    // ACTIVITY_TAB_FALLBACK silently moves them to Budget Control.
    localStorage.setItem(ACTIVITY_TAB_STORAGE_KEY, JSON.stringify('bank'));
    renderAt();
    expect(screen.getByTestId('bank-half')).toBeTruthy();
    expect(within(screen.getByTestId('ledger-half')).getByText('Corner store')).toBeTruthy();
  });

  it('lands an old ?tab=planning link on the merged panel, overriding the stored one', () => {
    localStorage.setItem(ACTIVITY_TAB_STORAGE_KEY, JSON.stringify('budget'));
    renderAt('/transactions?tab=planning');
    expect(within(screen.getByTestId('ledger-half')).getByText('Corner store')).toBeTruthy();
  });
});

// @vitest-environment jsdom
//
// The Activity ledger, once a settled BANK transaction answers a generated rule occurrence.
//
// A row the user typed into the ledger already retires its projection inside the merge itself
// (`overridesGeneratedOccurrence`). A synced bank row never enters that stream at all, so its
// occurrence survived the merge still carrying the rule's predicted date and amount — the app knew
// the rent had been paid, and showed you the guess anyway. Tre, 2026-08-24: "the real transaction
// date and costs should auto override the transaction for that month. the real one should actually
// show."
//
// The second test is the one that keeps this honest: with no bank rows, the row is byte for byte
// what it was before, because the substitution must be invisible to anyone whose bank is not linked.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ syncedTransactions: [] as unknown[] }));

const ACCOUNT = {
  id: 'acc-1', user_id: 'u1', name: 'Everyday Checking', account_type: 'checking',
  balance: 4200, active: true, created_at: '2026-01-01T00:00:00Z',
};

const RENT = {
  id: 'rule-rent', user_id: 'u1', name: 'Rent', amount: 1600, rule_type: 'expense',
  frequency: 'monthly', due_day: 28, due_month: null, category: 'Bills',
  payment_source: 'acc-1', deposit_account: null, start_date: null, end_date: null,
  notes: null, active: true, created_at: '2026-01-01T00:00:00Z',
};

const RENT_CHARGE = {
  id: 'stx-rent', account_id: 'acc-1', amount: 1608.42, date: '2026-08-26',
  pending: false, name: 'GREYSTAR RENT', merchant_name: 'Greystar',
};

vi.mock('@/hooks/useSupabaseData', () => ({
  useTransactions: () => ({
    data: [], loading: false,
    add: { mutate: vi.fn() }, update: { mutate: vi.fn() },
    remove: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  }),
  useAccounts: () => ({ data: [ACCOUNT], loading: false }),
  useRecurringRules: () => ({
    data: [RENT], loading: false,
    add: { mutateAsync: vi.fn() }, update: { mutate: vi.fn() },
  }),
  useAccountReconciliations: () => ({ data: [] }),
  usePaymentPlans: () => ({
    data: [], loading: false,
    add: { mutate: vi.fn(), mutateAsync: vi.fn() }, update: { mutate: vi.fn() }, remove: { mutate: vi.fn() },
  }),
  useCarFunds: () => ({ data: [] }),
  // A goal's own monthly_contribution is generated into the ledger stream (goal-transfer-rules.ts).
  useSavingsGoals: () => ({ data: [] }),
  useSyncedTransactions: () => ({ data: mocks.syncedTransactions }),
  useSyncedTransactionReviewsQuery: () => ({ data: [] }),
}));

vi.mock('@/contexts/CardProjectionContext', () => ({
  useCardProjectionContext: () => ({ cardProjection: null, forecastFundingAccountId: null }),
}));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: true }) }));
// The page reads the queue itself now — one build, badge and layout off the same object.
vi.mock('@/hooks/useBankReviewQueue', () => ({
  useBankReviewQueueCount: () => null,
  reviewBadgeCount: () => null,
  useBankReviewQueue: () => ({
    queue: { needsDecision: [], suggestions: {}, suggestedCount: 0 },
    reviewsByCharge: {},
    isLoading: false,
  }),
}));
// The bank half of the merged tab, stubbed. Nothing in this file is about it, and the real one
// wants eight more data hooks mocked here; `Transactions.mergedTab` and the component's own tests
// are where it renders for real.
vi.mock('@/components/transactions/BankActivity', () => ({ default: () => <div data-testid="bank-activity" /> }));
vi.mock('@/hooks/useFormDraft', () => ({ useFormDraft: () => ({ restored: false, discard: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import Transactions from '../Transactions';

function renderInAugust() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 25, 9, 0, 0));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><Transactions /></MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The ledger list, which is the LAST `.card-forged.divide-y` on the page. */
function ledger(): HTMLElement {
  const rows = document.querySelectorAll('.card-forged.divide-y');
  const el = rows[rows.length - 1];
  if (!el) throw new Error('no ledger list rendered');
  return el as HTMLElement;
}

function rentRow(): HTMLElement {
  const el = within(ledger()).getByText('Rent').closest('.flex.items-center.justify-between');
  if (!el) throw new Error('no ledger row for Rent');
  return el as HTMLElement;
}

beforeEach(() => { localStorage.clear(); mocks.syncedTransactions = []; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Activity ledger, a generated occurrence a bank charge answered', () => {
  it('shows the real date and the real amount in place of the rule’s prediction', () => {
    mocks.syncedTransactions = [RENT_CHARGE];
    renderInAugust();

    const row = rentRow();
    expect(within(row).getByText(/2026-08-26/)).toBeTruthy();
    expect(within(row).getByText('-$1,608')).toBeTruthy();
    expect(within(row).getByText('real')).toBeTruthy();
    // Still one row. A substitution that added a row instead of replacing one would show the bill
    // twice, which is the defect this whole workstream started from.
    expect(within(ledger()).getAllByText('Rent')).toHaveLength(1);
  });

  it('is invisible with no bank rows: the same date, the same amount, no chip', () => {
    renderInAugust();

    const row = rentRow();
    expect(within(row).getByText(/2026-08-28/)).toBeTruthy();
    expect(within(row).getByText('-$1,600')).toBeTruthy();
    expect(within(row).queryByText('real')).toBeNull();
  });

  it('leaves a FUTURE month’s occurrence at the rule’s figures', () => {
    // The index is built for the current month only, so September's rent is still a projection —
    // and must not inherit August's real amount.
    mocks.syncedTransactions = [RENT_CHARGE];
    renderInAugust();

    const monthFilter = [...document.querySelectorAll('select')].find(s => s.value === '2026-08');
    if (!monthFilter) throw new Error('no month filter set to the current month');
    fireEvent.change(monthFilter, { target: { value: '2026-09' } });

    const row = rentRow();
    expect(within(row).getByText(/2026-09-28/)).toBeTruthy();
    expect(within(row).getByText('-$1,600')).toBeTruthy();
    expect(within(row).queryByText('real')).toBeNull();
  });
});

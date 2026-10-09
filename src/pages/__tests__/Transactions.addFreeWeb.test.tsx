// @vitest-environment jsdom
//
// The full Add Transaction button is FREE ON WEB and Premium in the native app (Tre, 2026-10-09, the
// same rule as quick add: `canAddTransactions`). Harness copied from Transactions.repeat.test.tsx.
//
// Would-fail checks: drop the web exemption and "a free web user gets the form" fails (the crowned
// /premium link comes back); apply it everywhere and "a free native user is sent to /premium" fails,
// which would change native pricing nobody approved. The upsell card follows the button both ways.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const gate = vi.hoisted(() => ({ isPremium: false, native: false }));

const mocks = vi.hoisted(() => ({
  addTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  addRule: vi.fn(),
  updateRule: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastInfo: vi.fn(),
}));

const account = {
  id: 'acc-1', user_id: 'u1', name: 'Everyday Checking', account_type: 'checking',
  balance: 4200, active: true, created_at: '2026-01-01T00:00:00Z',
};

const transaction = {
  id: 'txn-1', user_id: 'u1', date: '2026-08-10', type: 'expense', amount: 24.5,
  category: 'Groceries', account: 'Checking', note: 'Corner store', payment_source: 'account:acc-1',
};

// A rule that already repeats, so the ledger carries a GENERATED occurrence to click Edit on.
const rule = {
  id: 'rule-1', user_id: 'u1', name: 'Rent', amount: 1900, rule_type: 'expense',
  frequency: 'monthly', due_day: 1, due_month: null, category: 'Housing',
  payment_source: 'acc-1', deposit_account: null, start_date: null, end_date: null,
  notes: null, active: true, created_at: '2026-01-01T00:00:00Z',
};

// The page reads the Simple|Advanced switch from the profile; these tests pin Advanced (ask 5b166e10).
vi.mock('@/hooks/useViewMode', () => ({ useViewMode: () => ({ mode: 'advanced', setMode: () => {} }) }));
vi.mock('@/hooks/useSupabaseData', () => ({
  useTransactions: () => ({
    data: [transaction], loading: false,
    add: { mutate: mocks.addTransaction, isPending: false },
    update: { mutate: mocks.updateTransaction, isPending: false },
    remove: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  }),
  useAccounts: () => ({ data: [account], loading: false }),
  useRecurringRules: () => ({
    data: [rule], loading: false,
    add: { mutateAsync: mocks.addRule, isPending: false },
    update: { mutate: mocks.updateRule, isPending: false },
  }),
  useAccountReconciliations: () => ({ data: [] }),
  usePaymentPlans: () => ({
    data: [], loading: false,
    add: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    update: { mutate: vi.fn(), isPending: false },
    remove: { mutate: vi.fn(), isPending: false },
  }),
  useCarFunds: () => ({ data: [] }),
  // A goal's own monthly_contribution is generated into the ledger stream (goal-transfer-rules.ts).
  useSavingsGoals: () => ({ data: [] }),
  // `useMatchedOccurrences` reads these two: the month-scoped bank rows and the read-only view of
  // the reviews. Empty here, which is the no-bank-connection path — nothing in this file is about
  // matching, and an empty index leaves every ledger row exactly as it was.
  useSyncedTransactions: () => ({ data: [] }),
  useSyncedTransactionReviewsQuery: () => ({ data: [] }),
}));

vi.mock('@/contexts/CardProjectionContext', () => ({
  useCardProjectionContext: () => ({ cardProjection: null, forecastFundingAccountId: null }),
}));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: gate.isPremium }) }));
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
// The real one reaches for Capacitor Preferences; nothing here is about draft restoration.
vi.mock('@/hooks/useFormDraft', () => ({ useFormDraft: () => ({ restored: false, discard: vi.fn() }) }));
vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess, error: mocks.toastError,
    warning: mocks.toastWarning, info: mocks.toastInfo,
  },
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => gate.native } }));
// A plain input in place of the three-column scroll picker, so a test can state the exact date it
// means. The real one needs `Element.scrollTo` (absent in jsdom) and defaults to the day the suite
// happens to run on, which would make "is this a Friday" true only until next week.
vi.mock('@/components/shared/DateScrollPicker', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) =>
      createElement('input', {
        type: 'text',
        value,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
      }),
  };
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import Transactions from '../Transactions';

function Harness() {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><Transactions /></MemoryRouter>
    </QueryClientProvider>
  );
}


function addControl(): HTMLElement {
  const els = screen.getAllByText('Add Transaction', { exact: false })
    .map(e => e.closest('a, button') as HTMLElement | null)
    .filter((e): e is HTMLElement => !!e && !e.closest('.modal-overlay'));
  if (els.length !== 1) throw new Error(`expected one Add Transaction control, found ${els.length}`);
  return els[0];
}
const upsell = () => screen.queryByText('One-time transactions — Premium');

beforeEach(() => { gate.isPremium = false; gate.native = false; });
afterEach(() => cleanup());

describe('Add Transaction gate', () => {
  it('a free web user gets the form, with no upsell card', () => {
    render(<Harness />);
    const add = addControl();
    expect(add.tagName).toBe('BUTTON');
    expect(upsell()).toBeNull();
    fireEvent.click(add);
    expect(document.querySelector('.modal-overlay')).not.toBeNull();
  });

  it('a free native user is sent to /premium, with the upsell card', () => {
    gate.native = true;
    render(<Harness />);
    const add = addControl();
    expect(add.tagName).toBe('A');
    expect(add.getAttribute('href')).toBe('/premium');
    expect(upsell()).not.toBeNull();
  });

  it('a premium native user gets the form', () => {
    gate.native = true; gate.isPremium = true;
    render(<Harness />);
    expect(addControl().tagName).toBe('BUTTON');
    expect(upsell()).toBeNull();
  });
});

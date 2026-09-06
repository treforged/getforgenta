// @vitest-environment jsdom
//
// Ask 12: "also want to be able to schedule transactions by week". The Repeats select on the
// add-transaction dialog.
//
// The assertions that matter are the two halves of ONE decision: a repeat writes a rule and NOT a
// transaction, and no repeat writes a transaction exactly as it did before. A test that only
// checked the new path would pass just as happily on a build that wrote both rows, which is the
// specific way this feature can go wrong (the ledger would show the day twice and every total
// would count the money twice).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

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
// The real one reaches for Capacitor Preferences; nothing here is about draft restoration.
vi.mock('@/hooks/useFormDraft', () => ({ useFormDraft: () => ({ restored: false, discard: vi.fn() }) }));
vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess, error: mocks.toastError,
    warning: mocks.toastWarning, info: mocks.toastInfo,
  },
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
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

/** The open dialog. It is portalled to `document.body`, so it is not inside the page's tree. */
function dialog(): HTMLElement {
  const el = document.querySelector('.modal-overlay');
  if (!el) throw new Error('no dialog is open');
  return el as HTMLElement;
}

/** `FormModal` labels are not bound to their controls, so walk from the label to its own field. */
function control(labelText: string | RegExp): HTMLSelectElement | HTMLInputElement {
  const label = within(dialog()).getByText(labelText);
  const found = label.parentElement?.querySelector('select, input');
  if (!found) throw new Error(`no control under the label ${String(labelText)}`);
  return found as HTMLSelectElement | HTMLInputElement;
}

/** The ledger list, which is the LAST `.card-forged.divide-y` on the page. */
function ledger(): HTMLElement {
  const rows = document.querySelectorAll('.card-forged.divide-y');
  const el = rows[rows.length - 1];
  if (!el) throw new Error('no ledger list rendered');
  return el as HTMLElement;
}

/** The Edit button on the ledger row carrying `note`. */
function editButtonFor(note: string): HTMLElement {
  const row = within(ledger()).getByText(note).closest('.flex.items-center.justify-between');
  if (!row) throw new Error(`no ledger row for ${note}`);
  return within(row as HTMLElement).getByTitle('Edit');
}

function openAddDialog() {
  // The page header's own button, not the dialog's save button of the same name.
  fireEvent.click(screen.getByRole('button', { name: /Add Transaction/i }));
}

function save() {
  fireEvent.click(within(dialog()).getByRole('button', { name: /Add Transaction|Schedule Repeat|Update/i }));
}

// THE CLOCK IS FROZEN INSIDE THE MONTH THIS FILE'S FIXTURES LIVE IN.
//
// These rows are dated in August 2026 and the surfaces under test show the
// CURRENT month, so on 2026-09-01 three of these tests started failing without
// a line of source code changing. A test that passes in August and fails in
// September is not testing the code, it is testing the calendar.
//
// Frozen rather than made relative, because the literal dates carry meaning
// that a generated date would lose: the repeat control asserts that 2026-08-21
// is a Friday. `shouldAdvanceTime` keeps timers moving so React Testing Library
// still settles.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-08-20T12:00:00'));
  localStorage.clear();
  Object.values(mocks).forEach(m => m.mockReset());
  mocks.addRule.mockResolvedValue('rule-1');
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any);
});

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Transactions, the Repeats control', () => {
  it('offers None, Weekly, Every 2 Weeks and Monthly, defaulting to None', () => {
    render(<Harness />);
    openAddDialog();

    const repeat = control('Repeats') as HTMLSelectElement;
    expect([...repeat.options].map(o => o.textContent)).toEqual(['None', 'Weekly', 'Every 2 Weeks', 'Monthly']);
    expect(repeat.value).toBe('none');
  });

  it('is absent when the dialog is EDITING a saved transaction', () => {
    // (f). Converting an existing one-off into a rule is a different action and is out of scope,
    // so the edit dialog must look exactly as it did before this feature existed.
    render(<Harness />);
    fireEvent.click(editButtonFor('Corner store'));

    expect(within(dialog()).queryByText('Repeats')).toBeNull();
    expect(within(dialog()).getByText('Edit Transaction')).toBeTruthy();
  });

  it('is absent when overriding ONE occurrence of a rule that already repeats', () => {
    // That path saves with `editId` null, so it is add mode by every other measure, and a repeat
    // chosen there would stand a second rule beside the one being overridden and bill Rent twice
    // every month from then on.
    render(<Harness />);
    fireEvent.click(editButtonFor('Rent'));
    fireEvent.click(screen.getByText('Edit This Occurrence Only'));

    expect(within(dialog()).getByRole('heading', { name: 'Add Transaction' })).toBeTruthy();
    expect(within(dialog()).queryByText('Repeats')).toBeNull();
  });

  it('still offers Repeats on a DUPLICATE of a generated row, which is an ordinary new entry', () => {
    render(<Harness />);
    fireEvent.click(within(ledger()).getAllByTitle('Duplicate')[0]);

    expect(within(dialog()).getByText('Repeats')).toBeTruthy();
  });

  it('captions the schedule it is about to create, and says the row becomes a rule', () => {
    render(<Harness />);
    openAddDialog();

    fireEvent.change(control('Date'), { target: { value: '2026-08-21' } });
    fireEvent.change(control('Repeats'), { target: { value: 'weekly' } });

    // 2026-08-21 is a Friday.
    expect(within(dialog()).getByText(/Repeats every Friday from Aug 21, 2026/)).toBeTruthy();
    expect(within(dialog()).getByText(/not as a single row/)).toBeTruthy();
  });
});

describe('Transactions, saving', () => {
  it('with Repeats left at None, inserts a transaction exactly as before and no rule', () => {
    // (d). The pin on unchanged behaviour.
    render(<Harness />);
    openAddDialog();

    fireEvent.change(control('Date'), { target: { value: '2026-08-21' } });
    fireEvent.change(control('Amount'), { target: { value: '62.50' } });
    fireEvent.change(control(/^Note/), { target: { value: 'Weekly groceries' } });
    fireEvent.change(control('Payment Source'), { target: { value: 'account:acc-1' } });
    save();

    expect(mocks.addTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.addTransaction).toHaveBeenCalledWith({
      date: '2026-08-21', type: 'expense', amount: 62.5, category: 'Other',
      account: 'Checking', note: 'Weekly groceries', payment_source: 'account:acc-1',
    });
    expect(mocks.addRule).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Transaction added');
  });

  it('with Weekly, inserts the RULE and never the one-off row', async () => {
    render(<Harness />);
    openAddDialog();

    fireEvent.change(control('Date'), { target: { value: '2026-08-21' } });
    fireEvent.change(control('Repeats'), { target: { value: 'weekly' } });
    fireEvent.change(control('Amount'), { target: { value: '62.50' } });
    fireEvent.change(control(/^Note/), { target: { value: 'Weekly groceries' } });
    fireEvent.change(control('Payment Source'), { target: { value: 'account:acc-1' } });
    save();

    await waitFor(() => expect(mocks.addRule).toHaveBeenCalledTimes(1));
    expect(mocks.addRule).toHaveBeenCalledWith({
      name: 'Weekly groceries',
      amount: 62.5,
      rule_type: 'expense',
      frequency: 'weekly',
      due_day: 5,
      due_month: null,
      category: 'Other',
      payment_source: 'acc-1',
      deposit_account: null,
      start_date: '2026-08-21',
      end_date: null,
      notes: null,
      active: true,
      quiet: true,
    });
    // The whole point: no second row for the same day.
    expect(mocks.addTransaction).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.toastSuccess)
      .toHaveBeenCalledWith('Repeats weekly. Manage it under Budget Control.'));
  });

  it('with Every 2 Weeks, anchors the rule on the entered date', async () => {
    render(<Harness />);
    openAddDialog();

    fireEvent.change(control('Date'), { target: { value: '2026-08-21' } });
    fireEvent.change(control('Repeats'), { target: { value: 'biweekly' } });
    fireEvent.change(control('Amount'), { target: { value: '120' } });
    fireEvent.change(control(/^Note/), { target: { value: 'Fuel' } });
    save();

    await waitFor(() => expect(mocks.addRule).toHaveBeenCalledTimes(1));
    expect(mocks.addRule.mock.calls[0][0]).toMatchObject({
      frequency: 'biweekly', due_day: 5, start_date: '2026-08-21',
    });
    expect(mocks.addTransaction).not.toHaveBeenCalled();
  });

  it('refuses a repeat with no note, and writes nothing at all', () => {
    // (e). A rule is listed by name, so an unnamed one is a row the user cannot find again.
    render(<Harness />);
    openAddDialog();

    fireEvent.change(control('Repeats'), { target: { value: 'weekly' } });
    fireEvent.change(control('Amount'), { target: { value: '62.50' } });
    save();

    expect(mocks.toastError).toHaveBeenCalledWith(expect.stringMatching(/note is required/i));
    expect(mocks.addRule).not.toHaveBeenCalled();
    expect(mocks.addTransaction).not.toHaveBeenCalled();
    // Still open, so nothing the user typed is lost.
    expect(within(dialog()).getByText('Add Transaction')).toBeTruthy();
  });

  it('keeps the dialog open and writes no transaction when the rule insert fails', async () => {
    mocks.addRule.mockRejectedValueOnce(new Error('permission denied'));
    render(<Harness />);
    openAddDialog();

    fireEvent.change(control('Repeats'), { target: { value: 'monthly' } });
    fireEvent.change(control('Amount'), { target: { value: '18' } });
    fireEvent.change(control(/^Note/), { target: { value: 'Streaming' } });
    save();

    await waitFor(() => expect(mocks.addRule).toHaveBeenCalledTimes(1));
    // No success toast, no fallback row, and the form is still there to retry from.
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.addTransaction).not.toHaveBeenCalled();
    expect(document.querySelector('.modal-overlay')).toBeTruthy();
  });
});

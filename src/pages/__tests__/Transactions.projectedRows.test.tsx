// @vitest-environment jsdom
//
// A PROJECTION MUST BE UNMISTAKABLE AT A GLANCE, AND NEVER MERELY SUBTLER.
//
// Sam's call, 2026-09-05: a derived row shares the one chronological list with real transactions,
// so the thing that tells them apart carries the whole weight. It used to be a faint tint plus a
// Repeat glyph — both of which fail for a colourblind user and both of which vanish in bright sun
// on a phone. It says the WORD now.
//
// And the totals said nothing at all: "Total Cash Out" summed settled and projected money into one
// figure with no way to tell which half you were reading. The headline is deliberately NOT reduced
// — the month filter reaches future months where every row is projected, and subtracting there
// would print $0 for December, a confident zero of exactly the kind this is meant to prevent.
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

const mocks = vi.hoisted(() => ({
  syncedTransactions: [] as unknown[],
  realTransactions: [] as unknown[],
  savingsGoals: [] as unknown[],
}));

/** A row the user actually typed. Settled money: it must look exactly as it always has. */
const GROCERIES = {
  id: 'tx-groceries', user_id: 'u1', type: 'expense', amount: 240, category: 'Groceries',
  note: 'Groceries', date: '2026-08-12', payment_source: 'acc-1',
  created_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:00Z',
};

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
    data: mocks.realTransactions, loading: false,
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
  useSavingsGoals: () => ({ data: mocks.savingsGoals }),
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

beforeEach(() => { localStorage.clear(); mocks.syncedTransactions = []; mocks.savingsGoals = []; });
afterEach(() => { cleanup(); vi.useRealTimers(); });


function realRow(name: string): HTMLElement {
  const el = within(ledger()).getByText(name).closest('.flex.items-center.justify-between');
  if (!el) throw new Error(`no ledger row for ${name}`);
  return el as HTMLElement;
}

describe('a projected row says so in words', () => {
  it('labels the rule-generated row "Projected", not only a tint and an icon', () => {
    mocks.realTransactions = [GROCERIES];
    renderInAugust();
    expect(within(rentRow()).getByText('Projected')).toBeTruthy();
  });

  it('leaves a REAL transaction completely alone — the new state is additive', () => {
    mocks.realTransactions = [GROCERIES];
    renderInAugust();
    const row = realRow('Groceries');
    expect(within(row).queryByText('Projected')).toBeNull();
    expect(within(row).getByText('-$240')).toBeTruthy();
  });

  it('drops the label once a real bank charge has answered it — that money is settled', () => {
    mocks.realTransactions = [GROCERIES];
    mocks.syncedTransactions = [RENT_CHARGE];
    renderInAugust();
    const row = rentRow();
    expect(within(row).getByText('real')).toBeTruthy();
    expect(within(row).queryByText('Projected')).toBeNull();
  });
});

describe('the totals stop mixing settled and projected money silently', () => {
  it('names the projected share beneath Total Cash Out', () => {
    mocks.realTransactions = [GROCERIES];
    renderInAugust();
    // $240 typed + $1,600 projected rent = $1,840 out, of which $1,600 is not spent yet.
    const tile = document.body.textContent ?? '';
    expect(tile).toContain('of which $1,600 projected');
  });

  it('says nothing when every row is settled — no "of which $0 projected"', () => {
    mocks.realTransactions = [GROCERIES];
    mocks.syncedTransactions = [RENT_CHARGE];
    renderInAugust();
    // The rent is answered by a real charge, so nothing on screen is projected any more.
    expect(document.body.textContent ?? '').not.toContain('projected');
  });
});

// ── THE GOAL CONTRIBUTION REACHES THE LEDGER ────────────────────────────────────────────────────
//
// Tre: transfer RULES and anything generated from a GOAL must show in Transactions. Transfer rules
// already did. A savings goal's `monthly_contribution` is not a `recurring_rules` row at all, so
// nothing generated it here — Budget Control listed it, the forecast moved the cash out of checking
// every month, and this page, the one that claims to show what will happen, said nothing.
//
// This test presses on the PAGE rather than the lib, because the lib was never the gap: the wiring
// was. Drop `goalTransferRules` from the merge call in Transactions.tsx and this goes red, which is
// the only thing that proves the row is actually reaching a person.

const MOVE_FUND_GOAL = {
  id: 'goal-move', user_id: 'u1', name: 'Move Fund', target_amount: 6000, current_amount: 500,
  monthly_contribution: 200, contribution_start_date: '2026-01-12', linked_account: 'acc-1',
  linked_rule_id: null, linked_rule_ids: [] as string[], lump_sum_payments: [],
};

describe('a savings goal contribution shows in the ledger', () => {
  it('renders the goal contribution as a projected row', () => {
    mocks.realTransactions = [GROCERIES];
    mocks.savingsGoals = [MOVE_FUND_GOAL];
    renderInAugust();
    const row = realRow('Move Fund Contribution');
    expect(within(row).getByText('Projected')).toBeTruthy();
  });

  // The double-count guard, pressed on the page. A goal funded by a real recurring rule is already
  // on screen as that rule; a second row would show the same money leaving twice.
  it('does NOT render a second row when a real rule already funds the goal', () => {
    mocks.realTransactions = [GROCERIES];
    mocks.savingsGoals = [{ ...MOVE_FUND_GOAL, linked_rule_ids: ['rule-rent'] }];
    renderInAugust();
    expect(within(ledger()).queryByText('Move Fund Contribution')).toBeNull();
  });
});

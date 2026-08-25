// @vitest-environment jsdom
//
// Picking a category on a bank charge is also "put this in my ledger". Tre, 2026-08-25: *"when
// categories for transactions are selected, those should auto add to ledger."*
//
// What "adding to the ledger" concretely is in this codebase: the row `planLedgerImport` builds,
// inserted into `public.transactions` by `importToLedger`, which also stamps the charge's review
// `'imported'` so it can never be imported twice and can be undone by deleting the entry. This file
// asserts the category select goes through THAT path and no other — a second, parallel way to write
// money is precisely the failure §1B is arranged to prevent.
//
// The second test is the one that keeps it honest. A charge the app already tracks must still only
// be LABELLED, because `recurring_rules` already projects that bill and importing it would count the
// money twice across twelve surfaces.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  setCategory: vi.fn().mockResolvedValue(undefined),
  importToLedger: vi.fn(),
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

/** Outflow-positive, per Stage A's convention. Nothing in the app describes it. */
const CHARGE = {
  id: 'stx-1', user_id: 'u1', account_id: 'acc-1', amount: 42.5, date: '2026-08-18',
  pending: false, name: 'PUBLIX SUPER MARKET', merchant_name: 'PUBLIX', category: null,
};

vi.mock('@/hooks/useSupabaseData', async () => {
  // The pure halves are the REAL ones: `planLedgerImport` IS the guard under test, and stubbing it
  // would leave this file agreeing with itself about nothing.
  const review = await import('@/lib/synced-transaction-review');
  const importer = await import('@/lib/synced-transaction-import');
  return {
    useAllSyncedTransactions: () => ({ data: [CHARGE], isLoading: false }),
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
      needsDecision: [CHARGE],
      suggestions: mocks.suggestions,
      suggestedCount: Object.keys(mocks.suggestions).length,
    },
    reviewsByCharge: mocks.reviews.length ? { [CHARGE.id]: mocks.reviews } : {},
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useCrowdCategories', () => ({ useCrowdCategories: () => ({ crowd: {} }) }));
vi.mock('../DecisionDeck', () => ({ default: () => null }));
vi.mock('../MerchantMemoryPanel', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));

import BankActivity from '../BankActivity';

const pick = (category: string) =>
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: category } });

beforeEach(() => {
  mocks.reviews = [];
  mocks.suggestions = {};
  mocks.setCategory.mockClear().mockResolvedValue(undefined);
  mocks.importToLedger.mockClear();
  mocks.updateLedgerTxn.mockClear();
});
afterEach(cleanup);

describe('Bank Activity — choosing a category records the charge', () => {
  it('labels the charge and then adds it to the ledger, in that order', async () => {
    render(<BankActivity />);
    pick('Groceries');

    await waitFor(() => expect(mocks.importToLedger).toHaveBeenCalledTimes(1));
    expect(mocks.setCategory).toHaveBeenCalledWith({
      // `normalizeMerchant`'s key, carried through so the same act also casts the crowd vote.
      syncedTransactionId: 'stx-1', category: 'Groceries', merchantKey: 'PUBLIX',
    });
    // The row is `planLedgerImport`'s, carrying the category the user just picked — not the
    // provider's guess, and not a row this component built itself.
    expect(mocks.importToLedger).toHaveBeenCalledWith({
      syncedTransactionId: 'stx-1',
      draft: {
        date: '2026-08-18',
        type: 'expense',
        amount: 42.5,
        category: 'Groceries',
        account: 'Everyday Checking',
        note: 'PUBLIX',
        payment_source: 'account:acc-1',
        origin: 'synced',
      },
    });
  });

  it('says so on the row before the select is touched', () => {
    // A dropdown that quietly creates a transaction is a surprise this app does not get to spring.
    render(<BankActivity />);
    expect(screen.getByText('picking a category also adds this to your ledger')).toBeTruthy();
  });

  it('only labels a charge the app already tracks — no ledger row', async () => {
    // THE DOUBLE-COUNT GUARD. `recurring_rules` already projects this rent, so a ledger row for the
    // same dollars would move every projected number by 1,600 twice.
    mocks.suggestions = { [CHARGE.id]: { rule: RULE } };
    render(<BankActivity />);
    pick('Bills');

    await waitFor(() => expect(mocks.setCategory).toHaveBeenCalledTimes(1));
    expect(mocks.importToLedger).not.toHaveBeenCalled();
    expect(screen.queryByText('picking a category also adds this to your ledger')).toBeNull();
  });

  it('relabels the entry a charge already created rather than importing it twice', async () => {
    mocks.reviews = [{
      id: 'rev-1', user_id: 'u1', synced_transaction_id: CHARGE.id, status: 'imported',
      transaction_id: 'txn-9', rule_id: null, payment_plan_id: null, car_fund_id: null,
      car_charge_kind: null, occurrence_month: null, occurrence_date: null,
      category_override: 'Shopping', created_at: '', updated_at: '',
    }];
    render(<BankActivity />);
    pick('Groceries');

    await waitFor(() => expect(mocks.updateLedgerTxn).toHaveBeenCalledWith({ id: 'txn-9', category: 'Groceries' }));
    // Would-fail: leaving the ledger row alone. The entry would keep feeding the old category's
    // totals while the bank row showed the new label, with nothing on screen saying they disagree.
    expect(mocks.importToLedger).not.toHaveBeenCalled();
  });

  it('does not import on the strength of a label that never landed', async () => {
    mocks.setCategory.mockRejectedValue(new Error('offline'));
    render(<BankActivity />);
    pick('Groceries');

    await waitFor(() => expect(mocks.setCategory).toHaveBeenCalledTimes(1));
    expect(mocks.importToLedger).not.toHaveBeenCalled();
  });
});

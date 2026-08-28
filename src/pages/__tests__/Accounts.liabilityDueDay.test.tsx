// @vitest-environment jsdom
//
// A due day on a NON-CARD liability. `accounts.payment_due_day` was offered by this form for
// credit cards only, and — the half that actually mattered — written by `handleSave` for credit
// cards only. So a student loan or a mortgage could never carry one, `listDebtServiceLiabilities`
// returned `dueDay: null` for every user, and "Recommended This Month" correctly refused to invent
// a date it had no source for.
//
// Both halves are asserted here, because either one alone is the silent failure: a field that
// renders and never reaches the column looks exactly like a save that worked.
//
// Would-fail check: put `form.account_type === 'credit_card'` back on the field and case 1 finds no
// input; put it back on the payload spread and case 2 saves `payment_due_day: undefined` while the
// field still sits there taking the user's number.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const mocks = vi.hoisted(() => ({
  addAccount: vi.fn(),
  updateAccount: vi.fn(),
}));

const account = (over: Record<string, unknown>) => ({
  user_id: 'u1', balance: 1000, active: true, created_at: '2026-01-01T00:00:00Z',
  payment_due_day: null, ...over,
});

const ACCOUNTS = [
  account({ id: 'sl', name: 'Student Loan', account_type: 'student_loan', balance: 12000, payment_due_day: 20 }),
  account({ id: 'cc', name: 'Discover', account_type: 'credit_card', balance: 4000, payment_due_day: 12 }),
];

vi.mock('@/hooks/useSupabaseData', () => ({
  useAccounts: () => ({
    data: ACCOUNTS, loading: false,
    // The create path went async so it can seat a new credit card in the surplus ranking with the
    // id the insert returns — see `rankNewCard`. Both entry points land on the same spy.
    add: {
      mutate: mocks.addAccount, isPending: false,
      mutateAsync: (item: unknown) => { mocks.addAccount(item); return Promise.resolve({ id: 'new-account' }); },
    },
    update: { mutate: mocks.updateAccount, isPending: false },
    remove: { mutate: vi.fn(), isPending: false },
    reorder: { mutate: vi.fn(), isPending: false },
  }),
  useDebts: () => ({
    data: [], loading: false,
    add: { mutate: vi.fn(), isPending: false },
    update: { mutate: vi.fn(), isPending: false },
  }),
  useAccountReconciliations: () => ({ data: [], add: { mutate: vi.fn(), isPending: false } }),
}));

vi.mock('@/hooks/usePlaidItems', () => ({
  usePlaidItems: () => ({
    items: [], loading: false, remove: { mutate: vi.fn(), isPending: false }, invalidate: vi.fn(),
  }),
}));

// The page mounts this ONLY to seat a newly-created credit card at its own rank. Mocked whole
// rather than fed data: the real hook pulls goals, car funds, the profile and the rules, none of
// which this file is about, and its writes are covered by `surplus-ranking.newCard.test.ts`.
vi.mock('@/hooks/useSurplusRanking', () => ({ useSurplusRanking: () => ({ rankNewCard: vi.fn() }) }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: true }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/components/shared/PlaidLinkButton', () => ({ default: () => null }));
vi.mock('@/components/shared/AkoyaConnectButton', () => ({ default: () => null }));
vi.mock('@/components/shared/AkoyaFallbackPrompt', () => ({ default: () => null }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
// jsdom has no matchMedia, and the real hook reads it through useSyncExternalStore.
vi.mock('@/hooks/use-mobile', () => ({ useIsTouch: () => false, useIsViewportBelow: () => false }));

import Accounts from '../Accounts';

/** FormModal's labels are not `htmlFor`-bound, so the input is found through its own row. */
function fieldInput(label: string): HTMLInputElement | null {
  const el = [...document.querySelectorAll('label')].find(l => l.textContent === label);
  return el?.parentElement?.querySelector('input') ?? null;
}

/** The modal's own save button — the page's "Add Account" trigger carries the same words. */
function clickSave() {
  const modal = document.querySelector('.modal-overlay')!;
  const save = [...modal.querySelectorAll('button')].find(b => b.textContent === 'Add Account')!;
  fireEvent.click(save);
}

/** Open the add-account form and pick a type. */
function openAddForm(accountType: string) {
  render(<MemoryRouter><Accounts /></MemoryRouter>);
  fireEvent.click(screen.getByText('Add Account'));
  const typeSelect = [...document.querySelectorAll('select')]
    .find(s => [...s.options].some(o => o.value === accountType))!;
  fireEvent.change(typeSelect, { target: { value: accountType } });
}

beforeEach(() => {
  mocks.addAccount.mockClear();
  mocks.updateAccount.mockClear();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('Accounts — payment_due_day is not card-only', () => {
  it('offers the due-day field on a student loan', () => {
    openAddForm('student_loan');
    expect(fieldInput('Payment Due Day (1–28)')).not.toBeNull();
    // Card-only fields stay card-only.
    expect(fieldInput('Credit Limit')).toBeNull();
    expect(fieldInput('Start Date (future cards)')).toBeNull();
  });

  it('writes the due day to the column when a student loan is saved', () => {
    openAddForm('student_loan');
    fireEvent.change(fieldInput('Account Name')!, { target: { value: 'Nelnet' } });
    fireEvent.change(fieldInput('Current Balance')!, { target: { value: '12000' } });
    fireEvent.change(fieldInput('Payment Due Day (1–28)')!, { target: { value: '20' } });
    clickSave();
    expect(mocks.addAccount).toHaveBeenCalledTimes(1);
    expect(mocks.addAccount.mock.calls[0][0]).toMatchObject({
      account_type: 'student_loan', payment_due_day: 20,
    });
  });

  it('leaves an asset account out of it entirely', () => {
    openAddForm('checking');
    expect(fieldInput('Payment Due Day (1–28)')).toBeNull();
    fireEvent.change(fieldInput('Account Name')!, { target: { value: 'Everyday' } });
    fireEvent.change(fieldInput('Current Balance')!, { target: { value: '100' } });
    clickSave();
    // Not `payment_due_day: null` — a checking row has no due day, and writing one would be a
    // claim about a concept that does not apply to it.
    expect(mocks.addAccount.mock.calls[0][0]).not.toHaveProperty('payment_due_day');
  });

  it('shows a saved due day on the liability row, not only on the card', () => {
    render(<MemoryRouter><Accounts /></MemoryRouter>);
    // A number the user typed that the row it was typed on refuses to print reads as a save that
    // did not happen, so the student loan's day has to appear beside the card's.
    expect(screen.getByText(/Due 20th/)).toBeTruthy();
    expect(screen.getByText(/Due 12th/)).toBeTruthy();
  });
});

// @vitest-environment jsdom
//
// Since d15b7ab9 the "mortgage, student loan and other debt payments are taken out of your cash
// before any credit card payoff" explainer describes ALL THREE non-CC debt tabs (mortgage, student
// loans, other debts), not just mortgage where it used to live. This pins that it now renders on
// all three, from one shared element, and stays off the two credit-card-related tabs.
//
// ⚠️ THE FIXTURE GAINED REAL DEBTS ON 2026-09-17, AND THAT IS A CORRECTION RATHER THAN A
// CONVENIENCE. It used to mock `useDebts`/`useAccounts` as EMPTY and then click through to
// Mortgage, Student Loans and Other Debts - tabs that, with no debt of that kind, no user could
// ever have been looking at. When the tab bar started hiding a debt type nobody has, these four
// cases went red, and the tempting "fix" was to make the tabs render unconditionally again.
// That would have been weakening the app to suit the harness. The explainer on the Mortgage tab
// is only ever READ by somebody who has a mortgage, so the fixture now has one, and the
// assertions below are unchanged.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@/hooks/useSupabaseData', () => ({
  // One debt of each non-CC kind, so all three of those tabs are reachable. `mortgageDebts` and
  // `studentDebts` are matched BY NAME against accounts of that type (see DebtPayoff.tsx), and
  // `otherDebts` is whatever matches none of the three name sets - so "Personal Loan" needs no
  // account row at all, and giving it one would move it out of the tab it is here to test.
  useDebts: () => ({
    data: [
      { id: 'm1', name: 'Home Mortgage', balance: 250000, apr: 6.5, min_payment: 1800 },
      { id: 's1', name: 'Nelnet', balance: 12000, apr: 5.5, min_payment: 150 },
      { id: 'o1', name: 'Personal Loan', balance: 3000, apr: 9, min_payment: 90 },
    ],
    update: { mutate: vi.fn() }, remove: { mutate: vi.fn() }, loading: false,
  }),
  useAccountReconciliations: () => ({ add: { mutate: vi.fn() } }),
  useAccounts: () => ({
    data: [
      { id: 'am', name: 'Home Mortgage', account_type: 'mortgage', balance: 250000, active: true },
      { id: 'as', name: 'Nelnet', account_type: 'student_loan', balance: 12000, active: true },
    ],
    loading: false,
  }),
  useTransactions: () => ({ data: [] }),
  useRecurringRules: () => ({ data: [] }),
  useProfile: () => ({ data: { weekly_gross_income: 0, tax_rate: 0 }, loading: false }),
  useSavingsGoals: () => ({ data: [] }),
  // An active car loan, so the Auto Loans tab is reachable for the case that asserts the
  // explainer stays OFF it - an absent tab would pass that assertion for the wrong reason.
  useCarFunds: () => ({
    // ⚠️ THE FIELDS ARE THE ONES `getActiveCarLoanPayments` ACTUALLY READS, taken from that
    // function rather than guessed: it skips any fund whose `phase` is not 'loan' or that has no
    // `loan_start_date` AND `payment_start_date`, and it skips one whose payment start is in the
    // future. A fund missing any of those is silently not an active loan, and the tab would be
    // absent for a reason that has nothing to do with what this file tests.
    data: [{
      id: 'cf1', name: 'Car', phase: 'loan',
      target_amount: 5000, current_amount: 5000,
      loan_amount: 20000, expected_apr: 6, loan_term_months: 60,
      loan_start_date: '2026-01-01', payment_start_date: '2026-01-01',
    }],
    add: { mutate: vi.fn() }, update: { mutate: vi.fn() }, remove: { mutate: vi.fn() }, loading: false,
  }),
  usePaymentPlans: () => ({ data: [], loading: false }),
  // Reached through `useMatchedOccurrences`, which the vehicle-money panel on the Auto Loans tab
  // pulls in since that panel moved off the Garage (2026-08-27).
  useSyncedTransactions: () => ({ data: [] }),
  useSyncedTransactionReviewsQuery: () => ({ data: [] }),
}));

vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/contexts/CardProjectionContext', () => ({
  // No provider in this test, so the display surfaces fall back to the unresolved funding id.
  useOptionalCardProjectionContext: () => null,
  useCardProjectionContext: () => ({
    cardProjection: null, assumptions: {}, pauseSavings: false, setPauseSavings: vi.fn(),
    // The "with extra payments" readouts read these maps (and buildAutoExtraByTarget over the
    // rows) off the engine result; empty means nothing received extras, so only the scheduled
    // lines render.
    projections: { data: [], nonCCLiabilityBalancesById: new Map(), carLoanBalancesByFundId: new Map() },
  }),
}));
vi.mock('@/hooks/useFormDraft', () => ({ useFormDraft: () => ({ restored: false, discard: vi.fn() }) }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import DebtPayoff from '../DebtPayoff';

const EXPLAINER = /taken out of your cash before any credit card payoff/;

function renderPage() {
  // The default tab is Credit Card Payoff, which mounts CreditCardEngine inside an
  // ErrorBoundary that reads a QueryClient — needed even for tests that immediately switch away.
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><DebtPayoff /></MemoryRouter>
    </QueryClientProvider>,
  );
}

function openTab(name: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); });

describe('Debt Payoff, the non-CC debt explainer box', () => {
  it('is absent on Credit Card Payoff, the default tab', () => {
    renderPage();
    expect(screen.queryByText(EXPLAINER)).toBeNull();
  });

  it('is absent on Auto Loans', () => {
    renderPage();
    openTab('Auto Loans');
    expect(screen.queryByText(EXPLAINER)).toBeNull();
  });

  it('renders on Mortgage', () => {
    renderPage();
    openTab('Mortgage');
    expect(screen.getByText(EXPLAINER)).toBeTruthy();
  });

  it('renders on Student Loans', () => {
    renderPage();
    openTab('Student Loans');
    expect(screen.getByText(EXPLAINER)).toBeTruthy();
  });

  it('renders on Other Debts', () => {
    renderPage();
    openTab('Other Debts');
    expect(screen.getByText(EXPLAINER)).toBeTruthy();
  });
});

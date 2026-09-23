// @vitest-environment jsdom
//
// A DEBT TAB YOU DO NOT HAVE IS NOT SHOWN.
//
// Tre, on the Accounts tab: "there's a lot of information there which could be cleaned up and it
// just seems like a overwhelming amount that the user really doesn't need to see upfront" - and
// "same thing on some of the other pages like that tab". This page is that sweep's second find.
//
// ⚠️ MEASURED ACROSS ALL 33 USERS BEFORE THE CHANGE, because the two candidates before this one in
// the same sweep both turned out to be the wrong fix:
//     mortgage 0 users . other liability 0 users . student loan 1 . car fund 2 . credit card 6
// So Mortgage and Other Debts were rendered for EVERY user and empty for EVERY user, and Student
// Loans was empty for 32 of 33 - five tabs on a money page, four of them dead for almost everyone.
//
// ⚠️ THE ONE THING THAT WOULD HAVE MADE THIS A REGRESSION, CHECKED RATHER THAN ASSUMED: the page's
// "Add Account" link derives its `type` from the ACTIVE TAB, so at first reading the Mortgage tab
// looked like the only route to adding a mortgage - and hiding it would have deleted the feature,
// which is the "an offer destroyed by the very action the user must take" shape. It is not the
// only route: `ACCOUNT_TYPES` in Accounts.tsx offers all four liability types in its own selector.
//
// WHAT THIS ASSERTS:
//   1. POSITIVE CONTROL - with every debt type present, all five tabs render. Without this, "no
//      Mortgage tab" and "the page failed to render" are the same observation.
//   2. With ONLY credit cards, the four empty tabs are gone and Credit Card Payoff remains.
//   3. AN EMPTY TAB THAT IS ACTIVE IS STILL SHOWN. A persisted tab or a deep link must never leave
//      the user looking at a panel whose tab has vanished from the row above it.
//   4. `always` is pinned by the one case where it is the ONLY thing holding the Credit Card tab:
//      empty AND not active.
//
// WOULD-FAIL, and every one of the three filter terms was PROVEN load-bearing by mutation rather
// than asserted here in prose:
//   - dropping `activeTab === t.id` kills "an empty tab that is active is still shown"
//   - dropping `t.count > 0`        kills the positive control (only 'cards' would ever render)
//   - dropping `t.always`           kills "PINS `always`"
// ⚠️ THAT LAST ONE SURVIVED THE FIRST MUTATION RUN. The original case 3 was "a brand-new user
// still gets the Credit Card tab", which the DEFAULT activeTab of 'cards' satisfies on its own -
// so `always` could be deleted with the whole file green. The extra case exists because of that,
// and it is the reason to mutate every term rather than trust a suite that looks symmetrical.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ debts: [] as unknown[], accounts: [] as unknown[], carFunds: [] as unknown[] }));

vi.mock('@/hooks/useSupabaseData', () => ({
  useDebts: () => ({ data: mocks.debts, update: { mutate: vi.fn() }, remove: { mutate: vi.fn() }, loading: false }),
  useAccountReconciliations: () => ({ add: { mutate: vi.fn() } }),
  useAccounts: () => ({ data: mocks.accounts, loading: false }),
  useTransactions: () => ({ data: [] }),
  useRecurringRules: () => ({ data: [] }),
  useProfile: () => ({ data: { weekly_gross_income: 0, tax_rate: 0 }, loading: false }),
  useSavingsGoals: () => ({ data: [] }),
  useCarFunds: () => ({ data: mocks.carFunds, add: { mutate: vi.fn() }, update: { mutate: vi.fn() }, remove: { mutate: vi.fn() }, loading: false }),
  usePaymentPlans: () => ({ data: [], loading: false }),
  useSyncedTransactions: () => ({ data: [] }),
  useSyncedTransactionReviewsQuery: () => ({ data: [] }),
}));

vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/contexts/CardProjectionContext', () => ({
  // No provider in this test, so the display surfaces fall back to the unresolved funding id.
  useOptionalCardProjectionContext: () => null,
  useCardProjectionContext: () => ({
    cardProjection: null, assumptions: {}, pauseSavings: false, setPauseSavings: vi.fn(),
    projections: { data: [], nonCCLiabilityBalancesById: new Map(), carLoanBalancesByFundId: new Map() },
  }),
}));
vi.mock('@/hooks/useFormDraft', () => ({ useFormDraft: () => ({ restored: false, discard: vi.fn() }) }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import DebtPayoff from '../DebtPayoff';

// The fields are the ones `getActiveCarLoanPayments` actually reads - phase 'loan', both dates,
// and a payment start that is not in the future. Taken from that function, not guessed.
const CAR_FUND = {
  id: 'cf1', name: 'Car', phase: 'loan', target_amount: 5000, current_amount: 5000,
  loan_amount: 20000, expected_apr: 6, loan_term_months: 60,
  loan_start_date: '2026-01-01', payment_start_date: '2026-01-01',
};
const CARD_ACCOUNT = { id: 'ac', name: 'Discover', account_type: 'credit_card', balance: 4000, active: true };

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><DebtPayoff /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const tab = (name: RegExp) => screen.queryByRole('button', { name });

beforeEach(() => {
  localStorage.clear();
  mocks.debts = [];
  mocks.accounts = [];
  mocks.carFunds = [];
});
afterEach(() => { cleanup(); });

describe('Debt Payoff - a debt type nobody has gets no tab', () => {
  it('POSITIVE CONTROL: with every debt type present, all five tabs render', () => {
    mocks.accounts = [
      CARD_ACCOUNT,
      { id: 'am', name: 'Home Mortgage', account_type: 'mortgage', balance: 250000, active: true },
      { id: 'as', name: 'Nelnet', account_type: 'student_loan', balance: 12000, active: true },
    ];
    mocks.debts = [
      { id: 'm1', name: 'Home Mortgage', balance: 250000, apr: 6.5, min_payment: 1800 },
      { id: 's1', name: 'Nelnet', balance: 12000, apr: 5.5, min_payment: 150 },
      { id: 'o1', name: 'Personal Loan', balance: 3000, apr: 9, min_payment: 90 },
    ];
    mocks.carFunds = [CAR_FUND];
    renderPage();
    expect(tab(/Credit Card Payoff/)).not.toBeNull();
    expect(tab(/Auto Loans/)).not.toBeNull();
    expect(tab(/Mortgage/)).not.toBeNull();
    expect(tab(/Student Loans/)).not.toBeNull();
    expect(tab(/Other Debts/)).not.toBeNull();
  });

  it('with ONLY credit cards, the four empty tabs are gone and Credit Card Payoff stays', () => {
    mocks.accounts = [CARD_ACCOUNT];
    renderPage();
    expect(tab(/Credit Card Payoff/)).not.toBeNull();
    expect(tab(/Auto Loans/)).toBeNull();
    expect(tab(/Mortgage/)).toBeNull();
    expect(tab(/Student Loans/)).toBeNull();
    expect(tab(/Other Debts/)).toBeNull();
  });

  it('a brand-new user with no debt at all still gets the Credit Card tab', () => {
    // Its own empty state is a real first-run screen; the page would otherwise have no tab row
    // and no panel, which is worse than one honest empty tab.
    //
    // ⚠️ THIS CASE ALONE DOES NOT PIN `always`, AND A MUTATION RUN IS WHAT SHOWED THAT. Deleting
    // the `t.always` term left all four cases green, because the DEFAULT active tab is 'cards', so
    // the `activeTab === t.id` term was quietly covering this. The case below is the one that
    // actually pins it. Recorded rather than silently fixed: an assertion that survives a mutation
    // which should kill it is measuring something other than what its name says.
    renderPage();
    expect(tab(/Credit Card Payoff/)).not.toBeNull();
  });

  it('PINS `always`: the Credit Card tab survives even when it is empty AND not the active tab', () => {
    // The user is on Auto Loans because they have a car loan, and has no cards. Here the
    // active-tab term cannot help the Credit Card tab and `count > 0` is false, so `always` is
    // the only thing keeping the page's primary tab on screen. Without it, a user with only a
    // car loan could never get back to Credit Card Payoff from this page at all.
    localStorage.setItem('tre:debtpayoff:activeTab', JSON.stringify('auto'));
    mocks.carFunds = [CAR_FUND];
    renderPage();
    expect(tab(/Auto Loans/)).not.toBeNull();
    expect(tab(/Credit Card Payoff/)).not.toBeNull();
  });

  it('AN EMPTY TAB THAT IS ACTIVE IS STILL SHOWN, so a persisted tab cannot strand the user', () => {
    // The user last looked at Mortgage and has since deleted it - or followed a link. Without
    // this the panel below would render with no tab above it selected, and the row would
    // disagree with the content. This is the case a naive "hide if empty" gets wrong.
    localStorage.setItem('tre:debtpayoff:activeTab', JSON.stringify('mortgage'));
    mocks.accounts = [CARD_ACCOUNT];
    renderPage();
    expect(tab(/Mortgage/)).not.toBeNull();
    // ...and the ones that are neither active nor populated are still gone.
    expect(tab(/Student Loans/)).toBeNull();
    expect(tab(/Other Debts/)).toBeNull();
  });
});

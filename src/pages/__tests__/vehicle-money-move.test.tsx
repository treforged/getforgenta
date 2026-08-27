// @vitest-environment jsdom
//
// The vehicle money moved off the Garage on 2026-08-27 (Tre: "move saving for down payment and
// active loans to the auto loans section inside the debt payoff tab. it makes more since there.
// garage will just be the list of cars, the builds page, and maintenance").
//
// Two things have to stay true together, which is why they are pinned in one file: /debt's Auto
// Loans tab now carries the EDITABLE panels, and the Garage carries the roster and a way through
// to them. A move that only did half of this would leave a car with no home or with two.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const CAR_FUNDS = [
  {
    id: 'cf-loan', vehicle_name: '2004 Chevorlet C5', phase: 'loan',
    loan_amount: 18000, expected_apr: 7.5, loan_term_months: 60,
    loan_start_date: '2026-01-15', payment_start_date: '2026-02-15', interest_start_date: '2026-02-15',
    actual_monthly_payment: 0, monthly_insurance: 180, target_price: 0, tax_fees: 0,
    down_payment_goal: 0, current_saved: 0, saved_source: 'fixed', saved_percent: 0,
    gift_contribution: 0, linked_account: null, linked_rule_id: null, planned_purchase_date: null,
    insurance_start_date: null, loan_payment_account: null, linked_loan_account_id: null,
    lump_sum_payments: [], current_balance_override: null, auto_extra: false,
  },
  {
    id: 'cf-saving', vehicle_name: '2027 Honda Civic', phase: 'saving',
    loan_amount: 0, expected_apr: 5.9, loan_term_months: 60,
    loan_start_date: null, payment_start_date: '2027-08-01', interest_start_date: null,
    actual_monthly_payment: 0, monthly_insurance: 150, target_price: 28000, tax_fees: 2000,
    down_payment_goal: 5600, current_saved: 1400, saved_source: 'fixed', saved_percent: 0,
    gift_contribution: 0, linked_account: null, linked_rule_id: null, planned_purchase_date: '2027-07-01',
    insurance_start_date: null, loan_payment_account: null, linked_loan_account_id: null,
    lump_sum_payments: [], current_balance_override: null, auto_extra: false,
  },
];

vi.mock('@/hooks/useSupabaseData', () => ({
  useDebts: () => ({ data: [], update: { mutate: vi.fn() }, remove: { mutate: vi.fn() }, loading: false }),
  useAccountReconciliations: () => ({ add: { mutate: vi.fn() } }),
  useAccounts: () => ({ data: [], loading: false }),
  useTransactions: () => ({ data: [] }),
  useRecurringRules: () => ({ data: [] }),
  useProfile: () => ({ data: { weekly_gross_income: 0, tax_rate: 0, cash_floor: 1000 }, loading: false }),
  useSavingsGoals: () => ({ data: [] }),
  useCarFunds: () => ({ data: CAR_FUNDS, add: { mutate: vi.fn() }, update: { mutate: vi.fn() }, remove: { mutate: vi.fn() }, loading: false }),
  usePaymentPlans: () => ({ data: [], loading: false }),
  useSyncedTransactions: () => ({ data: [] }),
  useSyncedTransactionReviewsQuery: () => ({ data: [] }),
}));

vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/contexts/CardProjectionContext', () => ({
  useCardProjectionContext: () => ({
    cardProjection: null, assumptions: {}, pauseSavings: false, setPauseSavings: vi.fn(),
    projections: { data: [], nonCCLiabilityBalancesById: new Map(), carLoanBalancesByFundId: new Map() },
  }),
}));
vi.mock('@/hooks/useFormDraft', () => ({ useFormDraft: () => ({ restored: false, discard: vi.fn() }) }));
// The Garage mounts Builds only on its own tab; stubbing it keeps this test about the move.
vi.mock('@/pages/Builds', () => ({ default: () => <div>builds panel</div> }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import DebtPayoff from '../DebtPayoff';
import Vehicles from '../Vehicles';

function renderPage(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); });

describe("/debt's Auto Loans tab owns the vehicle money", () => {
  it('carries both panels, with the buttons that WRITE them', () => {
    renderPage(<DebtPayoff />);
    fireEvent.click(screen.getByRole('button', { name: /Auto Loans/ }));

    expect(screen.getByText('Active Loans')).toBeTruthy();
    expect(screen.getByText('Saving for Down Payment')).toBeTruthy();
    // The point of the move: these are the real cards, not a read-only quote of them.
    expect(screen.getByRole('button', { name: /Add Loan/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add Vehicle Goal/ })).toBeTruthy();
    expect(screen.getByText(/I bought it/)).toBeTruthy();
    expect(screen.getByText('2004 Chevorlet C5')).toBeTruthy();
    expect(screen.getByText('2027 Honda Civic')).toBeTruthy();
  });

  it('no longer sends the user back to the Garage to edit a car', () => {
    renderPage(<DebtPayoff />);
    fireEvent.click(screen.getByRole('button', { name: /Auto Loans/ }));
    expect(screen.queryByText(/Edit on Vehicles page/)).toBeNull();
    expect(screen.queryByText(/Auto loans are managed on the/)).toBeNull();
  });
});

describe('the Garage keeps the cars, not their money', () => {
  it('lists every car with a way through to the money', () => {
    renderPage(<Vehicles />);
    expect(screen.getByText('2004 Chevorlet C5')).toBeTruthy();
    expect(screen.getByText('2027 Honda Civic')).toBeTruthy();
    const money = screen.getAllByRole('link', { name: /Money/ });
    expect(money).toHaveLength(2);
    expect(money[0].getAttribute('href')).toBe('/debt?tab=auto');
  });

  it('has no money panel of its own left', () => {
    renderPage(<Vehicles />);
    expect(screen.queryByRole('button', { name: /Add Vehicle Goal/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add Loan/ })).toBeNull();
    expect(screen.queryByText(/Down payment progress/)).toBeNull();
  });

  it('lands a user whose remembered tab was a panel that moved on the car list', () => {
    // Everyone last on Saving or Active Loans still has that value in `tre:vehicles:activeTab`.
    localStorage.setItem('tre:vehicles:activeTab', JSON.stringify('loan'));
    renderPage(<Vehicles />);
    expect(screen.getByText('2004 Chevorlet C5')).toBeTruthy();
    expect(screen.queryByText('builds panel')).toBeNull();
  });
});

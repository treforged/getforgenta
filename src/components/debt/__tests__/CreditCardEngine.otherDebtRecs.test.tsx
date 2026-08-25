// @vitest-environment jsdom
//
// /debt's "Recommended This Month" panel and the Dashboard widget are two renderings of the same
// month, and they have drifted apart before (the widget spent a day showing the old due-chip
// layout after the panel had moved on). When student loans and mortgages joined the widget, the
// panel had to gain the same rows from the same builder or the two surfaces would disagree about
// what is due — this pins that it did.
//
// Would-fail check: delete the `otherDebtRecs` map and the row disappears while the Dashboard
// widget still shows it; pass the vehicle-linked account without `excludedAccountIds` and the
// second case gets a duplicate of a loan the car fund already carries.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { AccountRow, DebtRow, RuleRow } from '@/hooks/useSupabaseData';
import type { CarFund } from '@/lib/types';

vi.mock('@/hooks/useSupabaseData', () => ({
  useDebts: () => ({ update: { mutate: vi.fn() }, add: { mutate: vi.fn() } }),
  useAccounts: () => ({ update: { mutate: vi.fn() } }),
  useProfile: () => ({ update: { mutate: vi.fn() } }),
  useRecurringRules: () => ({ data: [] }),
  // `useMatchedOccurrences` reads these two: the month-scoped bank rows and the read-only view of
  // the reviews. Empty here, which is the no-bank-connection path — nothing in this file is about
  // matching, and an empty index leaves every figure exactly as it was.
  useSyncedTransactions: () => ({ data: [] }),
  useSyncedTransactionReviewsQuery: () => ({ data: [] }),
}));
vi.mock('@/hooks/usePlaidItems', () => ({ usePlaidItems: () => ({ items: [] }) }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: true }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/contexts/CardProjectionContext', () => ({
  useCardProjectionContext: () => ({
    forecastInputsBundle: { engineInputs: {} },
    debtCashConverged: false,
  }),
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsTouch: () => false, useIsViewportBelow: () => false }));

import CreditCardEngine from '../CreditCardEngine';

const account = (over: Partial<AccountRow> & { id: string; name: string; account_type: string }) => ({
  user_id: 'u1', balance: 0, active: true, created_at: '2026-01-01T00:00:00Z', ...over,
} as AccountRow);

const CARD = account({
  id: 'cc', name: 'Discover', account_type: 'credit_card', balance: 4000, credit_limit: 10000,
  apr: 24, min_payment: 100, payment_due_day: 12,
});
const STUDENT_LOAN = account({
  id: 'sl', name: 'Student Loan', account_type: 'student_loan', balance: 12000, payment_due_day: 20,
});
const LINKED_AUTO = account({
  id: 'auto', name: 'Car Loan', account_type: 'other_liability', balance: 20000,
});

const DEBTS = [
  { id: 'd1', name: 'Student Loan', balance: 12000, apr: 12, min_payment: 250, target_payment: 300 },
  { id: 'd2', name: 'Car Loan', balance: 20000, apr: 6, min_payment: 450, target_payment: 450 },
] as DebtRow[];

const CAR_FUND_LINKED_TO_AUTO = {
  id: 'cf1', vehicle_name: 'Civic', phase: 'loan', linked_loan_account_id: 'auto',
} as unknown as CarFund;

function setup(accounts: AccountRow[], carFunds: CarFund[] = []) {
  return render(
    <MemoryRouter>
      <CreditCardEngine
        accounts={accounts}
        transactions={[]}
        rules={[] as RuleRow[]}
        debts={DEBTS}
        profile={{}}
        goals={[]}
        carFunds={carFunds}
        month0={null}
        pauseSavings={false}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('CreditCardEngine — non-CC debts under Recommended This Month', () => {
  it('renders a student loan row beside the card rows', () => {
    setup([CARD, STUDENT_LOAN]);
    expect(screen.getByText('Recommended This Month')).toBeTruthy();
    expect(screen.getByText('Student Loan')).toBeTruthy();
    expect(screen.getByText('student loan')).toBeTruthy();
    expect(screen.getByText('Scheduled payment')).toBeTruthy();
  });

  it('leaves out an account a vehicle loan is linked to — the car fund already carries it', () => {
    setup([CARD, STUDENT_LOAN, LINKED_AUTO], [CAR_FUND_LINKED_TO_AUTO]);
    expect(screen.getByText('Student Loan')).toBeTruthy();
    expect(screen.queryByText('Car Loan')).toBeNull();
  });

  it('shows no such row when nothing is paired', () => {
    setup([CARD]);
    expect(screen.getByText('Recommended This Month')).toBeTruthy();
    expect(screen.queryByText('Student Loan')).toBeNull();
  });
});

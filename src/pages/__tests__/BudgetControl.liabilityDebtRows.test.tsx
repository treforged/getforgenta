// @vitest-environment jsdom
//
// Budget Control's Debt tab, once the NON-CARD half of the user's debt reaches it.
//
// Tre, 2026-08-27: the tile read "Debt Payments $0" and the allocation donut read "Debt 0%" while a
// real auto loan was being paid every month. `useMonth0DebtBreakdown` had always returned
// `loanRecommendations` and `otherDebtRecommendations`; this page mapped `recommendations` (cards)
// alone and dropped both lists on the floor, and he has no `debt_payment` recurring rule covering
// the loan either — so the loan appeared nowhere on the page.
//
// Three things pinned here:
//  1. a vehicle loan and a student loan are listed, and counted in the tab total;
//  2. a liability whose `paidByExpenseRule` is true produces NO row — it is already listed and
//     already counted under Bills, and a second row would double it on screen AND in the total;
//  3. a manual rule of the same name is not duplicated by the synthetic row.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const ACCOUNT = {
  id: 'acc-1', user_id: 'u1', name: 'Everyday Checking', account_type: 'checking',
  balance: 4200, active: true, created_at: '2026-01-01T00:00:00Z',
};

const LOAN_ROW = {
  carFundId: 'cf-1', name: 'C5', payment: 422.89, dueDay: 15,
  nextPayment: 422.89, nextPayMonth: 0 as const, nextDueDate: null, isFinalPayment: false,
};

const STUDENT_LOAN_ROW = {
  accountId: 'acc-edu', name: 'Student Loan', accountType: 'student_loan', payment: 300,
  dueDay: 20, nextPayment: 300, nextPayMonth: 0 as const, nextDueDate: null,
  isFinalPayment: false, paidByExpenseRule: false,
};

/** Same debt, but the user's own expense rule is what pays it — already under Bills. */
const RULE_PAID_ROW = { ...STUDENT_LOAN_ROW, accountId: 'acc-mort', name: 'Mortgage', paidByExpenseRule: true };

let loanRows: (typeof LOAN_ROW)[] = [LOAN_ROW];
let otherDebtRows: (typeof STUDENT_LOAN_ROW)[] = [STUDENT_LOAN_ROW];
let ruleRows: Record<string, unknown>[] = [];

vi.mock('@/hooks/useSupabaseData', () => ({
  useProfile: () => ({ data: { weekly_gross_income: 0, tax_rate: 0, paycheck_day: 5, paycheck_frequency: 'weekly' }, update: { mutate: vi.fn() }, loading: false }),
  useAccounts: () => ({ data: [ACCOUNT], loading: false }),
  useRecurringRules: () => ({
    data: ruleRows, loading: false,
    add: { mutate: vi.fn() }, update: { mutate: vi.fn() }, remove: { mutate: vi.fn() },
  }),
  useSavingsGoals: () => ({ data: [], update: { mutate: vi.fn() } }),
  useCarFunds: () => ({ data: [] }),
  useSubscriptions: () => ({ data: [] }),
  useDebts: () => ({ data: [] }),
  useTransactions: () => ({ data: [] }),
  useSyncedTransactions: () => ({ data: [] }),
  useSyncedTransactionReviewsQuery: () => ({ data: [] }),
}));

vi.mock('@/contexts/CardProjectionContext', () => ({
  useCardProjectionContext: () => ({ projections: { data: [] } }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: true }) }));
vi.mock('@/hooks/useAutoEndReconcile', () => ({ useAutoEndReconcile: () => ({ reconcile: vi.fn() }) }));
vi.mock('@/hooks/useMonth0DebtBreakdown', () => ({
  useMonth0DebtBreakdown: () => ({
    recommendations: [],
    loanRecommendations: loanRows,
    otherDebtRecommendations: otherDebtRows,
    totalAvailableCash: 0,
  }),
}));
vi.mock('@/hooks/useInAppReview', () => ({ reportValueEvents: vi.fn() }));
vi.mock('@/hooks/useFormDraft', () => ({ useFormDraft: () => ({ restored: false, discard: vi.fn() }) }));
vi.mock('@/components/budget/RuleDriftPanel', () => ({ default: () => null }));
vi.mock('@/components/rules/RulesFoundCard', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { MemoryRouter } from 'react-router';
import BudgetControl from '../BudgetControl';

function renderInAugust() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 25, 9, 0, 0));
  return render(<MemoryRouter><BudgetControl /></MemoryRouter>);
}

/** Radix activates a tab on mousedown, not on a bare click. */
function openDebt() {
  const trigger = screen.getByRole('tab', { name: /Debt/ });
  fireEvent.mouseDown(trigger);
  fireEvent.click(trigger);
}

beforeEach(() => {
  localStorage.clear();
  loanRows = [LOAN_ROW];
  otherDebtRows = [STUDENT_LOAN_ROW];
  ruleRows = [];
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Budget Control — loans and other liabilities in the Debt tab', () => {
  it('lists the vehicle loan and the student loan, tagged as synced', () => {
    renderInAugust();
    openDebt();

    const loan = screen.getByText('C5 Payment').closest('div.border-b');
    expect(loan).toBeTruthy();
    expect(loan?.textContent).toContain('$423');
    expect(loan?.textContent).toContain('from payoff');

    expect(screen.getByText('Student Loan Payment')).toBeTruthy();
  });

  it('counts both in the tab total', () => {
    renderInAugust();
    openDebt();

    // $422.89 loan + $300 student loan.
    expect(screen.getAllByText('$723/mo').length).toBeGreaterThan(0);
  });

  it('produces NO row for a liability an expense rule already pays', () => {
    otherDebtRows = [RULE_PAID_ROW];
    renderInAugust();
    openDebt();

    expect(screen.queryByText('Mortgage Payment')).toBeNull();
    // The loan alone, so the mortgage is not being counted invisibly either.
    expect(screen.getAllByText('$423/mo').length).toBeGreaterThan(0);
  });

  it('does NOT duplicate a loan the user already typed as their own rule', () => {
    otherDebtRows = [];
    ruleRows = [{
      id: 'rule-c5', user_id: 'u1', name: 'C5 Payment', amount: 422.89, rule_type: 'debt_payment',
      frequency: 'monthly', due_day: 15, due_month: null, category: 'Debt Payments', active: true,
      payment_source: 'acc-1', deposit_account: null, start_date: null, end_date: null,
      notes: null, created_at: '2026-01-01T00:00:00Z',
    }];
    renderInAugust();
    openDebt();

    expect(screen.getAllByText('C5 Payment').length).toBe(1);
    // One payment, not two.
    expect(screen.getAllByText('$423/mo').length).toBeGreaterThan(0);
  });
});

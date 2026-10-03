// @vitest-environment jsdom
//
// The Dashboard's "Recommended This Month" widget renders THREE lists — cards, vehicle loans, and
// non-CC debts (student loan / mortgage / other liability). The third one is what this file exists
// for, and the trap it pins is the empty state: `otherDebtRecommendations` arriving with rows while
// the gate still asked only `hasRecs || hasLoans` printed "No active debt recommendations this
// month" ABOVE a student loan payment that was very much due. A user with no cards and no vehicle
// is the whole population of that bug.
//
// Would-fail check: drop `hasOtherDebts` from the gate and case "renders the third list on its own"
// finds the empty-state sentence; drop the `.map` and the row itself disappears.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DebtRecommendationsWidget from '../DebtRecommendationsWidget';
import type { MonthlyDebtBreakdown } from '@/lib/credit-card-engine';

const EMPTY: MonthlyDebtBreakdown = {
  recommendations: [],
  loanRecommendations: [],
  otherDebtRecommendations: [],
  totalMinimumsDue: 0,
  totalRecommended: 0,
  totalAvailableCash: 0,
  autopayTotal: 0,
  strategyLabel: 'Avalanche',
  cashWarning: false,
  interestAvoided: 0,
};

const STUDENT_LOAN: NonNullable<MonthlyDebtBreakdown['otherDebtRecommendations']>[number] = {
  accountId: 'sl',
  name: 'Student Loan',
  accountType: 'student_loan',
  payment: 300,
  dueDay: 20,
  nextPayment: 300,
  nextPayMonth: 0,
  nextDueDate: new Date(2026, 0, 20),
  isFinalPayment: false,
  paidByExpenseRule: false,
};

const CARD: MonthlyDebtBreakdown['recommendations'][number] = {
  cardId: 'c1',
  cardName: 'Discover',
  color: '#f60',
  payment: 150,
  maxPayment: 150,
  dueDay: 12,
  pastDue: false,
  nextPayment: 150,
  nextPayMonth: 0,
  nextDueDate: new Date(2026, 0, 12),
  reason: 'Avalanche priority',
  isMinimumOnly: false,
};

function setup(breakdown: Partial<MonthlyDebtBreakdown>) {
  return render(
    <MemoryRouter>
      <DebtRecommendationsWidget debtBreakdown={{ ...EMPTY, ...breakdown }} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe('DebtRecommendationsWidget — non-CC debt rows', () => {
  it('renders the third list on its own, without the empty state', () => {
    setup({ otherDebtRecommendations: [STUDENT_LOAN] });
    expect(screen.queryByText('No active debt recommendations this month.')).toBeNull();
    expect(screen.getByText('Student Loan')).toBeTruthy();
    expect(screen.getByText('$300.00')).toBeTruthy();
    // The type is on the row, so "Student Loan" beside "$300" is not mistaken for a card.
    expect(screen.getByText('student loan')).toBeTruthy();
  });

  it('still says so when there is genuinely nothing due', () => {
    setup({});
    expect(screen.getByText('No active debt recommendations this month.')).toBeTruthy();
  });

  it('names the paying expense rule rather than hiding the debt behind it', () => {
    setup({ otherDebtRecommendations: [{ ...STUDENT_LOAN, paidByExpenseRule: true }] });
    expect(screen.getByText('Student Loan')).toBeTruthy();
    expect(screen.getByText(/Paid by your expense rule/)).toBeTruthy();
  });

  it('shows cards and non-CC debts together, each in its own list', () => {
    setup({ recommendations: [CARD], otherDebtRecommendations: [STUDENT_LOAN] });
    expect(screen.getByText('Discover')).toBeTruthy();
    expect(screen.getByText('Student Loan')).toBeTruthy();
    // Card-only totals stay card-only: the liability payment is out of the cash model already.
    expect(screen.queryByText('$450')).toBeNull();
  });

  it('marks a final payment as one', () => {
    setup({ otherDebtRecommendations: [{ ...STUDENT_LOAN, isFinalPayment: true }] });
    expect(screen.getByText('Final payment')).toBeTruthy();
  });
});

// The pre-payday cap /debt applies (pre-payday-cap.ts) must reach this widget too, or the
// Dashboard shows a payment due before payday that only the paycheck can fund. Would-fail check:
// drop the capPrePaydayRows call and the row reads $500.00 with no "after payday" line.
describe('DebtRecommendationsWidget — pre-payday cap', () => {
  const day = (n: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const due = day(2);
  const row = { ...CARD, payment: 500, maxPayment: 500, nextPayment: 500, nextDueDate: due };
  const cards = [{ id: 'c1', minPayment: 100, balance: 2000 }];

  it('caps a payment due before payday at the minimum plus Safe to Spend', () => {
    render(
      <MemoryRouter>
        <DebtRecommendationsWidget
          debtBreakdown={{ ...EMPTY, recommendations: [row] }}
          cards={cards}
          safeToSpend={{ amount: 50, payday: iso(day(5)) }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('$150.00')).toBeTruthy();
    expect(screen.getByText('+$350.00 optional after payday')).toBeTruthy();
  });

  it('leaves the row alone without a Safe to Spend figure', () => {
    render(
      <MemoryRouter>
        <DebtRecommendationsWidget debtBreakdown={{ ...EMPTY, recommendations: [row] }} cards={cards} />
      </MemoryRouter>,
    );
    expect(screen.getByText('$500.00')).toBeTruthy();
    expect(screen.queryByText(/optional after payday/)).toBeNull();
  });
});

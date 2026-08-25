// @vitest-environment jsdom
//
// Since d15b7ab9 the "mortgage, student loan and other debt payments are taken out of your cash
// before any credit card payoff" explainer describes ALL THREE non-CC debt tabs (mortgage, student
// loans, other debts), not just mortgage where it used to live. This pins that it now renders on
// all three, from one shared element, and stays off the two credit-card-related tabs.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@/hooks/useSupabaseData', () => ({
  useDebts: () => ({ data: [], update: { mutate: vi.fn() }, remove: { mutate: vi.fn() }, loading: false }),
  useAccountReconciliations: () => ({ add: { mutate: vi.fn() } }),
  useAccounts: () => ({ data: [], loading: false }),
  useTransactions: () => ({ data: [] }),
  useRecurringRules: () => ({ data: [] }),
  useProfile: () => ({ data: { weekly_gross_income: 0, tax_rate: 0 }, loading: false }),
  useSavingsGoals: () => ({ data: [] }),
  useCarFunds: () => ({ data: [], loading: false }),
  usePaymentPlans: () => ({ data: [], loading: false }),
}));

vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/contexts/CardProjectionContext', () => ({
  useCardProjectionContext: () => ({
    cardProjection: null, assumptions: {}, pauseSavings: false, setPauseSavings: vi.fn(),
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

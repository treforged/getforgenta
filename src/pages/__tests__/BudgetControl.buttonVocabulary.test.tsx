// @vitest-environment jsdom
//
// Presses the one Budget Control button this slice moved onto the repo's `btn`
// vocabulary — the custom-deduction "Add" button in the catalog modal, now
// `btn btn-md btn-primary` — and asserts it still adds the deduction and closes
// the modal, not just that the button exists with the right class.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const ACCOUNT = {
  id: 'acc-1', user_id: 'u1', name: 'Everyday Checking', account_type: 'checking',
  balance: 4200, active: true, created_at: '2026-01-01T00:00:00Z',
};

vi.mock('@/hooks/useSupabaseData', () => ({
  useProfile: () => ({
    data: {
      weekly_gross_income: 1875, tax_rate: 22, paycheck_day: 5, paycheck_frequency: 'weekly',
      paycheck_deductions: [], ui_preferences: null,
    },
    update: { mutate: vi.fn() },
    loading: false,
  }),
  useAccounts: () => ({ data: [ACCOUNT], loading: false }),
  useRecurringRules: () => ({
    data: [], loading: false,
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
  useCardProjectionContext: () => ({ projections: { data: [{ autoExtraByTarget: {} }] } }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: true }) }));
vi.mock('@/hooks/useAutoEndReconcile', () => ({ useAutoEndReconcile: () => ({ reconcile: vi.fn() }) }));
vi.mock('@/hooks/useMonth0DebtBreakdown', () => ({
  useMonth0DebtBreakdown: () => ({ recommendations: [], totalAvailableCash: 0 }),
}));
vi.mock('@/hooks/useInAppReview', () => ({ reportValueEvents: vi.fn() }));
vi.mock('@/hooks/useFormDraft', () => ({ useFormDraft: () => ({ restored: false, discard: vi.fn() }) }));
vi.mock('@/components/budget/RuleDriftPanel', () => ({ default: () => null }));
vi.mock('@/components/rules/RulesFoundCard', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { MemoryRouter } from 'react-router';
import BudgetControl from '../BudgetControl';

function renderPage() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 25, 9, 0, 0));
  return render(<MemoryRouter><BudgetControl /></MemoryRouter>);
}

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Budget Control — the custom-deduction "Add" button (now btn btn-md btn-primary)', () => {
  it('opens the catalog, types a custom label, presses Add, and the deduction actually appears', () => {
    renderPage();

    // Income tab is the default tab, and this is the row the button used to be
    // a bespoke `bg-primary` div for.
    fireEvent.click(screen.getByText('Add Deduction'));

    const input = screen.getByPlaceholderText(/Deduction name/i);
    // Deliberately NOT a `DEDUCTION_CATALOG` label ("Union Dues" etc. render as plain
    // text) — a genuinely custom label is what renders as an editable <input>.
    fireEvent.change(input, { target: { value: 'Pet Insurance Reimbursement' } });

    const addBtn = screen.getByRole('button', { name: 'Add' });
    expect(addBtn.className).toContain('btn-primary');
    fireEvent.click(addBtn);

    // The catalog modal closes …
    expect(screen.queryByPlaceholderText(/Deduction name/i)).toBeNull();
    // … and the new deduction is really on the page, editable by its own input (custom labels are
    // rendered as an <input>, unlike the fixed catalog items which render as plain text).
    expect(screen.getByDisplayValue('Pet Insurance Reimbursement')).toBeTruthy();
  });

  it('does nothing when the label is blank — the button stays disabled', () => {
    renderPage();
    fireEvent.click(screen.getByText('Add Deduction'));

    const addBtn = screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
    fireEvent.click(addBtn);

    // Still on the catalog — nothing was added.
    expect(screen.getByPlaceholderText(/Deduction name/i)).toBeTruthy();
  });
});

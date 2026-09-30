// @vitest-environment jsdom
//
// After commit 59c3fb37, an unset salary is $0, so the user must be able to return to it.
// This test ensures that clearing the gross income field or typing 0 correctly
// resets the salary to 0 and saves it, while invalid inputs revert to the previous value.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// ONE profile object and ONE rules array: a fresh object per render re-runs the page's hydrate
// effect, which would put the old salary back after every keystroke (a mock artefact, not the app).
const { addRuleMutate, updateProfileMutate, PROFILE, RULES } = vi.hoisted(() => ({
  addRuleMutate: vi.fn(),
  updateProfileMutate: vi.fn(),
  PROFILE: {
    weekly_gross_income: 1000, tax_rate: 22, paycheck_day: 5, paycheck_frequency: 'weekly',
    paycheck_deductions: [], ui_preferences: null,
  },
  RULES: [] as unknown[],
}));

const ACCOUNT = {
  id: 'acc-1', user_id: 'u1', name: 'Everyday Checking', account_type: 'checking',
  balance: 4200, active: true, created_at: '2026-01-01T00:00:00Z',
};

vi.mock('@/hooks/useSupabaseData', () => ({
  useProfile: () => ({
    data: PROFILE,
    update: { mutate: updateProfileMutate },
    loading: false,
  }),
  useAccounts: () => ({ data: [ACCOUNT], loading: false }),
  useRecurringRules: () => ({
    data: RULES, loading: false,
    add: { mutate: addRuleMutate }, update: { mutate: vi.fn() }, remove: { mutate: vi.fn() },
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

beforeEach(() => {
  localStorage.clear();
  addRuleMutate.mockClear();
  updateProfileMutate.mockClear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

// Salaries the page tried to save. Other profile writes (ui_preferences etc.) carry no salary.
const savedSalaries = () => updateProfileMutate.mock.calls
  .map((c) => c[0] as Record<string, unknown>)
  .filter((a) => 'weekly_gross_income' in a)
  .map((a) => a.weekly_gross_income);

describe('BudgetControl clears salary correctly', () => {
  it('clearing to "" and blurring saves weekly_gross_income 0 and clears input', () => {
    renderPage();
    vi.advanceTimersByTime(2000);
    updateProfileMutate.mockClear();
    const input = screen.getByLabelText('Gross income per paycheck');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    vi.advanceTimersByTime(1000);
    expect(savedSalaries()).toEqual([0]);
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('typing "0" and blurring saves weekly_gross_income 0 and clears input', () => {
    renderPage();
    vi.advanceTimersByTime(2000);
    updateProfileMutate.mockClear();
    const input = screen.getByLabelText('Gross income per paycheck');
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    vi.advanceTimersByTime(1000);
    expect(savedSalaries()).toEqual([0]);
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('typing "-5" and blurring reverts to previous value and saves nothing', () => {
    renderPage();
    vi.advanceTimersByTime(2000);
    updateProfileMutate.mockClear();
    const input = screen.getByLabelText('Gross income per paycheck');
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.blur(input);
    vi.advanceTimersByTime(1000);
    expect(savedSalaries()).toEqual([]);
    expect((input as HTMLInputElement).value).toBe('1000');
  });

  it('typing "1200" and blurring saves weekly_gross_income 1200', () => {
    renderPage();
    vi.advanceTimersByTime(2000);
    updateProfileMutate.mockClear();
    const input = screen.getByLabelText('Gross income per paycheck');
    fireEvent.change(input, { target: { value: '1200' } });
    fireEvent.blur(input);
    vi.advanceTimersByTime(1000);
    expect(savedSalaries()).toEqual([1200]);
  });
});

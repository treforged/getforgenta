// @vitest-environment jsdom
//
// THE BUDGET PAGE MUST NEVER WRITE RULES THE USER DID NOT ASK FOR (2026-09-29).
// Until this date, opening Budget with 0 rules inserted 9 made-up "starter" rules ($1,400 rent,
// $1,875 weekly paycheck, ...) into the user's REAL data, and every forecast was built on them.
// Its guard was a useRef, which resets on every mount, so it re-seeded: 13 real users carried 291
// such rows, 4 of them seeded more than once. Now the sample set is written only by an explicit
// press, and only once.
//
// Proven red on the pre-fix page: the two-mounts test saw 18 inserts (9 per mount).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const { addRuleMutate } = vi.hoisted(() => ({ addRuleMutate: vi.fn() }));

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

beforeEach(() => { localStorage.clear(); addRuleMutate.mockClear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Budget page with zero rules', () => {
  it('writes NOTHING on mount, across two separate mounts', () => {
    const first = renderPage();
    vi.advanceTimersByTime(2000);
    first.unmount();
    renderPage();
    vi.advanceTimersByTime(2000);
    expect(addRuleMutate).toHaveBeenCalledTimes(0);
  });

  it('offers the sample set as an explicit button, and one press writes the 9 rules once', () => {
    renderPage();
    const btn = screen.getByRole('button', { name: /start from a sample set/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(addRuleMutate).toHaveBeenCalledTimes(9);
    const names = addRuleMutate.mock.calls.map((c) => c[0].name);
    expect(names).toContain('Rent');
    expect(names).toContain('Weekly Paycheck');
  });
});

// @vitest-environment jsdom
//
// Budget Control's Transfers tab, once a savings goal's own `monthly_contribution` counts as the
// standing transfer it actually is.
//
// Tre, 2026-08-27: his $510/mo move-fund contribution was invisible on the one page whose job is to
// say where the money goes, because this tab only ever read `recurring_rules`. The row now reads
// "$510/mo + $1,107 extra this month" — and NEVER "$0 extra this month", which states an absence as
// a figure.
//
// Three things pinned here:
//  1. the goal's contribution is listed, and counted in the tab total;
//  2. the ranked auto-extra rides beside it, and disappears entirely at zero;
//  3. a goal funded by a REAL rule gets ONE row, not two — the duplicate would double the money on
//     screen and in the total.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const ACCOUNT = {
  id: 'acc-1', user_id: 'u1', name: 'Everyday Checking', account_type: 'checking',
  balance: 4200, active: true, created_at: '2026-01-01T00:00:00Z',
};
const SAVINGS = {
  id: 'acc-sav', user_id: 'u1', name: 'Move Savings', account_type: 'savings',
  balance: 106, active: true, created_at: '2026-01-01T00:00:00Z',
};

const goal = <T extends Record<string, unknown>>(over: T) => ({
  user_id: 'u1', goal_type: 'Custom', target_amount: 5730, current_amount: 106,
  monthly_contribution: 0, contribution_start_date: null, linked_account: 'acc-sav',
  linked_rule_id: null, linked_rule_ids: [] as string[], sort_order: 0, auto_extra: true,
  ...over,
});

// The move fund, funded by its own column rather than by a rule.
const MOVE_FUND = goal({ id: 'goal-move', name: 'Move Fund', monthly_contribution: 510 });

// A goal already funded by a real `recurring_rules` row. `linkedMonthly` is what SavingsGoals shows,
// so the rule is the single representation and this column must not add a second one.
const RULE_FUNDED = goal({
  id: 'goal-ruled', name: 'Vacation', monthly_contribution: 999, linked_rule_ids: ['rule-vac'],
});

const VACATION_RULE = {
  id: 'rule-vac', user_id: 'u1', name: 'Vacation Transfer', amount: 200, rule_type: 'transfer',
  frequency: 'monthly', due_day: 1, due_month: null, category: 'Savings', active: true,
  payment_source: 'acc-1', deposit_account: 'acc-sav', start_date: null, end_date: null,
  notes: null, created_at: '2026-01-01T00:00:00Z',
};

// What the engine's month-0 row carries. Index 0 is the current month; `buildAutoExtraByTarget`
// re-keys it by goal id.
let autoExtraRow: Record<string, number> = { 'goal-move': 1107 };
/** A whole projection when a test needs later months too (the "next extra" row); month 0 alone
 *  otherwise, built from `autoExtraRow`. */
let projectionRows: { autoExtraByTarget: Record<string, number> }[] | null = null;
let goalRows: ReturnType<typeof goal>[] = [MOVE_FUND];

vi.mock('@/hooks/useSupabaseData', () => ({
  useProfile: () => ({ data: { weekly_gross_income: 0, tax_rate: 0, paycheck_day: 5, paycheck_frequency: 'weekly' }, update: { mutate: vi.fn() }, loading: false }),
  useAccounts: () => ({ data: [ACCOUNT, SAVINGS], loading: false }),
  useRecurringRules: () => ({
    data: [VACATION_RULE], loading: false,
    add: { mutate: vi.fn() }, update: { mutate: vi.fn() }, remove: { mutate: vi.fn() },
  }),
  useSavingsGoals: () => ({ data: goalRows, update: { mutate: vi.fn() } }),
  useCarFunds: () => ({ data: [] }),
  useSubscriptions: () => ({ data: [] }),
  useDebts: () => ({ data: [] }),
  useTransactions: () => ({ data: [] }),
  useSyncedTransactions: () => ({ data: [] }),
  useSyncedTransactionReviewsQuery: () => ({ data: [] }),
}));

vi.mock('@/contexts/CardProjectionContext', () => ({
  useCardProjectionContext: () => ({
    projections: { data: projectionRows ?? [{ autoExtraByTarget: autoExtraRow }] },
  }),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: true }) }));
vi.mock('@/hooks/useAutoEndReconcile', () => ({ useAutoEndReconcile: () => ({ reconcile: vi.fn() }) }));
vi.mock('@/hooks/useMonth0DebtBreakdown', () => ({
  useMonth0DebtBreakdown: () => ({ recommendations: [], totalAvailableCash: 0 }),
}));
vi.mock('@/hooks/useInAppReview', () => ({ requestReviewAfterAction: vi.fn() }));
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
function openTransfers() {
  const trigger = screen.getByRole('tab', { name: /Transfers/ });
  fireEvent.mouseDown(trigger);
  fireEvent.click(trigger);
}

beforeEach(() => {
  localStorage.clear();
  autoExtraRow = { 'goal-move': 1107 };
  projectionRows = null;
  goalRows = [MOVE_FUND];
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Budget Control — a goal's own contribution in the Transfers tab", () => {
  it('lists the contribution beside its ranked extra, in his own wording', () => {
    renderInAugust();
    openTransfers();

    const row = screen.getByText('Move Fund Contribution').closest('div.border-b');
    expect(row).toBeTruthy();
    expect(row?.textContent).toContain('$510');
    expect(row?.textContent).toContain('+ $1,107 extra this month');
    expect(row?.textContent).toContain('from goal');
  });

  it('says nothing at all when there is no extra — never "$0 extra this month"', () => {
    autoExtraRow = {};
    renderInAugust();
    openTransfers();

    const row = screen.getByText('Move Fund Contribution').closest('div.border-b');
    expect(row).toBeTruthy();
    expect(row?.textContent).toContain('$510');
    // Not "$0 extra this month", and not the phrase at all — the row simply does not carry one.
    // (The tab's explanatory footnote below the list mentions it; the ROW must not.)
    expect(row?.textContent).not.toContain('extra this month');
  });

  // A month with no extra used to say nothing, and nothing reads as "this never happens".
  it('names the NEXT extra when this month has none', () => {
    autoExtraRow = {};
    projectionRows = [
      { autoExtraByTarget: {} },
      { autoExtraByTarget: {} },
      { autoExtraByTarget: { 'goal-move': 168 } },
    ];
    renderInAugust();
    openTransfers();

    const row = screen.getByText('Move Fund Contribution').closest('div.border-b');
    // Rendered in August 2026, so month index 2 is October 2026.
    expect(row?.textContent).toContain('next: $168 in Oct 2026');
    expect(row?.textContent).not.toContain('extra this month');
  });

  it('does not name a future extra in a month that already has one', () => {
    projectionRows = [
      { autoExtraByTarget: { 'goal-move': 1107 } },
      { autoExtraByTarget: { 'goal-move': 168 } },
    ];
    renderInAugust();
    openTransfers();

    const row = screen.getByText('Move Fund Contribution').closest('div.border-b');
    expect(row?.textContent).toContain('+ $1,107 extra this month');
    expect(row?.textContent).not.toContain('next:');
  });

  it('counts the contribution in the tab total', () => {
    renderInAugust();
    openTransfers();

    // $200 from the real Vacation Transfer rule + $510 from the goal's own column.
    expect(screen.getAllByText('$710/mo').length).toBeGreaterThan(0);
  });

  it('does NOT duplicate a goal that a real rule already funds', () => {
    goalRows = [RULE_FUNDED];
    renderInAugust();
    openTransfers();

    expect(screen.getByText('Vacation Transfer')).toBeTruthy();
    expect(screen.queryByText('Vacation Contribution')).toBeNull();
    // The rule's $200, not the goal column's stale $999 on top of it.
    expect(screen.getAllByText('$200/mo').length).toBeGreaterThan(0);
  });

  it('zeroes a contribution whose start date has not arrived yet', () => {
    goalRows = [goal({
      id: 'goal-move', name: 'Move Fund', monthly_contribution: 510,
      contribution_start_date: '2027-11-21',
    })];
    renderInAugust();
    openTransfers();

    expect(screen.getByText('Move Fund Contribution')).toBeTruthy();
    // Only the real rule's $200 counts this month.
    expect(screen.getAllByText('$200/mo').length).toBeGreaterThan(0);
  });
});

// @vitest-environment jsdom
//
// Budget Control, once a real payment answers a rule's occurrence. Two things this pins:
//
// T8 — THE BADGE'S MATCHER. `autoMatchedRuleIds` used to call `matchOccurrence`, which locates an
// occurrence from `due_day` alone and therefore refuses `weekly` and `biweekly` outright (there
// `due_day` is a day of the WEEK). Tre's weekly and biweekly rules could never carry the badge
// however plainly the bank showed them paid, while the forecast — matching on real occurrence dates
// — had already captured them. The first test is the would-fail proof: it runs the OLD matcher over
// the very fixture the badge now matches, and asserts it finds nothing.
//
// The monthly totals — Tre, 2026-08-24: "the real transaction date and costs should auto override
// the transaction for that month." A matched occurrence contributes what actually left the account,
// so Fixed Expenses reads the real $1,608 rather than the rule's $1,600.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

const ACCOUNT = {
  id: 'acc-1', user_id: 'u1', name: 'Everyday Checking', account_type: 'checking',
  balance: 4200, active: true, created_at: '2026-01-01T00:00:00Z',
};

const rule = <T extends Record<string, unknown>>(over: T) => ({
  user_id: 'u1', due_month: null, deposit_account: null, start_date: null, end_date: null,
  notes: null, active: true, created_at: '2026-01-01T00:00:00Z', payment_source: 'acc-1',
  ...over,
});

// Weekly, so the old matcher could never see it. August 2026's Fridays are the 7th, 14th, 21st, 28th.
const FUEL = rule({
  id: 'rule-fuel', name: 'Fuel', amount: 200, rule_type: 'expense',
  frequency: 'weekly', due_day: 5, category: 'Transportation',
});

const RENT = rule({
  id: 'rule-rent', name: 'Rent', amount: 1600, rule_type: 'expense',
  frequency: 'monthly', due_day: 28, category: 'Bills',
});

// $202 on the 21st answers ONE of Fuel's four occurrences: inside 1% of $200, inside the ±5 day
// window of the 21st, and out of reach of the 14th and the 28th.
const FUEL_CHARGE = {
  id: 'stx-fuel', account_id: 'acc-1', amount: 202, date: '2026-08-21',
  pending: false, name: 'WAWA 8821', merchant_name: 'Wawa',
};

// $1,608 on the 26th answers the rent occurrence due on the 28th.
const RENT_CHARGE = {
  id: 'stx-rent', account_id: 'acc-1', amount: 1608, date: '2026-08-26',
  pending: false, name: 'GREYSTAR RENT', merchant_name: 'Greystar',
};

// An INCOME rule. `isOutflowRule` (auto-matched-occurrences.ts) excludes income from the automatic
// matcher on purpose, so the only way this rule can ever badge is a USER-CONFIRMED review — exactly
// Tre's real two live badges (2026-08-25). This isolates the confirmed path from the auto path.
const PAYCHECK = rule({
  id: 'rule-paycheck', name: 'Paycheck', amount: 2100, rule_type: 'income',
  frequency: 'monthly', due_day: 15, category: 'Income', payment_source: null, deposit_account: 'acc-1',
});

const PAYCHECK_DEPOSIT = {
  id: 'stx-paycheck', account_id: 'acc-1', amount: 2100, date: '2026-08-15',
  pending: false, name: 'EMPLOYER DIRECT DEP', merchant_name: 'Employer',
};

// The user linked the deposit to the rule by hand in Transactions — `status: 'linked_rule'` — so
// this occurrence carries `source: 'confirmed'`, never `'auto'`.
const PAYCHECK_REVIEW = {
  status: 'linked_rule', rule_id: 'rule-paycheck', occurrence_month: '2026-08',
  occurrence_date: '2026-08-15', synced_transaction_id: 'stx-paycheck',
};

vi.mock('@/hooks/useSupabaseData', () => ({
  useProfile: () => ({ data: { weekly_gross_income: 0, tax_rate: 0, paycheck_day: 5, paycheck_frequency: 'weekly' }, update: { mutate: vi.fn() }, loading: false }),
  useAccounts: () => ({ data: [ACCOUNT], loading: false }),
  useRecurringRules: () => ({
    data: [FUEL, RENT, PAYCHECK], loading: false,
    add: { mutate: vi.fn() }, update: { mutate: vi.fn() }, remove: { mutate: vi.fn() },
  }),
  useSavingsGoals: () => ({ data: [], update: { mutate: vi.fn() } }),
  useCarFunds: () => ({ data: [] }),
  useSubscriptions: () => ({ data: [] }),
  useDebts: () => ({ data: [] }),
  useTransactions: () => ({ data: [] }),
  useSyncedTransactions: () => ({ data: [FUEL_CHARGE, RENT_CHARGE, PAYCHECK_DEPOSIT] }),
  useSyncedTransactionReviewsQuery: () => ({ data: [PAYCHECK_REVIEW] }),
}));

// Budget Control reads the engine's ranked auto-extra to annotate goal-funded transfers. Nothing
// about matching depends on it, so it is stubbed empty here.
vi.mock('@/contexts/CardProjectionContext', () => ({
  useCardProjectionContext: () => ({ projections: { data: [] } }),
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
// Both own their own queries and neither is about matching.
vi.mock('@/components/budget/RuleDriftPanel', () => ({ default: () => null }));
vi.mock('@/components/rules/RulesFoundCard', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { MemoryRouter } from 'react-router';
import { matchOccurrence } from '@/lib/transaction-matching';
import BudgetControl from '../BudgetControl';
import BudgetTotalsCard from '@/components/dashboard/BudgetTotalsCard';

function renderInAugust() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 7, 25, 9, 0, 0));
  return render(<MemoryRouter><BudgetControl /></MemoryRouter>);
}

/** The value shown on the metric tile with this label. */
function tile(label: string): string {
  const heading = screen.getByText(label);
  const card = heading.closest('.card-forged');
  if (!card) throw new Error(`no metric card for ${label}`);
  return card.textContent ?? '';
}

/** Radix activates a tab on mousedown, not on a bare click. */
function openTab(name: RegExp) {
  const trigger = screen.getByRole('tab', { name });
  fireEvent.mouseDown(trigger);
  fireEvent.click(trigger);
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Budget Control, the matched badge', () => {
  it('WOULD-FAIL PROOF: the old matcher finds nothing for this weekly rule', () => {
    // `matchOccurrence` is the call this surface used to make, over exactly the fixture below. It
    // refuses `weekly` outright, so no charge could ever badge the rule.
    expect(matchOccurrence(
      { ...FUEL, due_day: 5, payment_source: 'acc-1' } as Parameters<typeof matchOccurrence>[0],
      '2026-08',
      [FUEL_CHARGE, RENT_CHARGE],
    )).toBeNull();
  });

  it('badges a WEEKLY rule whose occurrence a settled charge answered', () => {
    renderInAugust();
    openTab(/Variable/);

    const row = screen.getByText('Fuel').closest('div.flex.flex-col')?.parentElement;
    if (!row) throw new Error('no Fuel rule row');
    // Label reads "matched", not "auto-matched" (2026-08-25): the merged index behind it also
    // includes user-confirmed matches, so "auto" overclaimed how this rule got badged.
    expect(within(row as HTMLElement).getByText('matched')).toBeTruthy();
  });

  it('badges the monthly rule too, so nothing that matched before stopped matching', () => {
    renderInAugust();
    openTab(/Fixed \(/);

    const row = screen.getByText('Rent').closest('div.flex.flex-col')?.parentElement;
    if (!row) throw new Error('no Rent rule row');
    expect(within(row as HTMLElement).getByText('matched')).toBeTruthy();
  });

  it('badges a USER-CONFIRMED income rule "matched", not "auto-matched"', () => {
    // Income is on the default tab, and the automatic matcher never touches income rules at all
    // (isOutflowRule), so this row can only be badged by the confirmed review above — the same shape
    // as both of Tre's real live badges.
    renderInAugust();

    // "Paycheck" also names an <option> in the Paycheck Deductions picker below (any income rule is
    // offered there); the rule row itself is the <p> the RuleRow name renders into.
    const nameEl = screen.getAllByText('Paycheck').find(el => el.tagName === 'P');
    if (!nameEl) throw new Error('no Paycheck rule name element');
    const row = nameEl.closest('div.flex.flex-col')?.parentElement;
    if (!row) throw new Error('no Paycheck rule row');
    expect(within(row as HTMLElement).getByText('matched')).toBeTruthy();
    expect(within(row as HTMLElement).queryByText('auto-matched')).toBeNull();
  });
});

// The tiles these two assert on MOVED TO THE DASHBOARD on 2026-08-27 (Tre: "i wanted these moved
// to dashboard"), so they now render `BudgetTotalsCard` over the same fixture. What is being pinned
// has not changed: a matched occurrence still has to reach the month's totals at what really left
// the account, and both surfaces read the one `useBudgetMonthTotals` that produces them.
describe('the budget totals card, monthly totals', () => {
  function renderCardInAugust() {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 25, 9, 0, 0));
    return render(<MemoryRouter><BudgetTotalsCard /></MemoryRouter>);
  }

  it('counts the matched occurrence at what really left the account', () => {
    renderCardInAugust();

    // Rent: the rule says $1,600, the bank says $1,608.
    expect(tile('Fixed Expenses')).toContain('$1,608');
    // Fuel: four Fridays at $200 is $800, and the matched one really cost $202.
    expect(tile('Variable')).toContain('$802');
  });

  it('shows the rule amount for a month nothing matched', () => {
    // October, where August's charges are past the reach of every occurrence's window. (September
    // is NOT such a month: the first occurrence of a month opens its window 27 days back, so an
    // August 21st charge can still answer a September 4th one. That is the auto-matcher's own
    // documented fallback and it is what the forecast already suppresses on, so the totals here
    // agree with it rather than inventing a second rule.)
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 25, 9, 0, 0));
    render(<MemoryRouter><BudgetTotalsCard /></MemoryRouter>);

    expect(tile('Fixed Expenses')).toContain('$1,600');
    // October 2026 has five Fridays: the 2nd, 9th, 16th, 23rd and 30th.
    expect(tile('Variable')).toContain('$1,000');
  });
});

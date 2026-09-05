// @vitest-environment jsdom
//
// Tre, 2026-09-05: planned items in Budget Control must repeat on a USER-CHOSEN interval — every
// other month, every three weeks, every five weeks — not only on the fixed frequency list.
//
// These tests PRESS the form. The whole feature is two boxes and a Save button, and a test that
// only read the labels would pass against a Save that writes nothing, writes half a pair, or
// writes a value the database's CHECK constraint then rejects at the user.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';

const ACCOUNT = {
  id: 'acc-1', user_id: 'u1', name: 'Everyday Checking', account_type: 'checking',
  balance: 4200, active: true, created_at: '2026-01-01T00:00:00Z',
};

/** Tre's real Supplements rule — the acceptance case. Monthly, due day 28, no custom interval. */
const SUPPLEMENTS = {
  id: 'rule-supp', user_id: 'u1', name: 'Supplements', amount: 106, rule_type: 'expense',
  frequency: 'monthly', due_day: 28, due_month: null, category: 'Other', active: true,
  payment_source: null, deposit_account: null, start_date: '2026-10-01', end_date: null,
  notes: null, created_at: '2026-09-01T00:00:00Z', interval_unit: null, interval_count: null,
};

const addMutate = vi.fn();
const updateMutate = vi.fn();
let ruleRows: Array<Record<string, unknown>> = [SUPPLEMENTS];

vi.mock('@/hooks/useSupabaseData', () => ({
  useProfile: () => ({ data: { weekly_gross_income: 0, tax_rate: 0, paycheck_day: 5, paycheck_frequency: 'weekly' }, update: { mutate: vi.fn() }, loading: false }),
  useAccounts: () => ({ data: [ACCOUNT], loading: false }),
  useRecurringRules: () => ({
    data: ruleRows, loading: false,
    add: { mutate: addMutate }, update: { mutate: updateMutate }, remove: { mutate: vi.fn() },
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

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a), warning: vi.fn(), info: vi.fn() } }));

import { MemoryRouter } from 'react-router';
import BudgetControl from '../BudgetControl';
import { customIntervalLabel, customIntervalFormHint, parseCustomIntervalCount } from '../BudgetControl';

function renderPage() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 5, 9, 0, 0));
  return render(<MemoryRouter><BudgetControl /></MemoryRouter>);
}

/** Radix activates a tab on mousedown, not on a bare click — the Fixed tab is where "Add Fixed"
 * lives, and the default tab is Income. */
function openFixedAndAdd() {
  const trigger = screen.getAllByRole('tab')[1];
  fireEvent.mouseDown(trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: /Add Fixed/i }));
}

/** Queries are scoped INSIDE the modal. The page behind it carries its own "Amount" inputs in the
 * Income & Taxes panel, and an unscoped getByLabelText silently typed into one of those instead —
 * the form then refused to save and the test read as a broken feature. */
function modal() {
  const el = document.querySelector('.modal-overlay');
  if (!el) throw new Error('the rule form is not open');
  return within(el as HTMLElement);
}

function setField(label: RegExp | string, value: string) {
  const input = modal().getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  return input;
}

beforeEach(() => {
  localStorage.clear();
  addMutate.mockClear();
  updateMutate.mockClear();
  toastError.mockClear();
  ruleRows = [SUPPLEMENTS];
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the interval helpers say in words what will happen', () => {
  it('reads a valid count and refuses everything else', () => {
    expect(parseCustomIntervalCount('3')).toBe(3);
    expect(parseCustomIntervalCount(' 12 ')).toBe(12);
    expect(parseCustomIntervalCount('')).toBeNull();
    expect(parseCustomIntervalCount('0')).toBeNull();
    expect(parseCustomIntervalCount('61')).toBeNull();
    expect(parseCustomIntervalCount('2.5')).toBeNull();
    expect(parseCustomIntervalCount('three')).toBeNull();
  });

  it('names the cadence rather than repeating the numbers back', () => {
    expect(customIntervalLabel({ interval_unit: 'week', interval_count: 3 })).toBe('Every 3 weeks');
    expect(customIntervalLabel({ interval_unit: 'week', interval_count: 5 })).toBe('Every 5 weeks');
    expect(customIntervalLabel({ interval_unit: 'month', interval_count: 2 })).toBe('Every other month');
    expect(customIntervalLabel({ interval_unit: 'month', interval_count: 1 })).toBe('Every month');
    // No interval at all: the row falls back to its frequency label, so this must be null.
    expect(customIntervalLabel({ interval_unit: null, interval_count: null })).toBeNull();
  });

  it('tells the user what is MISSING, not just that the pair is wrong', () => {
    expect(customIntervalFormHint('', '')).toContain('Leave blank');
    expect(customIntervalFormHint('3', '')).toContain('Pick a unit');
    expect(customIntervalFormHint('', 'week')).toContain('Enter how many');
    expect(customIntervalFormHint('0', 'week')).toContain('1 to 60');
    expect(customIntervalFormHint('3', 'week')).toBe('Every 3 weeks');
  });
});

describe('Budget Control — saving a user-chosen interval', () => {
  it('SAVES every three weeks when the two boxes are filled and Add is PRESSED', () => {
    renderPage();
    openFixedAndAdd();

    setField(/^Name/, 'Lawn service');
    setField(/^Amount/, '85');
    setField(/Repeat every/, '3');
    fireEvent.change(modal().getByLabelText(/Interval unit/), { target: { value: 'week' } });
    fireEvent.click(modal().getByRole('button', { name: /^Add Rule$/ }));

    expect(addMutate).toHaveBeenCalledTimes(1);
    expect(addMutate.mock.calls[0][0]).toMatchObject({
      name: 'Lawn service', interval_count: 3, interval_unit: 'week',
    });
  });

  it('SAVES every other month the same way', () => {
    renderPage();
    openFixedAndAdd();
    setField(/^Name/, 'Water bill');
    setField(/^Amount/, '64');
    setField(/Repeat every/, '2');
    fireEvent.change(modal().getByLabelText(/Interval unit/), { target: { value: 'month' } });
    fireEvent.click(modal().getByRole('button', { name: /^Add Rule$/ }));

    expect(addMutate.mock.calls[0][0]).toMatchObject({ interval_count: 2, interval_unit: 'month' });
  });

  it('REFUSES a half-filled pair and says which half is missing — it does not write', () => {
    renderPage();
    openFixedAndAdd();
    setField(/^Name/, 'Half a schedule');
    setField(/^Amount/, '10');
    setField(/Repeat every/, '3'); // no unit
    fireEvent.click(modal().getByRole('button', { name: /^Add Rule$/ }));

    expect(addMutate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it('REFUSES an out-of-range count rather than letting the database reject it', () => {
    renderPage();
    openFixedAndAdd();
    setField(/^Name/, 'Absurd');
    setField(/^Amount/, '10');
    setField(/Repeat every/, '900');
    fireEvent.change(modal().getByLabelText(/Interval unit/), { target: { value: 'month' } });
    fireEvent.click(modal().getByRole('button', { name: /^Add Rule$/ }));

    expect(addMutate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it('lets the user TYPE AN AMOUNT on a new rule — the box is not locked', () => {
    // Regression pin. `editId === paycheckRuleId` was `null === null` while adding, so the Amount
    // box was read-only for anyone with gross income set and no paycheck rule identified — the
    // form could be filled in everywhere except the one field that makes it a rule.
    renderPage();
    openFixedAndAdd();
    const amount = modal().getByLabelText(/^Amount/) as HTMLInputElement;
    expect(amount.readOnly).toBe(false);
    fireEvent.change(amount, { target: { value: '42' } });
    expect((modal().getByLabelText(/^Amount/) as HTMLInputElement).value).toBe('42');
  });

  it('ACCEPTANCE — an ordinary monthly rule still saves with NULLs, unchanged', () => {
    renderPage();
    openFixedAndAdd();
    setField(/^Name/, 'Supplements');
    setField(/^Amount/, '106');
    setField(/Due Day of Month/, '28');
    fireEvent.click(modal().getByRole('button', { name: /^Add Rule$/ }));

    expect(addMutate).toHaveBeenCalledTimes(1);
    expect(addMutate.mock.calls[0][0]).toMatchObject({
      name: 'Supplements', frequency: 'monthly', due_day: 28,
      interval_count: null, interval_unit: null,
    });
  });
});

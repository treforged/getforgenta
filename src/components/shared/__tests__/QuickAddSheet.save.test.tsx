// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import QuickAddSheet from '../QuickAddSheet';

/**
 * Quick add (ask 661548f5) must write the SAME row the full Add Transaction form writes, through the
 * same `add` hook. /demo cannot write, so check:quick-add proves the presses and this proves the row.
 *
 * Would-fail checks: save the keypad string instead of a number and "writes the row" fails; close on
 * a refused write and "stays open" fails (what was typed would be lost); drop the last-used defaults
 * and "starts on the last category and account" fails.
 */

const mutateAsync = vi.fn();
const state = {
  transactions: [] as Array<Record<string, unknown>>,
  accounts: [{ id: 'chk-1', name: 'Main', account_type: 'checking', active: true }],
};

vi.mock('@/hooks/useSupabaseData', () => ({
  useTransactions: () => ({ data: state.transactions, add: { mutateAsync, isPending: false } }),
  useAccounts: () => ({ data: state.accounts }),
}));
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
const demo = vi.hoisted(() => ({ isDemo: false }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => demo }));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router', () => ({ useNavigate: () => navigate }));
const recordFunnelStep = vi.hoisted(() => vi.fn());
vi.mock('@/lib/signup-funnel', () => ({ recordFunnelStep }));

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const keypad = () => within(screen.getByRole('group', { name: 'Amount keypad' }));

beforeEach(() => {
  mutateAsync.mockReset();
  toastMock.mockReset();
  navigate.mockReset();
  recordFunnelStep.mockReset();
  demo.isDemo = false;
  state.transactions = [];
});

describe('QuickAddSheet', () => {
  it('writes the row: + Groceries 3 6 "Add $36"', async () => {
    mutateAsync.mockResolvedValue({});
    const onClose = vi.fn();
    render(<QuickAddSheet onClose={onClose} />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Category' })).getByRole('button', { name: /Groceries/ }));
    fireEvent.click(keypad().getByRole('button', { name: '3' }));
    fireEvent.click(keypad().getByRole('button', { name: '6' }));
    press('Add $36');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({
      type: 'expense', amount: 36, category: 'Groceries', account: 'Checking', note: 'Transaction', payment_source: '',
    });
  });

  // Growth pass Proposal B (Tre approved 10-09): the demo asks for the signup at the save press.
  // Would-fail: call the write in demo (mutateAsync called, generic refusal) or drop the action's
  // funnel step / navigation.
  it('in /demo, "Add $36" asks for the signup instead of writing, and the ask leads to /auth', async () => {
    demo.isDemo = true;
    const onClose = vi.fn();
    render(<QuickAddSheet onClose={onClose} />);
    fireEvent.click(keypad().getByRole('button', { name: '3' }));
    fireEvent.click(keypad().getByRole('button', { name: '6' }));
    press('Add $36');
    const ask = await screen.findByTestId('demo-signup-ask');
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(ask.textContent).toMatch(/5-tap add/);
    // Control: nothing is recorded or navigated until the visitor presses the ask.
    expect(recordFunnelStep).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole('button', { name: 'Sign up free' }));
    expect(recordFunnelStep).toHaveBeenCalledWith('demo_signup_tap', { detail: 'quick_add' });
    expect(navigate).toHaveBeenCalledWith('/auth');
  });

  it('cannot save $0', () => {
    render(<QuickAddSheet onClose={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('stays open with what was typed when the write is refused', async () => {
    mutateAsync.mockRejectedValue(new Error('refused'));
    const onClose = vi.fn();
    render(<QuickAddSheet onClose={onClose} />);
    fireEvent.click(keypad().getByRole('button', { name: '9' }));
    press('Add $9');
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('quick-add-amount').textContent).toBe('-$9');
  });

  it('starts on the last category and account the user entered', async () => {
    mutateAsync.mockResolvedValue({});
    state.transactions = [
      { type: 'expense', category: 'Gas', date: '2026-10-01', created_at: '2026-10-07T10:00:00Z', payment_source: 'account:chk-1' },
    ];
    render(<QuickAddSheet onClose={vi.fn()} />);
    expect(within(screen.getByRole('group', { name: 'Category' })).getByRole('button', { name: /Gas/ }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(keypad().getByRole('button', { name: '4' }));
    press('Add $4');
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({ category: 'Gas', payment_source: 'account:chk-1', amount: 4 });
  });

  it('income saves as Income and hides the expense chips', async () => {
    mutateAsync.mockResolvedValue({});
    render(<QuickAddSheet onClose={vi.fn()} />);
    press('Income');
    expect(screen.queryByRole('group', { name: 'Category' })).toBeNull();
    fireEvent.click(keypad().getByRole('button', { name: '5' }));
    press('Add $5');
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0][0]).toMatchObject({ type: 'income', category: 'Income', amount: 5 });
  });
});

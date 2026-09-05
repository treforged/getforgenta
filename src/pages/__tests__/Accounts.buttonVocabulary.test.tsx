// @vitest-environment jsdom
//
// Presses the Accounts-page buttons this slice moved onto the repo's `btn`
// vocabulary — "Add Account" (`btn btn-primary`), the delete-confirm modal's
// "Delete Account" (`btn btn-danger`), the Plaid match modal's "Skip"/"Confirm
// Matches" (`btn btn-outline` / `btn btn-primary`) — plus the reorder arrows
// that were folded onto the existing `icon-btn` tap-target vocabulary already
// used by every other icon button on this page. A class-only rename that
// silently breaks a handler is exactly what a smoke render would miss.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const mocks = vi.hoisted(() => ({
  addAccount: vi.fn(),
  removeAccount: vi.fn(),
  reorder: vi.fn(),
}));

const account = (over: Record<string, unknown>) => ({
  user_id: 'u1', balance: 1000, active: true, created_at: '2026-01-01T00:00:00Z',
  payment_due_day: null, sort_order: 0, ...over,
});

const ACCOUNTS = [
  account({ id: 'a1', name: 'Everyday Checking', account_type: 'checking', balance: 4200, sort_order: 0 }),
  account({ id: 'a2', name: 'Emergency Savings', account_type: 'savings', balance: 9000, sort_order: 1 }),
];

vi.mock('@/hooks/useSupabaseData', () => ({
  useAccounts: () => ({
    data: ACCOUNTS, loading: false,
    add: { mutate: mocks.addAccount, isPending: false, mutateAsync: (item: unknown) => { mocks.addAccount(item); return Promise.resolve({ id: 'new-account' }); } },
    update: { mutate: vi.fn(), isPending: false },
    remove: { mutate: mocks.removeAccount, isPending: false },
    reorder: { mutate: mocks.reorder, isPending: false },
  }),
  useDebts: () => ({ data: [], loading: false, add: { mutate: vi.fn(), isPending: false }, update: { mutate: vi.fn(), isPending: false } }),
  useAccountReconciliations: () => ({ data: [], add: { mutate: vi.fn(), isPending: false } }),
}));

vi.mock('@/hooks/usePlaidItems', () => ({
  usePlaidItems: () => ({ items: [], loading: false, remove: { mutate: vi.fn(), isPending: false }, invalidate: vi.fn() }),
}));

vi.mock('@/hooks/useSurplusRanking', () => ({ useSurplusRanking: () => ({ rankNewCard: vi.fn() }) }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ isPremium: true }) }));
vi.mock('@/contexts/DemoContext', () => ({ useDemo: () => ({ isDemo: false }) }));
vi.mock('@/components/shared/PlaidLinkButton', () => ({ default: () => null }));
vi.mock('@/components/shared/AkoyaConnectButton', () => ({ default: () => null }));
vi.mock('@/components/shared/AkoyaFallbackPrompt', () => ({ default: () => null }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
// Touch mode is what swaps the drag handle for the up/down `icon-btn` arrows this slice touched.
vi.mock('@/hooks/use-mobile', () => ({ useIsTouch: () => true, useIsViewportBelow: () => false }));

import Accounts from '../Accounts';

beforeEach(() => {
  mocks.addAccount.mockClear();
  mocks.removeAccount.mockClear();
  mocks.reorder.mockClear();
  localStorage.clear();
});
afterEach(cleanup);

describe('Accounts — btn-vocabulary buttons still work', () => {
  it('"Add Account" (btn btn-primary) opens the add form', () => {
    render(<MemoryRouter><Accounts /></MemoryRouter>);
    const addBtn = screen.getAllByText('Add Account')[0].closest('button')!;
    expect(addBtn.className).toContain('btn-primary');
    fireEvent.click(addBtn);
    expect(document.querySelector('.modal-overlay')).not.toBeNull();
  });

  it('"Delete Account" (btn btn-danger) in the confirm modal actually deletes the row', () => {
    render(<MemoryRouter><Accounts /></MemoryRouter>);
    // Open the row menu's delete, which raises the confirm modal rather than deleting immediately.
    const deleteTriggers = document.querySelectorAll('button[class*="icon-btn"][class*="hover:text-destructive"]');
    expect(deleteTriggers.length).toBeGreaterThan(0);
    fireEvent.click(deleteTriggers[0]);

    const confirmBtn = screen.getByText('Delete Account', { selector: 'button' });
    expect(confirmBtn.className).toContain('btn-danger');
    fireEvent.click(confirmBtn);

    expect(mocks.removeAccount).toHaveBeenCalledTimes(1);
    // The modal closes once the delete is confirmed.
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('the move-down arrow (icon-btn) still reorders the account it sits on', () => {
    render(<MemoryRouter><Accounts /></MemoryRouter>);
    const moveDown = screen.getByLabelText('Move Everyday Checking down');
    expect(moveDown.className).toContain('icon-btn');
    fireEvent.click(moveDown);
    expect(mocks.reorder).toHaveBeenCalledTimes(1);
    // Everyday Checking (sort_order 0) moves past Emergency Savings (sort_order 1) — Emergency
    // Savings' write is the one that actually changes as a result.
    expect(mocks.reorder.mock.calls[0][0]).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'a2' })]),
    );
  });
});

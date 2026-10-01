// @vitest-environment jsdom
//
// THE START-OF-MONTH NOTICE ONLY EVER MEANT UNLINKED ACCOUNTS, and until 2026-09-02 it did not
// say so. Tre saw it on the 2nd with eight linked banks and asked for it to be clarified.
//
// Why this is worth a test rather than a careful read: telling someone to hand-update an account
// Plaid refreshes every morning invites them to type a number over a synced one. That is a wrong
// balance the app itself caused, in a place the app is supposed to be the source of truth.
//
// Would-fail check: drop the `manual.length === 0` guard and "says nothing when everything is
// linked" fails; drop the name list and "names the accounts it means" fails.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';

let mockAccounts: { id: string; name: string; active: boolean; plaid_account_id: string | null; account_type?: string; card_start_date?: string | null }[] = [];

vi.mock('@/hooks/useSupabaseData', () => ({
  useAccounts: () => ({ data: mockAccounts }),
}));
vi.mock('@/contexts/DemoContext', () => ({
  useDemo: () => ({ isDemo: false }),
}));

import AccountUpdateReminderBase, { UPDATE_BALANCES_HREF } from '../AccountUpdateReminder';

// The notice now carries a Link, so every render needs a router.
const AccountUpdateReminder = () => <MemoryRouter><AccountUpdateReminderBase /></MemoryRouter>;

const acct = (name: string, plaid: string | null, active = true) =>
  ({ id: name, name, active, plaid_account_id: plaid });

beforeEach(() => {
  localStorage.clear();
  // The 2nd: inside the 1st-7th window the notice shows in. Frozen so this file does not become
  // the kind of date-dependent test that went off in useFriendLink today.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-02T12:00:00'));
});
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('AccountUpdateReminder', () => {
  it('says NOTHING when every active account is linked', () => {
    mockAccounts = [acct('Chase', 'p1'), acct('Discover', 'p2')];
    const { container } = render(<AccountUpdateReminder />);
    expect(container.innerHTML).toBe('');
  });

  it('names the accounts it actually means', () => {
    mockAccounts = [acct('Chase', 'p1'), acct('Cash jar', null), acct('Old 401k', null)];
    render(<AccountUpdateReminder />);
    expect(screen.getByText(/2 accounts need updating by hand/i)).toBeTruthy();
    expect(screen.getByText(/Cash jar, Old 401k/)).toBeTruthy();
  });

  it('tells the user to LEAVE the linked ones alone, which is the whole point', () => {
    mockAccounts = [acct('Chase', 'p1'), acct('Discover', 'p2'), acct('Cash jar', null)];
    render(<AccountUpdateReminder />);
    expect(screen.getByText(/leave them alone/i)).toBeTruthy();
    expect(screen.getByText(/2 linked accounts/i)).toBeTruthy();
  });

  it('reads naturally for exactly one of each', () => {
    mockAccounts = [acct('Chase', 'p1'), acct('Cash jar', null)];
    render(<AccountUpdateReminder />);
    expect(screen.getByText(/One account needs updating by hand/i)).toBeTruthy();
    expect(screen.getByText(/1 linked account updates on its own/i)).toBeTruthy();
  });

  it('ignores inactive accounts, linked or not', () => {
    mockAccounts = [acct('Chase', 'p1'), acct('Closed jar', null, false)];
    const { container } = render(<AccountUpdateReminder />);
    expect(container.innerHTML).toBe('');
  });

  it('stays silent outside the first week of the month', () => {
    vi.setSystemTime(new Date('2026-09-20T12:00:00'));
    mockAccounts = [acct('Cash jar', null)];
    const { container } = render(<AccountUpdateReminder />);
    expect(container.innerHTML).toBe('');
  });

  it('leaves out a card whose start date is still in the future (Tre, 2026-10-01)', () => {
    mockAccounts = [
      acct('Roth IRA', null),
      { ...acct('Venture X', null), account_type: 'credit_card', card_start_date: '2028-06-01' },
      { ...acct('Apple Card', null), account_type: 'credit_card', card_start_date: '2028-02-28' },
      { ...acct('Old card', null), account_type: 'credit_card', card_start_date: '2026-01-15' },
    ];
    render(<AccountUpdateReminder />);
    expect(screen.getByText(/2 accounts need updating by hand/i)).toBeTruthy();
    expect(screen.getByText('Roth IRA, Old card')).toBeTruthy();
    expect(screen.queryByText(/Venture X|Apple Card/)).toBeNull();
  });

  it('says nothing when the only unlinked accounts are future cards', () => {
    mockAccounts = [acct('Chase', 'p1'), { ...acct('Venture X', null), account_type: 'credit_card', card_start_date: '2028-06-01' }];
    const { container } = render(<AccountUpdateReminder />);
    expect(container.innerHTML).toBe('');
  });

  it('pressing the notice goes to the balances it asks for', () => {
    mockAccounts = [acct('Cash jar', null)];
    const Where = () => { const l = useLocation(); return <output data-testid="where">{l.pathname + l.search}</output>; };
    const seen = () => screen.getByTestId('where').textContent;
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes><Route path="*" element={<><AccountUpdateReminderBase /><Where /></>} /></Routes>
      </MemoryRouter>,
    );
    expect(seen()).toBe('/dashboard');
    fireEvent.click(screen.getByText(/One account needs updating by hand/i));
    expect(seen()).toBe(UPDATE_BALANCES_HREF);
    expect(UPDATE_BALANCES_HREF).toBe('/dashboard?tab=accounts&panel=balances');
  });
});

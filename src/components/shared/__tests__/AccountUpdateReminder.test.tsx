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
import { render, screen, cleanup } from '@testing-library/react';

let mockAccounts: { id: string; name: string; active: boolean; plaid_account_id: string | null }[] = [];

vi.mock('@/hooks/useSupabaseData', () => ({
  useAccounts: () => ({ data: mockAccounts }),
}));
vi.mock('@/contexts/DemoContext', () => ({
  useDemo: () => ({ isDemo: false }),
}));

import AccountUpdateReminder from '../AccountUpdateReminder';

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
});

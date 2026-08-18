// The Accounts panel a link asks for. Same contract as `garage-tab.ts`: an unrecognised or absent
// `?tab=` must return null so the user's own persisted tab survives a plain visit.

import { describe, it, expect } from 'vitest';
import { ACCOUNTS_TABS, accountsTabFromSearch, isAccountsTab } from '@/lib/accounts-tab';

describe('accounts-tab', () => {
  it('names exactly the three panels the page renders', () => {
    expect([...ACCOUNTS_TABS]).toEqual(['balances', 'networth', 'banks']);
  });

  it('reads a tab a link asks for, from a string or a URLSearchParams', () => {
    expect(accountsTabFromSearch('?tab=networth')).toBe('networth');
    expect(accountsTabFromSearch(new URLSearchParams('tab=banks'))).toBe('banks');
  });

  it('returns null — never a default — when the link says nothing it knows', () => {
    // Would-fail: answering 'balances' here would silently reset the user's remembered tab on
    // every plain visit to /accounts.
    expect(accountsTabFromSearch('')).toBeNull();
    expect(accountsTabFromSearch('?tab=')).toBeNull();
    expect(accountsTabFromSearch('?tab=builds')).toBeNull();
    expect(accountsTabFromSearch('?other=networth')).toBeNull();
  });

  it('guards a raw value', () => {
    expect(isAccountsTab('banks')).toBe(true);
    expect(isAccountsTab('saving')).toBe(false);
    expect(isAccountsTab(null)).toBe(false);
    expect(isAccountsTab(undefined)).toBe(false);
  });
});

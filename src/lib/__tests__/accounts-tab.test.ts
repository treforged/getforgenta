// The Accounts panel a link asks for. Same contract as `garage-tab.ts`: an unrecognised or absent
// value must return null so the user's own persisted panel survives a plain visit.

import { describe, it, expect } from 'vitest';
import {
  ACCOUNTS_TABS, ACCOUNTS_PANEL_PARAM, accountsTabFromSearch, isAccountsTab,
} from '@/lib/accounts-tab';

describe('accounts-tab', () => {
  it('names exactly the two panels the surface renders', () => {
    expect([...ACCOUNTS_TABS]).toEqual(['balances', 'banks']);
  });

  it('does not know `networth` — the chart moved up beside the numbers it belongs to', () => {
    // Would-fail: keeping the panel in the list leaves a pill whose content is now rendered
    // permanently above it, i.e. a tab that opens onto nothing. An old link asking for it must
    // resolve to null and leave the remembered panel alone, because what it pointed at is already
    // on screen.
    expect(isAccountsTab('networth')).toBe(false);
    expect(accountsTabFromSearch('?panel=networth')).toBeNull();
  });

  it('reads a panel a link asks for, from a string or a URLSearchParams', () => {
    expect(accountsTabFromSearch('?panel=balances')).toBe('balances');
    expect(accountsTabFromSearch(new URLSearchParams('panel=banks'))).toBe('banks');
  });

  it('reads `panel`, never `tab` — the Dashboard selector it nests inside owns `tab`', () => {
    // Would-fail: reading `tab` here makes `/dashboard?tab=accounts` ALSO an instruction to this
    // selector, and whichever of the two strips the param first eats the other's instruction.
    expect(ACCOUNTS_PANEL_PARAM).toBe('panel');
    expect(accountsTabFromSearch('?tab=banks')).toBeNull();
    expect(accountsTabFromSearch('?tab=accounts&panel=banks')).toBe('banks');
  });

  it('returns null — never a default — when the link says nothing it knows', () => {
    // Would-fail: answering 'balances' here would silently reset the user's remembered panel on
    // every plain visit.
    expect(accountsTabFromSearch('')).toBeNull();
    expect(accountsTabFromSearch('?panel=')).toBeNull();
    expect(accountsTabFromSearch('?panel=builds')).toBeNull();
    expect(accountsTabFromSearch('?other=banks')).toBeNull();
  });

  it('guards a raw value', () => {
    expect(isAccountsTab('banks')).toBe(true);
    expect(isAccountsTab('saving')).toBe(false);
    expect(isAccountsTab(null)).toBe(false);
    expect(isAccountsTab(undefined)).toBe(false);
  });
});

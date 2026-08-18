// The Dashboard panel a link asks for. Same contract as `accounts-tab.ts`/`garage-tab.ts`: an
// unrecognised or absent `?tab=` must return null so the user's own persisted panel survives a
// plain visit to /dashboard.

import { describe, it, expect } from 'vitest';
import { DASHBOARD_TABS, dashboardTabFromSearch, isDashboardTab } from '@/lib/dashboard-tab';

describe('dashboard-tab', () => {
  it('names exactly the two panels the page renders', () => {
    expect([...DASHBOARD_TABS]).toEqual(['overview', 'accounts']);
  });

  it('reads a panel a link asks for, from a string or a URLSearchParams', () => {
    expect(dashboardTabFromSearch('?tab=accounts')).toBe('accounts');
    expect(dashboardTabFromSearch(new URLSearchParams('tab=overview'))).toBe('overview');
  });

  it('returns null — never a default — when the link says nothing it knows', () => {
    // Would-fail: answering 'overview' here would silently reset the user's remembered panel on
    // every plain visit to /dashboard.
    expect(dashboardTabFromSearch('')).toBeNull();
    expect(dashboardTabFromSearch('?tab=')).toBeNull();
    expect(dashboardTabFromSearch('?tab=networth')).toBeNull();
    expect(dashboardTabFromSearch('?other=accounts')).toBeNull();
  });

  it('keeps the Accounts sub-panels out of its own vocabulary', () => {
    // The Accounts panel reads `?panel=`, not `?tab=` (see accounts-tab.ts). The two vocabularies
    // must stay disjoint anyway, so a stray sub-panel value never selects a Dashboard panel.
    expect(isDashboardTab('networth')).toBe(false);
    expect(isDashboardTab('balances')).toBe(false);
    expect(isDashboardTab('banks')).toBe(false);
  });

  it('guards a raw value', () => {
    expect(isDashboardTab('accounts')).toBe(true);
    expect(isDashboardTab('account')).toBe(false);
    expect(isDashboardTab(null)).toBe(false);
    expect(isDashboardTab(undefined)).toBe(false);
  });
});

/**
 * Which panel the Accounts page opens on — the one rule shared by the page, its deep links and
 * its tests. Deliberately the same shape as `garage-tab.ts`, because it is the same problem and a
 * second spelling of it is how the two pages start behaving differently.
 *
 * ⚠️ WHY A URL PARAM AT ALL WHEN THE TAB IS ALREADY PERSISTED. The tab lives in localStorage
 * (`tre:accounts:activeTab`) so the page reopens where the user left it, which is right for a user
 * returning to the page and wrong for a LINK — the Dashboard's "Accounts" card promises net worth
 * history, and it has to be able to say WHICH panel it means. A link carries `?tab=networth`, the
 * page honours it once and strips it, after which the persisted value takes over again.
 *
 * ⚠️ AN UNKNOWN OR ABSENT VALUE RETURNS null, NOT A DEFAULT — "the link said nothing" and "the
 * link said something we do not recognise" both have to leave the user's own remembered tab alone.
 */

export const ACCOUNTS_TABS = ['balances', 'networth', 'banks'] as const;

export type AccountsTab = (typeof ACCOUNTS_TABS)[number];

export function isAccountsTab(value: string | null | undefined): value is AccountsTab {
  return typeof value === 'string' && (ACCOUNTS_TABS as readonly string[]).includes(value);
}

/** The tab a URL asks for, or null when it asks for nothing the page knows. */
export function accountsTabFromSearch(search: string | URLSearchParams): AccountsTab | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const asked = params.get('tab');
  return isAccountsTab(asked) ? asked : null;
}

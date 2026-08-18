/**
 * Which panel the Accounts surface opens on — the one rule shared by the surface, its deep links
 * and its tests. Deliberately the same shape as `garage-tab.ts` and `dashboard-tab.ts`, because it
 * is the same problem and a second spelling of it is how the pages start behaving differently.
 *
 * ⚠️ WHY A URL PARAM AT ALL WHEN THE PANEL IS ALREADY PERSISTED. The panel lives in localStorage
 * (`tre:accounts:activeTab`) so it reopens where the user left it, which is right for a user
 * returning and wrong for a LINK — a card promising net worth history has to be able to say WHICH
 * panel it means. A link carries the param, the surface honours it once and strips it, after which
 * the persisted value takes over again.
 *
 * ⚠️ THE PARAM IS `panel`, NOT `tab`, AND THAT IS LOAD-BEARING. Accounts is no longer a route; it is
 * the Dashboard's second panel (2026-08-18), and the Dashboard's own selector already owns `?tab=`.
 * Two nested selectors reading one `tab` key would collide — whichever stripped it first would eat
 * the other's instruction. The `/accounts` redirect translates an old `?tab=networth` bookmark into
 * `?tab=accounts&panel=networth`, so external links keep working with no second spelling in here.
 *
 * ⚠️ AN UNKNOWN OR ABSENT VALUE RETURNS null, NOT A DEFAULT — "the link said nothing" and "the
 * link said something we do not recognise" both have to leave the user's own remembered panel alone.
 */

export const ACCOUNTS_TABS = ['balances', 'networth', 'banks'] as const;

export type AccountsTab = (typeof ACCOUNTS_TABS)[number];

/** The query key the Accounts panel reads. Exported so the `/accounts` redirect writes the same one. */
export const ACCOUNTS_PANEL_PARAM = 'panel';

export function isAccountsTab(value: string | null | undefined): value is AccountsTab {
  return typeof value === 'string' && (ACCOUNTS_TABS as readonly string[]).includes(value);
}

/** The panel a URL asks for, or null when it asks for nothing the page knows. */
export function accountsTabFromSearch(search: string | URLSearchParams): AccountsTab | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const asked = params.get(ACCOUNTS_PANEL_PARAM);
  return isAccountsTab(asked) ? asked : null;
}

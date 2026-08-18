/**
 * Which panel the Dashboard opens on. Third spelling of the same contract as `garage-tab.ts` and
 * `accounts-tab.ts` — kept identical on purpose, because the moment one of them defaults differently
 * the three pages start behaving differently for the same link.
 *
 * ⚠️ WHY THE DASHBOARD HAS PANELS AT ALL. Tre, 2026-08-18: *"i was asking for the account tab to be
 * combined with dashboard. we need to reduce how many separate tabs. especially on mobile. they can
 * have sections within tabs."* Accounts is no longer a top-level route — it is the Dashboard's
 * second panel, and `/accounts` redirects here naming the panel it meant.
 *
 * ⚠️ AN UNKNOWN OR ABSENT VALUE RETURNS null, NOT A DEFAULT — "the link said nothing" and "the link
 * said something we do not recognise" must both leave the user's own remembered tab alone.
 */

export const DASHBOARD_TABS = ['overview', 'accounts'] as const;

export type DashboardTab = (typeof DASHBOARD_TABS)[number];

export function isDashboardTab(value: string | null | undefined): value is DashboardTab {
  return typeof value === 'string' && (DASHBOARD_TABS as readonly string[]).includes(value);
}

/** The panel a URL asks for, or null when it asks for nothing the page knows. */
export function dashboardTabFromSearch(search: string | URLSearchParams): DashboardTab | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const asked = params.get('tab');
  return isDashboardTab(asked) ? asked : null;
}

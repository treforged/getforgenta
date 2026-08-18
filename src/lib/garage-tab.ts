/**
 * Which panel the Garage opens on — the one rule shared by the page, its deep links and its tests.
 *
 * ⚠️ WHY A URL PARAM AT ALL WHEN THE TAB IS ALREADY PERSISTED. The tab lives in localStorage
 * (`tre:vehicles:activeTab`) so the page reopens where the user left it, and that is right for a
 * user returning to the page. It is wrong for a LINK: `/builds` used to be its own route, so every
 * bookmark, every "see your build" link and the nav entry itself have to be able to say WHICH panel
 * they mean. A redirect cannot write localStorage, so the link carries `?tab=builds` and the page
 * honours it once, then strips it — after which the persisted value takes over again.
 *
 * ⚠️ AN UNKNOWN OR ABSENT VALUE RETURNS null, NOT A DEFAULT. "The link said nothing" and "the link
 * said something we do not recognise" both have to leave the user's own remembered tab alone; a
 * function that answered `'saving'` here would silently reset that tab on every plain visit.
 */

export const GARAGE_TABS = ['saving', 'loan', 'builds'] as const;

export type GarageTab = (typeof GARAGE_TABS)[number];

export function isGarageTab(value: string | null | undefined): value is GarageTab {
  return typeof value === 'string' && (GARAGE_TABS as readonly string[]).includes(value);
}

/** The tab a URL asks for, or null when it asks for nothing the page knows. */
export function garageTabFromSearch(search: string | URLSearchParams): GarageTab | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const asked = params.get('tab');
  return isGarageTab(asked) ? asked : null;
}

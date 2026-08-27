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
 * function that answered `'vehicles'` here would silently reset that tab on every plain visit.
 *
 * ⚠️ `'saving'` AND `'loan'` ARE GONE, BUT NOT FORGOTTEN (2026-08-27). Those two panels moved to
 * /debt's Auto Loans tab, where the same loans were already being read (Tre: "move saving for down
 * payment and active loans to the auto loans section inside the debt payoff tab"). Two things
 * still say those words and must not be left dangling: the `tre:vehicles:activeTab` value already
 * in every existing user's localStorage, and any `/vehicles?tab=loan` link still in the wild.
 * `normalizeGarageTab` answers both — they land on the car list, which is where those cars now are
 * named on this page. The key itself is unchanged, so nothing else about a user's state resets.
 */

export const GARAGE_TABS = ['vehicles', 'builds'] as const;

export type GarageTab = (typeof GARAGE_TABS)[number];

/** The panels that USED to exist here, and where each one lands now. */
const RETIRED_GARAGE_TABS: Record<string, GarageTab> = {
  saving: 'vehicles',
  loan: 'vehicles',
};

export function isGarageTab(value: string | null | undefined): value is GarageTab {
  return typeof value === 'string' && (GARAGE_TABS as readonly string[]).includes(value);
}

/**
 * A stored or linked tab value turned into a panel this page still has. A retired panel maps to
 * its successor; anything else falls back to the default rather than rendering nothing at all.
 */
export function normalizeGarageTab(value: string | null | undefined, fallback: GarageTab = 'vehicles'): GarageTab {
  if (isGarageTab(value)) return value;
  if (typeof value === 'string' && value in RETIRED_GARAGE_TABS) return RETIRED_GARAGE_TABS[value];
  return fallback;
}

/** The tab a URL asks for, or null when it asks for nothing the page knows. */
export function garageTabFromSearch(search: string | URLSearchParams): GarageTab | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const asked = params.get('tab');
  if (isGarageTab(asked)) return asked;
  if (asked !== null && asked in RETIRED_GARAGE_TABS) return RETIRED_GARAGE_TABS[asked];
  return null;
}

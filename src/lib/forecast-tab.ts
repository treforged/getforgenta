/**
 * Which panel the Forecast surface opens on. FIFTH spelling of the contract in `garage-tab.ts`,
 * `dashboard-tab.ts`, `accounts-tab.ts` and `activity-tab.ts` — kept identical on purpose, because
 * the moment one of them defaults differently the pages start behaving differently for the same
 * link.
 *
 * ⚠️ WHY GOALS LIVES HERE. Tre, 2026-08-18: *"well add goals to forecast then."* A goal's hero
 * number is a target and an ETA, which is the Forecast's whole subject — so Goals is no longer a
 * top-level route, it is this surface's second panel, and `/goals` redirects here naming it. Same
 * trade as Accounts→Dashboard and Budget Control→Activity on the same day.
 *
 * ⚠️ THE IN-APP LINKS STILL POINT AT `/goals` ON PURPOSE — the Dashboard chips, the goal cards and
 * `OnboardingChecklist` all do. Repointing them would leave the redirect, which is what every
 * existing bookmark lands on, covered by nothing. This is the call `BudgetRedirect` already made.
 *
 * ⚠️ AN UNKNOWN OR ABSENT `?tab=` RETURNS null, NOT A DEFAULT — "the link said nothing" and "the
 * link said something we do not recognise" must both leave the user's own remembered panel alone.
 */

/**
 * ⚠️ RENDER ORDER, AND ALSO THE DEFAULT HERE. Forecast leads because the page is named after it
 * and every existing user arrives expecting it; Goals is the panel they navigate to.
 */
export const FORECAST_TABS = ['forecast', 'goals'] as const;

export type ForecastTab = (typeof FORECAST_TABS)[number];

/** Where a user with nothing stored lands, and where an unrecognised stored value heals to. */
export const FORECAST_TAB_FALLBACK: ForecastTab = 'forecast';

/** The one spelling of the key. */
export const FORECAST_TAB_STORAGE_KEY = 'tre:forecast:tab';

export function isForecastTab(value: string | null | undefined): value is ForecastTab {
  return typeof value === 'string' && (FORECAST_TABS as readonly string[]).includes(value);
}

/** The panel a URL asks for, or null when it asks for nothing the page knows. */
export function forecastTabFromSearch(search: string | URLSearchParams): ForecastTab | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const asked = params.get('tab');
  return isForecastTab(asked) ? asked : null;
}

/**
 * What to RENDER for a remembered value. Unlike the link reader above this one never returns null:
 * a stored value the page no longer recognises has to resolve to a panel, or the surface renders
 * empty with no error for a user who cannot see why.
 */
export function effectiveForecastTab(stored: string | null | undefined): ForecastTab {
  return isForecastTab(stored) ? stored : FORECAST_TAB_FALLBACK;
}

/**
 * The LIVE App Store rating for the landing page (ask 4f473837).
 *
 * Read from Apple's public lookup API at page load. It answers with `Access-Control-Allow-Origin: *`
 * (measured 2026-10-06), so the browser can read it directly - no proxy and no key.
 * Measured the same day: 5.0 from 5 ratings.
 *
 * REAL NUMBERS ONLY. Any failure - network, timeout, a changed shape, zero ratings - returns null
 * and the page shows NO rating. A missing rating is honest; a stale or invented one is not.
 *
 * Google Play has no public rating API, so the Play rating is not shown rather than copied by hand.
 */

export const APP_STORE_ID = '6762540239';
export const APP_STORE_URL = `https://apps.apple.com/us/app/forgenta-track-build-wealth/id${APP_STORE_ID}`;
export const APP_STORE_REVIEWS_URL = `${APP_STORE_URL}?see-all=reviews`;
const LOOKUP_URL = `https://itunes.apple.com/lookup?id=${APP_STORE_ID}&country=us`;
const TIMEOUT_MS = 5_000;

export interface StoreRating {
  /** Average stars, 1 to 5. */
  average: number;
  /** How many ratings the average is built from. Always at least 1. */
  count: number;
}

/** Pulls the rating out of an iTunes lookup response, or null when it is missing or not sane. */
export function parseAppStoreLookup(body: unknown): StoreRating | null {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const app = results[0] as { averageUserRating?: unknown; userRatingCount?: unknown } | null;
  const average = app?.averageUserRating;
  const count = app?.userRatingCount;
  if (typeof average !== 'number' || !Number.isFinite(average) || average < 1 || average > 5) return null;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) return null;
  return { average, count };
}

/** Fetches the live rating. Never throws: every failure is null. */
export async function fetchAppStoreRating(fetchImpl: typeof fetch = fetch): Promise<StoreRating | null> {
  try {
    const res = await fetchImpl(LOOKUP_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return parseAppStoreLookup(await res.json());
  } catch {
    return null;
  }
}

/** "5.0", "4.7" - one decimal, the way both stores print it. */
export function formatAverage(average: number): string {
  return average.toFixed(1);
}

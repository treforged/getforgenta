/**
 * The rating is read from Apple at BUILD time so it is never older than the deploy;
 * omitted when unreadable, because a stale or invented rating is a false claim.
 */

import type { Plugin } from 'vite';

export interface StoreRating {
  ratingValue: number;
  ratingCount: number;
}

/**
 * Parse the Apple lookup JSON into a StoreRating.
 * Returns null if the shape is unexpected or values are out of range.
 */
export function parseLookup(json: unknown): StoreRating | null {
  if (
    typeof json !== 'object' ||
    json === null ||
    !('resultCount' in json) ||
    !('results' in json)
  ) {
    return null;
  }

  const { resultCount, results } = json as { resultCount: unknown; results: unknown };

  if (
    typeof resultCount !== 'number' ||
    !Number.isInteger(resultCount) ||
    resultCount < 1 ||
    !Array.isArray(results) ||
    results.length < 1 ||
    typeof results[0] !== 'object' ||
    results[0] === null
  ) {
    return null;
  }

  const first = results[0] as { averageUserRating?: unknown; userRatingCount?: unknown };
  const avg = first.averageUserRating;
  const cnt = first.userRatingCount;

  if (
    typeof avg !== 'number' ||
    !Number.isFinite(avg) ||
    avg < 1 ||
    avg > 5 ||
    typeof cnt !== 'number' ||
    !Number.isInteger(cnt) ||
    cnt < 1
  ) {
    return null;
  }

  const ratingValue = Math.round(avg * 10) / 10; // one decimal place
  return { ratingValue, ratingCount: cnt };
}

/**
 * Inject an AggregateRating into the JSON-LD script of the given HTML.
 * Throws if the script is missing, malformed, or not a SoftwareApplication.
 */
export function withAggregateRating(
  html: string,
  rating: StoreRating | null
): string {
  if (rating === null) {
    return html;
  }

  const scriptRegex =
    /<script\s+type=["']application\/ld\+json["']\s*>([\s\S]*?)<\/script>/i;
  const match = html.match(scriptRegex);
  if (!match) {
    throw new Error('JSON-LD script tag not found in HTML.');
  }

  const originalJson = match[1];
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(originalJson);
  } catch {
    throw new Error('JSON-LD script content is not valid JSON.');
  }

  if (data['@type'] !== 'SoftwareApplication') {
    throw new Error(
      `JSON-LD @type is "${data['@type']}" but expected "SoftwareApplication".`
    );
  }

  data.aggregateRating = {
    '@type': 'AggregateRating',
    ratingValue: rating.ratingValue.toFixed(1),
    ratingCount: rating.ratingCount.toString(),
    bestRating: '5',
    worstRating: '1',
  };

  let serialized = JSON.stringify(data);
  serialized = serialized.replace(/</g, '\\u003c');

  const replacement = `<script type="application/ld+json">${serialized}</script>`;
  // A function replacement, so a '$' in the JSON is never read as a replacement pattern.
  return html.replace(scriptRegex, () => replacement);
}

/**
 * Fetch the Apple Store rating using the provided fetch implementation.
 * Returns null on any error or unexpected response.
 */
export async function fetchStoreRating(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5000
): Promise<StoreRating | null> {
  const url =
    'https://itunes.apple.com/lookup?id=6762540239&country=us';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      console.warn('[app-store-rating] non-2xx response');
      return null;
    }
    const json = await response.json();
    const rating = parseLookup(json);
    if (!rating) {
      console.warn('[app-store-rating] unable to parse rating');
    }
    return rating;
  } catch {
    console.warn('[app-store-rating] fetch error');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Vite plugin that adds the App Store rating to the generated HTML.
 */
export function appStoreRatingPlugin(): Plugin {
  return {
    name: 'app-store-rating',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      async handler(html) {
        const rating = await fetchStoreRating();
        if (rating) {
          console.log(
            `[app-store-rating] ${rating.ratingValue} from ${rating.ratingCount} ratings`
          );
        } else {
          console.log('[app-store-rating] no rating, JSON-LD left without one');
        }
        return withAggregateRating(html, rating);
      },
    },
  };
}

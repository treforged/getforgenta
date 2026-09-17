/**
 * Institutions offered as an Akoya fallback when Plaid can't connect.
 *
 * `key` is the only value sent to the backend. The actual Akoya connector id
 * lives in a server-side environment variable (AKOYA_CONNECTOR_<KEY>), because
 * connector ids come from the Data Recipient Hub and differ between sandbox and
 * production — they must never be baked into the bundle.
 *
 * `matchers` run against the institution name Plaid reports, rather than a
 * Plaid institution id, so the match stays readable and doesn't depend on an
 * opaque identifier.
 */

export interface AkoyaInstitution {
  /** Stable slug sent to the akoya-auth-url function. */
  key: string;
  displayName: string;
  /** Patterns matched against the Plaid-reported institution name. */
  matchers: RegExp[];
}

/**
 * ⚠️ DELIBERATELY EMPTY SINCE 2026-09-17. Tre: "remove Connect Fidelity via Akoya btw since i
 * never bought it. i cant even do it sense its an expensive pay up front".
 *
 * Akoya is a paid-up-front data network and this account has never purchased access, so every
 * Akoya offer in the app was a control that could not complete for any user. Fidelity was the
 * only entry, so emptying this list is the whole removal: `findAkoyaInstitution` can no longer
 * match anything, and both fallback call sites render nothing because `AkoyaFallbackPrompt`
 * already returns null for a null institution. The Accounts disclosure that MAPS this list is
 * separately guarded on its length, because an empty map does not remove a disclosure — it
 * leaves a broken one reading "Trouble connecting ?" with no buttons under it.
 *
 * THE PROVIDER IS KEPT, NOT DELETED — the edge functions, the `/akoya-oauth` callback route and
 * the response normalizers all still work and are still tested. He said he has not bought it,
 * not that he never will, and this list is the one place that decides whether a user is OFFERED
 * the route. Restoring the offer is putting the entry back; that is why the removal was made
 * here rather than by pulling the surfaces out one at a time.
 */
export const AKOYA_INSTITUTIONS: readonly AkoyaInstitution[] = [];

/**
 * Resolves an institution name to a supported Akoya fallback, or null when the
 * institution has no Akoya route. Callers must treat null as "don't offer it".
 */
export function findAkoyaInstitution(
  institutionName: string | null | undefined,
): AkoyaInstitution | null {
  if (!institutionName) return null;
  return (
    AKOYA_INSTITUTIONS.find(inst =>
      inst.matchers.some(pattern => pattern.test(institutionName)),
    ) ?? null
  );
}

export function getAkoyaInstitutionByKey(key: string): AkoyaInstitution | null {
  return AKOYA_INSTITUTIONS.find(inst => inst.key === key) ?? null;
}

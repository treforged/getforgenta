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

export const AKOYA_INSTITUTIONS: readonly AkoyaInstitution[] = [
  {
    key: 'fidelity',
    displayName: 'Fidelity',
    matchers: [/\bfidelity\b/i],
  },
];

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

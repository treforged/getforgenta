/**
 * Classifies why a Plaid Link attempt ended, so the UI can decide whether an
 * Akoya fallback is worth offering.
 *
 * Plaid surfaces these only through the onExit callback, and only when the
 * failure is one Plaid itself recognizes. A user who gives up on a stalled
 * Fidelity login exits with no error at all, which is why the Accounts page
 * also offers a manual "trouble connecting?" route rather than relying on
 * detection alone.
 */

export type ConnectionFailureKind =
  /** The institution is down, unreachable, or no longer supported. */
  | 'institution_unavailable'
  /** The user closed Link without an error. */
  | 'user_cancelled'
  /** Anything else — a real error, but not one Akoya would solve. */
  | 'other';

export interface PlaidExitError {
  error_code?: string;
  error_type?: string;
  error_message?: string;
}

/**
 * Plaid error codes meaning "we cannot reach this institution right now".
 * Sourced from Plaid's INSTITUTION_ERROR family.
 */
const INSTITUTION_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'INSTITUTION_DOWN',
  'INSTITUTION_NOT_AVAILABLE',
  'INSTITUTION_NOT_RESPONDING',
  'INSTITUTION_NO_LONGER_SUPPORTED',
  'INSTITUTION_REGISTRATION_REQUIRED',
]);

export function classifyPlaidExit(
  error: PlaidExitError | null | undefined,
): ConnectionFailureKind {
  if (!error || (!error.error_code && !error.error_type)) return 'user_cancelled';

  if (error.error_code && INSTITUTION_UNAVAILABLE_CODES.has(error.error_code)) {
    return 'institution_unavailable';
  }

  // The whole INSTITUTION_ERROR family is connectivity-shaped; treat unlisted
  // members as unavailable rather than silently dropping a valid fallback.
  if (error.error_type === 'INSTITUTION_ERROR') return 'institution_unavailable';

  return 'other';
}

/**
 * The rules a consent link has to satisfy, as pure functions.
 *
 * A link to this page is a CREDENTIAL: pressing a button behind it moves
 * somebody's billing. So the rules that decide whether one is honoured are kept
 * here, out of the request handler, and asserted in tests rather than reasoned
 * about — the same reason `decideAnniversary` is pure. The handler's job is to
 * fetch a row and obey the answer.
 *
 * See docs/og-cohort.md. The link exists because the ask goes by EMAIL and the
 * confirmation happens on the WEB, never in the app, and the person opening it
 * may be on a device where they have never signed in.
 */

/** How long a consent link stays live. */
export const CONSENT_TOKEN_TTL_DAYS = 30;

/**
 * Long enough that guessing is not a threat model — 32 bytes, 256 bits, from the
 * platform CSPRNG. `Math.random()` is not a CSPRNG and must never appear here.
 */
export function generateConsentToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hex of a raw token. Only this is ever stored. */
export async function hashConsentToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function consentTokenExpiry(issuedAt: Date, ttlDays = CONSENT_TOKEN_TTL_DAYS): Date {
  // Calendar arithmetic, not `+ ttl * 86400000`. One day is 23 or 25 hours across
  // a DST boundary, and this repo has already been bitten by ms-based date maths
  // in the forecast engine (see scheduling.ts).
  return new Date(
    issuedAt.getFullYear(), issuedAt.getMonth(), issuedAt.getDate() + ttlDays,
    issuedAt.getHours(), issuedAt.getMinutes(), issuedAt.getSeconds(), issuedAt.getMilliseconds(),
  );
}

/** The stored row, as the handler reads it back. */
export interface ConsentTokenRow {
  user_id: string;
  consent_version: string;
  expires_at: string;
  used_at: string | null;
}

export type TokenVerdict =
  | { ok: true; user_id: string; consent_version: string }
  | { ok: false; reason: 'unknown' | 'expired' | 'already_used' };

/**
 * Is this link still good?
 *
 * `row === null` covers both "no such token" and a token that never existed, and
 * they collapse to the same answer ON PURPOSE: a page that distinguishes "wrong
 * token" from "no token" tells an attacker which guesses are closer.
 *
 * Order matters. `already_used` is checked BEFORE `expired` so a person who
 * already answered is told they already answered, rather than being told their
 * link expired — which would read as "you missed it" for something they in fact
 * did. The security outcome is identical; the human one is not.
 */
export function verifyConsentToken(row: ConsentTokenRow | null, now: Date): TokenVerdict {
  if (!row) return { ok: false, reason: 'unknown' };
  if (row.used_at !== null) return { ok: false, reason: 'already_used' };
  if (new Date(row.expires_at) <= now) return { ok: false, reason: 'expired' };
  return { ok: true, user_id: row.user_id, consent_version: row.consent_version };
}

/**
 * What the person is told when a link does not work. Never mentions whether the
 * token existed, and always offers the way forward — a dead end on a page about
 * somebody's money is how a support email gets written instead.
 */
export function tokenFailureMessage(reason: 'unknown' | 'expired' | 'already_used'): string {
  switch (reason) {
    case 'already_used':
      return 'You have already answered this — your choice is recorded and nothing further is needed. '
        + 'If you want to change it, reply to the email we sent and we will sort it out.';
    case 'expired':
      return 'This link has expired. Nothing has changed about your subscription. '
        + 'Reply to the email we sent and we will send you a fresh one.';
    default:
      return 'This link is not valid. Nothing has changed about your subscription. '
        + 'Reply to the email we sent and we will send you a fresh one.';
  }
}

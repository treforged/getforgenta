/**
 * Invite-code primitives for the friend-link Edge Function.
 *
 * A DELIBERATE COPY of partner-link/invite-code.ts, not an import of it. The two
 * functions deploy as independent bundles, and the format, the length gate and
 * the normalization of one feature must be changeable without silently
 * re-shaping the other feature's live invites. `_shared/` is where genuinely
 * shared behaviour lives; this is not shared behaviour, it is the same recipe
 * used twice. The partner-link copy is the original and stays the reference.
 *
 * Split out of index.ts so they can be exercised by vitest: the function body
 * itself needs Deno and cannot run in this repo's test runner, but these are
 * pure and use only WebCrypto, which Deno and Node both provide. Same bridge the
 * other edge-function tests use (see src/lib/__tests__/akoya-normalize.test.ts).
 *
 * The security property these carry:
 *   - the code is 128 bits of CSPRNG output, never a counter, never a uuid
 *     derived from anything the caller supplied;
 *   - only its SHA-256 ever reaches the database (plan 2 - the `share_token`
 *     lesson from 20260615_fix_public_rls.sql, applied harder: the hash column
 *     has no client-readable grant at all);
 *   - email comparison is done on a normalized form on BOTH sides, because the
 *     accept path's entire second wall is `lower(jwt email) = invitee_email`.
 */

/** 16 bytes = 128 bits. Brute force is academic; rate limiting is politeness. */
export const INVITE_CODE_BYTES = 16;

/** base64url of 16 bytes, padding stripped. */
export const INVITE_CODE_LENGTH = 22;

// Codes we mint are exactly INVITE_CODE_LENGTH. The upper bound is slack for a
// future code format, not for a caller: anything outside this is rejected
// before a database round-trip happens.
const INVITE_CODE_RE = /^[A-Za-z0-9_-]{22,64}$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * A fresh invite code. Returned to the caller exactly once, inside the invite
 * email - nothing else in the system can produce it again.
 */
export function generateInviteCode(): string {
  const bytes = new Uint8Array(INVITE_CODE_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** SHA-256, lowercase hex. The only representation of a code that is stored. */
export async function hashInviteCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(code),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Shape gate, run before any lookup - the same move public-build makes with
 * UUID_RE before it touches the database. A caller that fails this gets the
 * identical generic 404 a wrong-but-well-formed code gets; the point is only to
 * keep garbage out of the query, never to tell the caller which wall it hit.
 */
export function isPlausibleInviteCode(code: string): boolean {
  return INVITE_CODE_RE.test(code);
}

/** Trim + lowercase. Both the stored `invitee_email` and the JWT email pass
 *  through this before they are compared, and the table has a CHECK that keeps
 *  the stored side lowercase independently of this function. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

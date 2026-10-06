/**
 * Keeps an invite code alive across the redirects a NEW invitee is sent through.
 *
 * Partner and friend invite emails link to `/settings?partner_code=…` / `?friend_code=…`, and the
 * email tells the reader to create an account first. Measured 2026-10-05 (ask 4f623f93): a
 * signed-out reader is bounced to /auth and a fresh account is bounced to /onboarding, both by a
 * bare `<Navigate>` that drops the query string - so the code, which exists nowhere but that URL,
 * was gone by the time they could use it. The route guard stashes it here before bouncing, and
 * hands it back exactly once when the user is signed in and set up.
 *
 * localStorage rather than sessionStorage on purpose: confirming a new account's email opens a NEW
 * tab, which a session-scoped store would not see. Expires with the invite (7 days).
 */

export const PENDING_INVITE_KEY = 'forgenta:pending-invite';
export const PENDING_INVITE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 60_000;
const CODE_RE = /^[A-Za-z0-9_-]{8,64}$/;

type InviteKind = 'partner' | 'friend';
type InviteStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type PendingInvite = { kind: InviteKind; code: string; savedAt: number };

function safeLocalStorage(): InviteStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The invite carried by a query string. `partner_code` wins when both are present. */
export function readInviteFromSearch(search: string): { kind: InviteKind; code: string } | null {
  const params = new URLSearchParams(search);
  const partner = params.get('partner_code')?.trim();
  if (partner && CODE_RE.test(partner)) return { kind: 'partner', code: partner };
  const friend = params.get('friend_code')?.trim();
  if (friend && CODE_RE.test(friend)) return { kind: 'friend', code: friend };
  return null;
}

/** Saves the invite in `search`, if there is one. Returns whether anything was saved. */
export function stashInviteFromSearch(
  search: string,
  now = Date.now(),
  storage: InviteStorage | null = safeLocalStorage(),
): boolean {
  const invite = readInviteFromSearch(search);
  if (!invite || !storage) return false;
  try {
    const record: PendingInvite = { ...invite, savedAt: now };
    storage.setItem(PENDING_INVITE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

function parseValid(raw: string | null, now: number): PendingInvite | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PendingInvite> | null;
    if (!v || (v.kind !== 'partner' && v.kind !== 'friend')) return null;
    if (typeof v.code !== 'string' || !CODE_RE.test(v.code)) return null;
    if (typeof v.savedAt !== 'number' || !Number.isFinite(v.savedAt)) return null;
    if (now - v.savedAt > PENDING_INVITE_MAX_AGE_MS) return null;
    if (v.savedAt - now > FUTURE_SKEW_MS) return null;
    return { kind: v.kind, code: v.code, savedAt: v.savedAt };
  } catch {
    return null;
  }
}

function readRaw(storage: InviteStorage | null): string | null {
  try {
    return storage ? storage.getItem(PENDING_INVITE_KEY) : null;
  } catch {
    return null;
  }
}

function toAccountUrl(invite: PendingInvite): string {
  return `/account?${invite.kind}_code=${encodeURIComponent(invite.code)}`;
}

/**
 * The `/account` URL that resumes the waiting invite, or null. Leaves it in place, so a caller
 * whose effect runs twice (React StrictMode) gets the SAME answer both times - consuming it on
 * read sent the second run back to where the user started (measured 2026-10-05).
 */
export function peekPendingInvite(now = Date.now(), storage: InviteStorage | null = safeLocalStorage()): string | null {
  const invite = parseValid(readRaw(storage), now);
  return invite ? toAccountUrl(invite) : null;
}

/** Removes the waiting invite. Never throws. */
export function clearPendingInvite(storage: InviteStorage | null = safeLocalStorage()): void {
  try {
    storage?.removeItem(PENDING_INVITE_KEY);
  } catch {
    // Swallowed: a store that reads but cannot remove would resume on each guarded visit until the
    // 7-day expiry. No browser storage is known to behave that way; the stash is the risk, not this.
  }
}

/**
 * The `/account` URL that resumes the waiting invite, or null. ALWAYS clears the stored value, so
 * a stale or corrupt entry cannot redirect anyone twice.
 */
export function takePendingInvite(now = Date.now(), storage: InviteStorage | null = safeLocalStorage()): string | null {
  const target = peekPendingInvite(now, storage);
  clearPendingInvite(storage);
  return target;
}

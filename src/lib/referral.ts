/**
 * The ONE definition of "somebody sent this person here".
 *
 * ⚠️ REFERRALS HAVE NEVER ONCE BEEN RECORDED, AND THIS FILE EXISTS BECAUSE OF THE SAME
 * TWO-SPELLINGS BUG `trusted-device.ts` WAS WRITTEN FOR. `Landing.tsx` wrote the captured code to
 * `sessionStorage['forgenta:ref']`; `Onboarding.tsx` read `sessionStorage['forged:ref']`. Nothing
 * ever wrote the key the reader read, so `profiles.referred_by` was never populated and the
 * Settings panel's "N joined via your link" could only ever render nothing. Measured on the live
 * database on 2026-08-18: 46 profiles, **0** with a referrer, 18 of them created in the previous
 * 90 days. Every referral anyone has ever clicked was dropped on the floor.
 *
 * ⚠️ THERE IS NO LEGACY MIGRATION HERE AND THAT IS DELIBERATE, NOT AN OVERSIGHT. The trusted-device
 * fix had to migrate `forged:` because BOTH spellings held real values. Here only the writer's
 * spelling was ever written and the reader's key has always been empty, so there is nothing to
 * carry over — a migration would be ceremony that implies data exists where none does.
 *
 * ⚠️ STORAGE MOVED FROM sessionStorage TO localStorage, WHICH IS A BEHAVIOUR CHANGE. A referral is
 * a click that happens once and a signup that happens whenever the person gets around to it;
 * sessionStorage dies with the tab, so it could only ever attribute a visitor who landed and signed
 * up without closing the tab. That is the minority of real referrals. The cost of a longer-lived
 * key is a stale code attaching to an unrelated signup months later, so attribution carries the
 * capture time and expires — see `REFERRAL_WINDOW_MS`.
 */

/** The one spelling of the key. Exported so a reader can never drift from the writer again. */
export const REFERRAL_KEY = 'forgenta:ref';

/**
 * How long a captured referral stays eligible to attribute. Thirty days is the conventional
 * affiliate window and, more to the point, it is short enough that a code left behind on a shared
 * or reused machine cannot silently claim a signup a season later.
 */
export const REFERRAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** What gets stored: the code plus WHEN it was captured, because the window needs an origin. */
export interface StoredReferral {
  code: string;
  at: number;
}

/**
 * A referral code is the first 8 characters of the referrer's uuid — that is what the Settings
 * panel builds its link from (`user.id.slice(0, 8)`), so it is always 8 lowercase hex characters.
 *
 * ⚠️ VALIDATION IS NOT DECORATION HERE. This value arrives from the query string, which anybody can
 * type, and its destination is a column this app later matches other users against. Anything that
 * is not the exact shape a real link produces is discarded at the door rather than written and
 * puzzled over later.
 */
export function isValidReferralCode(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}$/i.test(value);
}

/** The code a URL is offering, or null when it offers nothing usable. Pure. */
export function referralCodeFromSearch(search: string | URLSearchParams): string | null {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const asked = params.get('ref');
  return isValidReferralCode(asked) ? asked.toLowerCase() : null;
}

/**
 * Record a referral seen in a URL.
 *
 * ⚠️ FIRST CAPTURE WINS, and that is the deliberate choice between two defensible rules. If a
 * visitor arrives through Anna's link, wanders off, and comes back later through Ben's, the person
 * who actually introduced them to the product is Anna. Last-touch would also let anyone overwrite a
 * pending attribution simply by getting the visitor to load one more URL. An EXPIRED capture is
 * replaced, because at that point there is nothing left to protect.
 *
 * Returns the code now held, so a caller can tell whether anything was stored without re-reading.
 */
export function captureReferral(
  search: string | URLSearchParams,
  now: number = Date.now(),
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): string | null {
  const offered = referralCodeFromSearch(search);
  if (!offered) return readReferral(now, storage);

  const existing = readReferral(now, storage);
  if (existing) return existing;

  try {
    const record: StoredReferral = { code: offered, at: now };
    storage.setItem(REFERRAL_KEY, JSON.stringify(record));
  } catch {
    // A full, blocked or private-mode storage must never break the page a visitor landed on.
    // The referral is simply not attributed, which is the pre-existing behaviour and not a
    // regression — never an error in the visitor's face over a marketing detail.
  }
  return offered;
}

/**
 * The live referral code, or null when there is none, it is unreadable, or it has aged out.
 *
 * ⚠️ A MALFORMED OR EXPIRED RECORD RETURNS null RATHER THAN THROWING OR CLEARING. Reading is done
 * on render paths; a throw here would take down a page over a marketing detail, and a read that
 * quietly deletes makes the stored value depend on who looked at it.
 */
export function readReferral(
  now: number = Date.now(),
  storage: Pick<Storage, 'getItem'> = localStorage,
): string | null {
  try {
    const raw = storage.getItem(REFERRAL_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { code, at } = parsed as Partial<StoredReferral>;
    if (!isValidReferralCode(code) || typeof at !== 'number' || !Number.isFinite(at)) return null;
    if (now - at > REFERRAL_WINDOW_MS) return null;
    return code.toLowerCase();
  } catch {
    return null;
  }
}

/** Forget the captured referral. Called once it has been written to the profile. */
export function clearReferral(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  try {
    storage.removeItem(REFERRAL_KEY);
  } catch {
    // Nothing a user can act on. Worst case the code lingers until its window closes, and
    // `resolveReferrerForSignup` will not attribute it to an account that already has one.
  }
}

/**
 * The value to write to `profiles.referred_by` for a signing-up user, or null to write nothing.
 *
 * ⚠️ SELF-REFERRAL IS REJECTED HERE. A user's own link contains their own id prefix, and the
 * shortest path to it is their own Settings page — so pasting your link into your own browser and
 * signing up again is the FIRST thing anyone tries. It must count for nothing, and it has to be
 * caught before the write rather than reconciled afterwards.
 *
 * Kept pure and separate from storage so the rule is testable without a DOM.
 */
export function resolveReferrerForSignup(code: string | null, ownUserId: string | null | undefined): string | null {
  if (!isValidReferralCode(code)) return null;
  if (typeof ownUserId === 'string' && ownUserId.slice(0, 8).toLowerCase() === code.toLowerCase()) return null;
  return code.toLowerCase();
}

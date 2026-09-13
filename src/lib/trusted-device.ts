// The ONE definition of "this is my machine".
//
// Trusted devices existed before this file, but every consumer spelled the localStorage key
// itself — and two of them spelled it differently. `Auth.tsx` wrote `forgenta:trusted_device_id`
// while `Settings.tsx` read `forged:trusted_device_id`, so the Settings page could never recognize
// the device it was running on, and "remove this device" removed the wrong key. Both spellings are
// live in real localStorage today. The key lives here now, and the `forged:` variant is migrated
// on read rather than left to rot.
//
// WHY THE IDLE TIMEOUT READS THIS (2026-08-13). The web app signs users out after 10 idle minutes
// — a shared-computer defense. On a device the user has explicitly told us is theirs (the same
// trust that skips email 2FA at sign-in, verified against `profiles.trusted_devices`, 30-day
// expiry), a 10-minute leash is security theater at the cost of the product: Tre was signed out
// three times in one working day on his own desktop. Trusted device → long leash; anything else →
// the 10 minutes stands. The lock screen (`AppLockScreen`) is unchanged — passkey/PIN remains the
// native answer.

import { supabase } from '@/lib/supabase';
import { coalesce } from '@/lib/coalesce-request';

export const TRUSTED_DEVICE_KEY = 'forgenta:trusted_device_id';

/** The pre-rename spelling, still present in old profiles. Read once, migrated, never written. */
const LEGACY_TRUSTED_DEVICE_KEY = 'forged:trusted_device_id';

/** How long a trust grant lasts. Mirrors the 2FA-skip window in Auth. */
export const TRUST_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export interface TrustedDevice {
  device_id: string;
  name: string;
  trusted_at: string;
  last_seen: string;
}

/**
 * This device's id, migrating the legacy key when it is the only one present.
 *
 * Migration is on READ because there is no startup hook every surface shares; the first consumer
 * to ask performs it. Idempotent, and never invents an id.
 */
export function getTrustedDeviceId(): string | null {
  try {
    const current = localStorage.getItem(TRUSTED_DEVICE_KEY);
    if (current) return current;
    const legacy = localStorage.getItem(LEGACY_TRUSTED_DEVICE_KEY);
    if (legacy) {
      localStorage.setItem(TRUSTED_DEVICE_KEY, legacy);
      localStorage.removeItem(LEGACY_TRUSTED_DEVICE_KEY);
      return legacy;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Whether a trust record is still inside its lifetime. Pure, so the expiry rule is testable.
 *
 * ⚠️ MEASURED FROM THE LAST TIME THE DEVICE WAS SEEN, NOT FROM WHEN IT WAS GRANTED.
 *
 * It used to read `trusted_at` alone, which meant a phone in DAILY USE went quietly untrusted
 * exactly 30 days after it was trusted — and dropped from the 12-hour idle leash back to the
 * 10-minute one with no prompt, no warning and nothing on screen to explain it. Measured
 * 2026-09-06 on Tre's own profile: iPhone `trusted_at` 2026-07-13 (expired 08-12, 55 days ago)
 * and Windows PC `trusted_at` 2026-08-05 (expired 09-04). BOTH his devices had silently fallen
 * back to the 10-minute timeout, which is exactly his report that the app "keeps logging out".
 *
 * Sliding the window on use keeps the security property that matters — a device nobody has
 * touched for 30 days loses its trust — while not punishing the device someone uses every day.
 * A record with no usable `last_seen` falls back to `trusted_at`, so old rows keep working.
 */
export function isTrustRecordFresh(
  device: Pick<TrustedDevice, 'trusted_at'> & Partial<Pick<TrustedDevice, 'last_seen'>>,
  now: number,
): boolean {
  const grantedAt = new Date(device.trusted_at).getTime();
  const seenAt = device.last_seen ? new Date(device.last_seen).getTime() : NaN;
  // The LATER of the two: a grant is fresh if either the grant or the last sighting is recent.
  const candidates = [grantedAt, seenAt].filter(t => Number.isFinite(t));
  if (candidates.length === 0) return false;
  return now - Math.max(...candidates) < TRUST_LIFETIME_MS;
}

/**
 * How stale `last_seen` must be before a sighting is written back.
 *
 * `isDeviceTrusted` runs on every session start, and a write on each one would be pure chatter on
 * a row nothing reads that often. Half a day keeps the sliding window accurate to well inside the
 * 30-day lifetime while costing at most two writes a day.
 */
export const TOUCH_THROTTLE_MS = 12 * 60 * 60 * 1000;

/** Whether this sighting is worth persisting, given what the record already says. */
export function shouldTouchLastSeen(
  device: Pick<TrustedDevice, 'last_seen'> | undefined,
  now: number,
): boolean {
  if (!device) return false;
  const seenAt = new Date(device.last_seen).getTime();
  if (!Number.isFinite(seenAt)) return true;
  return now - seenAt >= TOUCH_THROTTLE_MS;
}

/**
 * Three answers, because two of them were being collapsed into one.
 *
 * `'untrusted'` means THE PROFILE WAS READ and this device is not on it. `'unknown'` means the
 * read did not happen — offline, a 504, a timeout. They are not the same fact and they must not
 * produce the same behaviour.
 */
export type DeviceTrust = 'trusted' | 'untrusted' | 'unknown';

/**
 * Whether THIS device is currently trusted by `userId`, distinguishing "no" from "could not look".
 *
 * ⚠️ WHY THIS EXISTS. `isDeviceTrusted` returns a boolean and maps every failure to `false`, which
 * is right for the 2FA gate — a prompt you cannot skip is a safe failure — and wrong for the idle
 * leash, where it silently shortens a trusted browser's session from 12 hours to 10 minutes and
 * then tells the user they were signed out "due to 10 minutes of inactivity". True, and a
 * misleading reason: the cause was one profile read that did not come back.
 *
 * That is not hypothetical here. This instance's `profiles` latency is BIMODAL — median 347ms
 * against a p95 of 5082ms, with 504s in the same 24 hours (ask 73df5d2b) — so the read failing
 * transiently is an ordinary event, not an edge case, and it lands on the one user-visible
 * behaviour people notice most: being logged out.
 *
 * ⚠️ THE ERROR IS READ, NOT JUST THE DATA. `.single()` reports failure in `error` and leaves
 * `data` null, so a caller that destructures only `data` sees an empty device list and concludes
 * "not trusted" — the same wrong answer, reached without anything throwing.
 */
export async function readDeviceTrust(userId: string): Promise<DeviceTrust> {
  const deviceId = getTrustedDeviceId();
  // A device with no local pointer has genuinely never been trusted. That IS a reading.
  if (!deviceId) return 'untrusted';
  try {
    const { data, error } = await coalesce(`profiles:trusted_devices:${userId}`, async () =>
      await supabase.from('profiles').select('trusted_devices').eq('user_id', userId).single());
    if (error || !data) return 'unknown';
    const devices = (data.trusted_devices as TrustedDevice[] | null) ?? [];
    const device = devices.find(d => d.device_id === deviceId);
    if (!device) return 'untrusted';
    const now = Date.now();
    const fresh = isTrustRecordFresh(device, now);
    if (fresh && shouldTouchLastSeen(device, now)) {
      void touchTrustedDevice(userId, deviceId, devices, now);
    }
    // An EXPIRED grant is a real reading of "not trusted any more", not an unknown.
    return fresh ? 'trusted' : 'untrusted';
  } catch {
    return 'unknown';
  }
}

/**
 * Whether THIS device is currently trusted by `userId` — the same test Auth runs to skip 2FA.
 *
 * Verified against the profile rather than trusting localStorage alone: the localStorage id is
 * only a pointer, and revoking a device from Settings must take effect here without touching this
 * machine. Fails closed — any error reads as "not trusted".
 *
 * ⚠️ KEPT FAIL-CLOSED ON PURPOSE. Callers that gate a SECURITY decision want exactly this: an
 * unreadable profile must not skip 2FA. Only the idle leash needs the third state, and it uses
 * `readDeviceTrust` directly — see AuthContext. Do not "simplify" this to return `unknown`.
 */
export async function isDeviceTrusted(userId: string): Promise<boolean> {
  return (await readDeviceTrust(userId)) === 'trusted';
}

// The old boolean body lived here and was deleted on 2026-09-13 rather than kept beside its
// replacement: it read only `data` and mapped every failure to `false`, which is the defect.
// Its two behaviours that DID matter are preserved verbatim in `readDeviceTrust` above — the
// coalesced-not-cached round trip (a remembered answer keeps a revoked device trusted) and the
// unawaited touch that only ever slides a still-fresh grant.

/**
 * Record that this device was seen, so an actively used device does not expire out from under its
 * owner. Swallows its own errors — the caller has already returned.
 */
async function touchTrustedDevice(
  userId: string,
  deviceId: string,
  devices: TrustedDevice[],
  now: number,
): Promise<void> {
  try {
    const seen = new Date(now).toISOString();
    const next = devices.map(d => (d.device_id === deviceId ? { ...d, last_seen: seen } : d));
    await supabase.from('profiles').update({ trusted_devices: next as never }).eq('user_id', userId);
  } catch {
    /* a missed sighting costs at most one throttle window */
  }
}

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
 * Whether THIS device is currently trusted by `userId` — the same test Auth runs to skip 2FA.
 *
 * Verified against the profile rather than trusting localStorage alone: the localStorage id is
 * only a pointer, and revoking a device from Settings must take effect here without touching this
 * machine. Fails closed — any error reads as "not trusted".
 */
export async function isDeviceTrusted(userId: string): Promise<boolean> {
  const deviceId = getTrustedDeviceId();
  if (!deviceId) return false;
  try {
    const { data } = await supabase.from('profiles').select('trusted_devices').eq('user_id', userId).single();
    const devices = (data?.trusted_devices as TrustedDevice[] | null) ?? [];
    const device = devices.find(d => d.device_id === deviceId);
    if (!device) return false;
    const now = Date.now();
    const fresh = isTrustRecordFresh(device, now);

    // Slide the window on a device that is genuinely still in use. Best effort and deliberately
    // NOT awaited: the answer this function exists to give must not wait on a write, and a failed
    // touch must never turn a trusted device into an untrusted one.
    //
    // Only when the record is still fresh. Touching an EXPIRED grant would silently renew trust
    // that has already lapsed, which is the one thing the lifetime exists to prevent — re-trusting
    // is a decision for the 2FA flow, not a side effect of a lookup.
    if (fresh && shouldTouchLastSeen(device, now)) {
      void touchTrustedDevice(userId, deviceId, devices, now);
    }
    return fresh;
  } catch {
    return false;
  }
}

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

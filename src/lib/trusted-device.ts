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

/** Whether a trust record is still inside its lifetime. Pure, so the expiry rule is testable. */
export function isTrustRecordFresh(device: Pick<TrustedDevice, 'trusted_at'>, now: number): boolean {
  const grantedAt = new Date(device.trusted_at).getTime();
  if (!Number.isFinite(grantedAt)) return false;
  return now - grantedAt < TRUST_LIFETIME_MS;
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
    return isTrustRecordFresh(device, Date.now());
  } catch {
    return false;
  }
}

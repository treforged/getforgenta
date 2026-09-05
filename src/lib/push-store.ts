/**
 * The Supabase-backed `PushStore` — the only place a device token is written.
 *
 * Kept apart from `push-registration.ts` on purpose: that module holds the OS dance and takes a
 * store as an argument, so it can be exercised with a fake one and has no dependency on the
 * database client. This file is the small real implementation.
 *
 * RLS does the ownership check, so `user_id` is not passed in from the caller — it comes from
 * the session. A client that could name its own `user_id` could register a token against
 * somebody else's account and receive their notifications.
 */
import { supabase } from '@/integrations/supabase/client';
import type { DeviceTokenRow, PushStore } from '@/lib/push-registration';

/** Where the last token this device registered is remembered, so sign-out can revoke it. */
const LAST_TOKEN_KEY = 'forgenta:push_token';

export function readLastPushToken(): string | null {
  try {
    return localStorage.getItem(LAST_TOKEN_KEY);
  } catch {
    // Private mode, cleared site data, a browser refusing storage. Not worth failing over.
    return null;
  }
}

export const supabasePushStore: PushStore = {
  /**
   * Upsert on `(platform, token)`, which is the unique index.
   *
   * ⚠️ UPSERT, NOT INSERT. The OS hands back the SAME token on most launches, so an insert
   * would either error every time or accumulate duplicate rows — and a duplicate row means one
   * phone receiving the same notification twice, which is the fastest way to get an app muted.
   *
   * `revoked_at: null` is set explicitly: a device that signed out and signed back in must come
   * back to life rather than stay retired on a row that already exists.
   */
  async saveToken(row: DeviceTokenRow): Promise<void> {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return;

    const { error } = await supabase.from('device_tokens').upsert({
      user_id: userId,
      platform: row.platform,
      token: row.token,
      environment: row.environment,
      last_seen_at: new Date().toISOString(),
      revoked_at: null,
    }, { onConflict: 'platform,token' });

    if (error) {
      console.error('[push] could not save device token:', error.message);
      return;
    }

    try {
      localStorage.setItem(LAST_TOKEN_KEY, row.token);
    } catch {
      // The row is saved, which is the part that matters. Losing the local copy only means
      // sign-out cannot revoke it here, and the next failed send retires it instead.
    }
  },

  /** Retire the row, and forget the local copy so a later sign-out cannot revoke it twice. */
  async revokeToken(token: string): Promise<void> {
    const { error } = await supabase
      .from('device_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('token', token);

    if (error) console.error('[push] could not revoke device token:', error.message);

    try {
      localStorage.removeItem(LAST_TOKEN_KEY);
    } catch {
      // See above.
    }
  },
};

/**
 * Tell the server which day "today" is for this person.
 *
 * ⚠️ WITHOUT THIS, EVERY SERVER-SIDE NOTIFICATION IS WRONG FOR MOST OF THE WORLD.
 * `learn-streak.ts` buckets reads by the LOCAL calendar day on purpose — two reads either side
 * of midnight UTC are the same evening for a reader in New York. On a device "local" is the
 * reader's own clock. A Deno edge function has no such clock; it runs in UTC. So a server that
 * does not know the zone computes a different day from the phone, and:
 *
 *   - the streak in a push notification disagrees with the streak on the screen, and
 *   - `STREAK_RISK_HOUR = 18` — 6pm, late enough for "ends tonight" to be true — becomes 2pm in
 *     New York, warning someone four hours early about a streak in no danger.
 *
 * There is nothing to infer this from server-side: a row has no coordinates, no phone number and
 * no address, and a last-seen timestamp says nothing about where the seeing happened. The
 * browser knows exactly. So the browser says.
 *
 * ⚠️ AN IANA NAME, NEVER AN OFFSET. An offset does not observe daylight saving, so it is wrong
 * for roughly half the year wherever DST applies. `safeZone` on the server rejects one even
 * though `Intl` would accept it.
 */
import { supabase } from '@/integrations/supabase/client';

/** This browser's IANA zone, or null when the runtime will not say. */
export function detectTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Guard the same shape the server guards: a name starts with a letter, an offset does not.
    return zone && /^[A-Za-z]/.test(zone) ? zone : null;
  } catch {
    return null;
  }
}

/**
 * Store it, but only when it has actually changed.
 *
 * A write on every launch would be a pointless round trip for a value that changes when someone
 * gets on a plane. Reading first is cheaper than writing, and it keeps `updated_at` meaning
 * something.
 *
 * Best effort throughout: failing to record a timezone must never interrupt a sign-in. The cost
 * of not knowing is a notification an hour out; the cost of throwing here is a person who cannot
 * get into their account.
 */
export async function reportTimezone(userId: string): Promise<void> {
  const zone = detectTimezone();
  if (!zone) return;

  try {
    const { data } = await supabase
      .from('profiles')
      .select('timezone')
      .eq('user_id', userId)
      .maybeSingle();

    if (data?.timezone === zone) return;

    await supabase.from('profiles').update({ timezone: zone }).eq('user_id', userId);
  } catch {
    // See above. Deliberately silent.
  }
}

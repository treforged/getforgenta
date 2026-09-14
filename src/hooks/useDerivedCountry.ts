// Fills `profiles.country_code` from what the browser already tells every website. Never asks.
//
// Tre, 2026-09-14, via Sam: "do what you need to do... I just want it done." Sam made the privacy
// call and this implements it as made: derive from the locale and the IANA time zone, store a
// coarse ISO-3166-1 alpha-2 code, and never touch IP geolocation.
//
// ⚠️ WHY A CLIENT HOOK AND NOT A BACKFILL, which was the original plan and was the cheaper one.
// The idea was to derive from `profiles.timezone`, already collected, so nobody would have to
// return for the column to fill. Measured on 2026-09-14: `timezone` is NULL for 45 of 49 profiles.
// A backfill would have covered FOUR PEOPLE and reported success — a migration that looks like
// full coverage and delivers almost none. So the derivation happens here, in a live browser that
// definitely has the signals, and coverage grows as people open the app. Slower, and true.
//
// ⚠️ IT WRITES ONCE AND ONLY INTO A BLANK. If `country_code` already holds a value, this hook does
// nothing — it never overwrites and it never re-derives. Two reasons, and the second is the one
// that matters:
//   1. A user may correct their country by hand, and a derivation that runs every session would
//      silently undo that correction on their next visit.
//   2. CLEARING THE FIELD IS THE OPT-OUT. If this re-derived whenever it found a null, opting out
//      would last exactly until the next page load, and the control would appear to be broken
//      while actually being overwritten. An opt-out that undoes itself is worse than none, because
//      the user believes they have left.
// Which means: once a user clears it deliberately, `optedOut` below is what keeps it cleared.
import { useEffect, useRef } from 'react';
import { useProfile } from '@/hooks/useSupabaseData';
import { useDemo } from '@/contexts/DemoContext';
import { deriveCountry, readCountrySignals } from '@/lib/derive-country';

/**
 * A profile row carries this flag once the user has deliberately left the country board, so that a
 * null `country_code` can be told apart from one that has simply never been filled. Stored inside
 * `tour_flags`, which is this app's existing boolean map — same mechanism as the what's-new record
 * — so there is no migration for a single boolean.
 */
export const COUNTRY_OPT_OUT_FLAG = 'country_board_opted_out';

export function useDerivedCountry(): void {
  const { isDemo } = useDemo();
  const { data: profile, loading, update } = useProfile();
  // One attempt per mount. `update.mutate` is fire-and-forget and the profile takes a moment to
  // refetch, so without this the effect can re-enter and issue the same write several times.
  const attempted = useRef(false);

  useEffect(() => {
    if (isDemo || loading || !profile || attempted.current) return;

    const flags = (profile.tour_flags as Record<string, boolean> | null) ?? {};
    const optedOut = flags[COUNTRY_OPT_OUT_FLAG] === true;
    const existing = (profile as { country_code?: string | null }).country_code ?? null;

    // Already answered, either way. Nothing to do, and nothing to undo.
    if (optedOut || existing) return;

    const derived = deriveCountry(readCountrySignals());
    // ⚠️ NO FALLBACK. `null` means the browser gave nothing conclusive, and the right response is
    // to leave the field empty rather than to guess. A wrong country on a board that publishes
    // standing to other people puts somebody in a cohort of strangers under a flag that is not
    // theirs — materially worse than not appearing at all.
    if (!derived) return;

    attempted.current = true;
    update.mutate({ country_code: derived });
    // `update` is a stable mutation object; including it would re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo, loading, profile]);
}

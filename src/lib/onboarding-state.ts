// The ONE definition of "this user has finished setting up".
//
// Onboarding had three surfaces and TWO completion stores. The `/onboarding` route wrote
// `localStorage['forged:onboarding_done_<uid>']` and `App.tsx` gated on it; the Dashboard's modal
// wizard wrote `profiles.onboarding_completed` and gated on that; the checklist wrote the profile
// flag too. Finish one and the other still believed you had never started, so users who had just
// completed setup were handed a second setup. The stores are merged here.
//
// **The profile is truth** — it is cross-device, and a phone should not re-onboard someone who set
// up on a laptop. The localStorage key survives as a write-through CACHE, for the render gap before
// the profile query resolves, and as a MIGRATION source: every user who only ever finished the
// route wizard has the local key and a profile flag of `false`. That combination reads as done, and
// the profile is written up on the spot. Same on-read migration idiom as `trusted-device.ts`.
//
// HONESTY (the rule that shapes the types below): a profile we could not READ is missing evidence,
// not evidence of "not done". `null` therefore never gates anyone — being re-run through a wizard
// you already finished is a worse failure than a checklist nudging someone who is already set up.

import { supabase } from '@/integrations/supabase/client';
import { CURRENT_RELEASE, whatsNewFlag } from '@/lib/whats-new';

/**
 * The key `App.tsx` has always gated on. The `forged:` spelling is deliberately kept: renaming it
 * would orphan the flag on every device that already has one and re-run those users' onboarding.
 */
export function onboardingCacheKey(userId: string): string {
  return `forged:onboarding_done_${userId}`;
}

/** Whether this device remembers finishing. Storage errors read as "no memory", never as done. */
export function readOnboardingCache(userId: string): boolean {
  try {
    return localStorage.getItem(onboardingCacheKey(userId)) !== null;
  } catch {
    return false;
  }
}

export function writeOnboardingCache(userId: string): void {
  try {
    localStorage.setItem(onboardingCacheKey(userId), '1');
  } catch {
    // A device that cannot cache still works: the profile flag is the source of truth.
  }
}

export function clearOnboardingCache(userId: string): void {
  try {
    localStorage.removeItem(onboardingCacheKey(userId));
  } catch {
    // Nothing to do — see writeOnboardingCache.
  }
}

/** Where `completed` came from. `unknown` means the profile has not been read (yet, or at all). */
export type OnboardingSource = 'profile' | 'cache' | 'unknown';

export interface OnboardingResolution {
  /** True only on positive evidence that onboarding finished. */
  completed: boolean;
  source: OnboardingSource;
  /** Send this user to `/onboarding`. Only ever true on a positive "not done" reading. */
  gate: boolean;
  /** The profile says done and this device does not know it yet. */
  writeCache: boolean;
  /** This device finished before the profile flag existed — migrate it up. */
  writeProfile: boolean;
}

/**
 * Merge the two stores.
 *
 * @param profileCompleted `profiles.onboarding_completed`; `null`/`undefined` = not read (a failed
 *                         fetch or a query still in flight), which is NOT the same as `false`.
 * @param cacheDone        whether this device holds the legacy/write-through flag.
 */
export function resolveOnboardingState(
  profileCompleted: boolean | null | undefined,
  cacheDone: boolean,
): OnboardingResolution {
  if (profileCompleted === true) {
    return { completed: true, source: 'profile', gate: false, writeCache: !cacheDone, writeProfile: false };
  }
  if (profileCompleted === false) {
    return cacheDone
      // Finished the route wizard before the profile flag was the store. Trust it, then migrate.
      ? { completed: true, source: 'cache', gate: false, writeCache: false, writeProfile: true }
      : { completed: false, source: 'profile', gate: true, writeCache: false, writeProfile: false };
  }
  // Unknown. Fall back to the cache for the render, and write nothing either way.
  return cacheDone
    ? { completed: true, source: 'cache', gate: false, writeCache: false, writeProfile: false }
    : { completed: false, source: 'unknown', gate: false, writeCache: false, writeProfile: false };
}

/**
 * Ceiling on how long the route gate waits for the profile read. A request that hangs (no response,
 * no error) otherwise leaves the query pending forever and a fresh device parked on the gate's
 * spinner — the one state `resolveOnboardingState` can never rescue, because it is never asked.
 */
export const ONBOARDING_FETCH_TIMEOUT_MS = 10_000;

/**
 * `profiles.onboarding_completed`, or `null` when it could not be read.
 *
 * A missing row reads as `false`: a signed-in user with no profile is a brand-new account and must
 * still see the wizard. Only an actual error is unknown — supabase-js RETURNS errors rather than
 * throwing them, and collapsing that branch into `false` is exactly what would re-gate a finished
 * user on a flaky connection.
 *
 * The read is raced against `ONBOARDING_FETCH_TIMEOUT_MS` and a hung request resolves `null`: a
 * bounded unknown lets the user through (see the honesty rule above), an unbounded spinner helps
 * no one.
 */
export async function fetchOnboardingCompleted(userId: string): Promise<boolean | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ONBOARDING_FETCH_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([
      supabase
        .from('profiles')
        .select('onboarding_completed')
        .eq('user_id', userId)
        .maybeSingle(),
      timedOut,
    ]);
    if (result === null) return null;
    const { data, error } = result;
    if (error) return null;
    return data?.onboarding_completed === true;
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Which code path set `onboarding_completed`. Four call sites write the flag and they mean four
 * different things, so a bare boolean cannot be read as a funnel: `legacy_name` and `checklist`
 * both mark an account complete having pressed NOTHING in the wizard. Only `wizard` means a
 * person walked it.
 *
 * `legacy_name` WAS a member and was RETIRED on 2026-09-15 with the display_name bounce it
 * described. It was never written to a single row (33 profiles, all NULL at removal), so no
 * stored value is orphaned by dropping it. Do not re-add it without re-adding a writer - the
 * gate requires every declared path to be wired, which is how the removal was caught.
 *
 * NULL in the database means the flag predates this attribution (7 accounts at 2026-09-15). It is
 * deliberately not backfilled - a guessed attribution is indistinguishable from a measured one.
 */
export type OnboardingCompletionPath =
  /**
   * Walked the wizard and pressed finish. The only value that means onboarded.
   * NOTE: this one is written DIRECTLY by `Onboarding.handleFinish`, not through this
   * function - completion rides along with that profile update so the two cannot disagree.
   */
  | 'wizard'
  /** Pressed "skip" in the wizard. A deliberate choice, and NOT the same as finishing it. */
  | 'skipped'
  /** The dashboard checklist computed all four items done from real data. Zero clicks. */
  | 'checklist'
  /** This device's cache said complete, so the profile flag was written back to agree. */
  | 'cache_restore';

/**
 * Record completion in both stores. The cache is written ONLY after the profile write lands, so a
 * failed save can never leave this device believing setup is finished.
 *
 * `via` is REQUIRED rather than defaulted: a default is what lets a new call site silently join
 * the population that already made this column unreadable.
 */
export async function markOnboardingComplete(
  userId: string,
  via: OnboardingCompletionPath,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await boundedWrite(supabase
      .from('profiles')
      .update({ onboarding_completed: true, onboarding_completed_via: via })
      .eq('user_id', userId));
    if (error) return { ok: false, error: (error as { message: string }).message };
    writeOnboardingCache(userId);
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Record the CURRENT What's New release as seen, for an account leaving the wizard.
 *
 * ⚠️ WHY THE WIZARD DOES THIS AND NOT THE DIALOG (ask 47a25afa). `WhatsNewDialog` records a
 * not-yet-onboarded user silently - but it is mounted only in the Dashboard, and the wizard runs on
 * /onboarding. So that silent branch never ran for anybody who onboarded through the wizard: they
 * landed on Home already onboarded, with no flag, and got the tour AND a catch-up card about a
 * release they never used, stacked. Suppressing the dialog until the tour is done was the other
 * option and is wrong: 2 onboarded accounts have no `new_user_done` (SQL, 2026-10-05), and they
 * would never see a release again.
 *
 * Read-merge-write, because `tour_flags` is a shared map and a blind write would erase the tour's
 * own flags. Best effort: a failure here costs one extra dialog, never a lost setup, so it never
 * blocks the exit.
 */
/**
 * How long the wizard waits for the release flag before it moves on anyway (ask 769b6e40).
 * Measured 2026-10-06: on 1 of 2 real first-run walks the flag PATCH LANDED in the database but its
 * response never came back, and supabase-js has no timeout - so "See your plan" stayed in its saving
 * state for good, with the user's profile already saved. The flag is bookkeeping; it must never be
 * the thing a new user waits on.
 */
export const RELEASE_SEEN_WAIT_MS = 4_000;

/** Resolves with `promise`, or with `fallback` once `ms` passes - whichever comes first. */
export function settleWithin<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * How long a SAVE that the next screen waits on may take before the user is told (Sam, ask 61c40702).
 * Longer than the flag's bound because this is the user's data, and a slow save that lands is
 * better than a fast error. But never for ever: supabase-js has no timeout of its own.
 */
export const SAVE_WAIT_MS = 15_000;
export const SAVE_TIMEOUT_MESSAGE = 'Saving is taking too long. Check your connection and try again.';

/** A supabase write that has not answered within `ms` resolves as an error with `timedOut: true`. */
export function boundedWrite<T extends { error: unknown }>(
  query: PromiseLike<T>,
  ms = SAVE_WAIT_MS,
): Promise<T | { error: { message: string }; timedOut: true }> {
  return settleWithin<T | { error: { message: string }; timedOut: true }>(
    Promise.resolve(query), ms, { error: { message: SAVE_TIMEOUT_MESSAGE }, timedOut: true },
  );
}

/** The flag write, bounded: false if it fails OR has not answered within `ms`. */
export function recordCurrentReleaseSeen(userId: string, ms = RELEASE_SEEN_WAIT_MS): Promise<boolean> {
  return settleWithin(writeCurrentReleaseSeen(userId), ms, false);
}

async function writeCurrentReleaseSeen(userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('tour_flags')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return false;
    const flags = (data.tour_flags as Record<string, boolean> | null) ?? {};
    const key = whatsNewFlag(CURRENT_RELEASE.version);
    if (flags[key] === true) return true;
    const { error: writeError } = await supabase
      .from('profiles')
      .update({ tour_flags: { ...flags, [key]: true } })
      .eq('user_id', userId);
    return !writeError;
  } catch {
    return false;
  }
}

/**
 * Apply a resolution's writes. Fire-and-forget by design: this is bookkeeping behind a decision
 * already made for the render, and neither write changes what the user sees now.
 */
export function applyOnboardingResolution(userId: string, resolution: OnboardingResolution): void {
  if (resolution.writeCache) writeOnboardingCache(userId);
  if (resolution.writeProfile) void markOnboardingComplete(userId, 'cache_restore');
}

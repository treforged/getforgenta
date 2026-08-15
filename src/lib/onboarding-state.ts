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
 * `profiles.onboarding_completed`, or `null` when it could not be read.
 *
 * A missing row reads as `false`: a signed-in user with no profile is a brand-new account and must
 * still see the wizard. Only an actual error is unknown — supabase-js RETURNS errors rather than
 * throwing them, and collapsing that branch into `false` is exactly what would re-gate a finished
 * user on a flaky connection.
 */
export async function fetchOnboardingCompleted(userId: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('onboarding_completed')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return null;
    return data?.onboarding_completed === true;
  } catch {
    return null;
  }
}

/**
 * Record completion in both stores. The cache is written ONLY after the profile write lands, so a
 * failed save can never leave this device believing setup is finished.
 */
export async function markOnboardingComplete(userId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('profiles')
      .update({ onboarding_completed: true })
      .eq('user_id', userId);
    if (error) return { ok: false, error: error.message };
    writeOnboardingCache(userId);
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Apply a resolution's writes. Fire-and-forget by design: this is bookkeeping behind a decision
 * already made for the render, and neither write changes what the user sees now.
 */
export function applyOnboardingResolution(userId: string, resolution: OnboardingResolution): void {
  if (resolution.writeCache) writeOnboardingCache(userId);
  if (resolution.writeProfile) void markOnboardingComplete(userId);
}

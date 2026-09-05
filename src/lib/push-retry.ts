import { Capacitor } from '@capacitor/core';

// ⚠️ `push-registration` AND `push-store` ARE IMPORTED LAZILY, INSIDE THE LISTENER. `push-store`
// pulls in the Supabase client at module scope, so a static import would drag the whole client
// into anything that merely wants the decision below — including a unit test, which then cannot
// run at all. The guard is the part worth testing and it must stay importable on its own.

/**
 * TRY AGAIN WHEN THE APP COMES BACK, FOR ANYBODY WHOSE REGISTRATION NEVER SUCCEEDED.
 *
 * ⚠️ THE DEFECT THIS FIXES IS NOT ABOUT ONE PHONE. Registration fires in exactly one place —
 * `AuthContext`, on `SIGNED_IN || INITIAL_SESSION` — which means **it only runs when the session
 * is established.** iOS routinely RESUMES an app from memory rather than cold-starting it, and a
 * resumed app does not re-run sign-in. So:
 *
 *   • A person cannot retry by opening the app. Tapping the icon usually resumes; only a
 *     force-quit produces the cold start that re-runs sign-in.
 *   • **Worse: a device whose registration fails ONCE may never try again.** No token, no
 *     notifications, and nothing re-attempts until they happen to sign out and back in — which
 *     almost nobody does. Measured 2026-09-05: 48 candidates the sender would have notified, all
 *     unreachable. Any of them could be stuck in exactly that state permanently.
 *
 * A feature that works on a clean install and never recovers is not finished, so this is the
 * recovery half.
 *
 * ── WHY IT CANNOT BECOME A LOOP ─────────────────────────────────────────────
 * Three guards, and each closes a different way of spinning:
 *   1. **Native only.** There is nothing to register on the web.
 *   2. **Only when there is no token already.** A device that succeeded never retries; the local
 *      marker written by `saveToken` is the check.
 *   3. **A cooldown between attempts.** An app that is backgrounded and foregrounded repeatedly —
 *      which is the normal way a phone is used — must not fire a registration each time.
 *
 * ⚠️ IT NEVER PROMPTS. `registerForPush` defaults to `prompt: false`, so this only completes a
 * registration for somebody who has ALREADY granted permission. The one-shot iOS prompt is spent
 * deliberately, at the notification switch, and never by a background resume.
 */

/** Minimum gap between resume-triggered attempts. Long enough that ordinary app switching is free. */
export const PUSH_RETRY_COOLDOWN_MS = 5 * 60 * 1000;

let lastAttemptAt = 0;

/** Test seam: forget the cooldown. */
export function resetPushRetryCooldown(): void {
  lastAttemptAt = 0;
}

/**
 * Whether a resume should re-attempt registration.
 *
 * Pure and exported so the decision is testable without a device — the thing it guards is a
 * network call on somebody's phone, and "does it loop" is not a question to answer by reasoning.
 */
export function shouldRetryPushRegistration(opts: {
  isNative: boolean;
  hasToken: boolean;
  now: number;
  lastAttempt: number;
}): boolean {
  if (!opts.isNative) return false;
  if (opts.hasToken) return false;
  return opts.now - opts.lastAttempt >= PUSH_RETRY_COOLDOWN_MS;
}

/**
 * Start listening for the app becoming active. Returns a teardown.
 *
 * Safe to call when the plugin is unavailable: it resolves to a no-op rather than throwing, on the
 * same principle as everything else in this path — a diagnosis or a retry must never become a
 * second way for the app to fail.
 */
export async function startPushRetryOnResume(): Promise<() => void> {
  if (!Capacitor.isNativePlatform()) return () => {};

  try {
    const [{ App }, { registerForPush }, { readLastPushToken, supabasePushStore }] = await Promise.all([
      import('@capacitor/app'),
      import('@/lib/push-registration'),
      import('@/lib/push-store'),
    ]);
    const handle = await App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      const now = Date.now();
      if (!shouldRetryPushRegistration({
        isNative: true,
        hasToken: !!readLastPushToken(),
        now,
        lastAttempt: lastAttemptAt,
      })) return;

      lastAttemptAt = now;
      // Never prompts; see the header. A failure here is recorded by `registerForPush` itself.
      void registerForPush(supabasePushStore).catch(() => {});
    });
    return () => { void handle.remove(); };
  } catch {
    return () => {};
  }
}

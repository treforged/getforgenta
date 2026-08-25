/**
 * What the app does about its session when it comes back after being away.
 *
 * ⚠️ WHY THIS EXISTS RATHER THAN LEANING ON supabase-js. The client already registers its own
 * `visibilitychange` handler and restarts the refresh ticker from it (`GoTrueClient
 * ._handleVisibilityChange`), and on desktop web that is enough. Inside a Capacitor WKWebView it is
 * not: iOS suspends the web content process while the app is backgrounded, so the interval that
 * would have refreshed the token never ticks, and `visibilitychange` is not a signal that can be
 * relied on to arrive when the app is brought back. `appStateChange` from `@capacitor/app` is, so on
 * native the recovery is driven from there instead. See `ResumeRecovery`.
 *
 * ⚠️ EVERY STEP IS BOUNDED BY A WALL CLOCK. A probe that hangs is the failure being fixed here, so
 * it must not be reachable from the fix. Nothing in this file awaits something that can take
 * forever, and the "I could not tell" answer is a named outcome rather than a silent pass.
 */

import type { Session } from '@supabase/supabase-js';

/**
 * How long the app has to have been away before its session is worth re-resolving.
 *
 * An app-switch to read a text message is not a stale session, and probing on every one of those
 * would put a network round trip in front of a user who never left. A minute is well short of the
 * token lifetime and well past the flick-to-another-app case.
 */
export const RESUME_STALE_MS = 60_000;

/** Ceiling on each network step of the resume probe. */
export const RESUME_PROBE_TIMEOUT_MS = 8_000;

/** A token this close to expiry counts as already stale, so the refresh happens before the 401. */
export const RESUME_EXPIRY_MARGIN_MS = 60_000;

/**
 * What the resume probe found.
 *
 * `unreachable` is deliberately NOT folded into `signed-out`. A refresh that failed because nothing
 * answered is not a refresh that failed because the token is gone, and signing someone out for
 * being on a train is the worse of the two mistakes.
 */
export type ResumeOutcome = 'skipped' | 'active' | 'refreshed' | 'signed-out' | 'unreachable';

/** The slice of `supabase.auth` the probe uses. Narrowed so a test can stand in for it. */
export interface ResumeAuth {
  getSession: () => Promise<{ data: { session: Session | null }; error: unknown }>;
  refreshSession: () => Promise<{ data: { session: Session | null }; error: unknown }>;
}

type ProbeResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'failed'; error: unknown }
  | { status: 'timeout' };

/**
 * Runs one step of the probe under a deadline.
 *
 * The work is collapsed into a promise that never rejects before it is raced, so a rejection that
 * lands AFTER the deadline has already been declared cannot surface as an unhandled rejection.
 */
async function probe<T>(work: () => Promise<T>, ms: number): Promise<ProbeResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled: Promise<ProbeResult<T>> = (async () => {
    try {
      return { status: 'ok' as const, value: await work() };
    } catch (error) {
      return { status: 'failed' as const, error };
    }
  })();
  const clock = new Promise<ProbeResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'timeout' }), ms);
  });
  try {
    return await Promise.race([settled, clock]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Whether a failed refresh means "nothing answered" rather than "the token is no longer valid".
 * supabase-js marks the first kind with `AuthRetryableFetchError`, and removes the session itself
 * for the second (`GoTrueClient._callRefreshToken`), which is what puts the app on `/auth`.
 */
function isNetworkFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AuthRetryableFetchError'
  );
}

/**
 * Re-resolves the session after the app has been away, and says which of the five things happened.
 *
 * `awayMs` is how long the app was backgrounded or hidden. `now` is injected so the expiry
 * arithmetic is testable without moving the clock.
 */
export async function recoverSession(
  auth: ResumeAuth,
  awayMs: number,
  now: number = Date.now(),
): Promise<ResumeOutcome> {
  if (awayMs < RESUME_STALE_MS) return 'skipped';

  const read = await probe(() => auth.getSession(), RESUME_PROBE_TIMEOUT_MS);
  if (read.status !== 'ok' || read.value.error) return 'unreachable';

  const session = read.value.data.session;
  // No session in storage while the app is still rendering signed-in screens is the state that has
  // to end on the sign-in screen. The caller makes that happen; saying so here is enough.
  if (!session) return 'signed-out';

  // An absent `expires_at` is treated as expired rather than as fine. Refreshing a token that did
  // not need it costs one request; trusting one that did costs the user the whole session.
  const expiresAtMs = (session.expires_at ?? 0) * 1000;
  if (expiresAtMs - now > RESUME_EXPIRY_MARGIN_MS) return 'active';

  const refreshed = await probe(() => auth.refreshSession(), RESUME_PROBE_TIMEOUT_MS);
  if (refreshed.status !== 'ok') return 'unreachable';
  if (refreshed.value.error) return isNetworkFailure(refreshed.value.error) ? 'unreachable' : 'signed-out';
  if (!refreshed.value.data.session) return 'signed-out';
  return 'refreshed';
}

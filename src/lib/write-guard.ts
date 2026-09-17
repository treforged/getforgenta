/**
 * WHY A WRITE WAS REFUSED, IN WORDS THE USER CAN ACT ON.
 *
 * Tre, 2026-09-17, on iOS 866, with a screenshot: a toast reading **"Demo mode"** sitting on the
 * app-lock PIN screen, and again *"if im past pin and go in and out of app after a period of
 * time"*. He was not in demo mode. He was signed out.
 *
 * ⚠️ THE CAUSE WAS NOT DEMO MODE AT ALL - IT WAS AN INTERNAL SENTINEL USED AS USER-FACING COPY.
 * Every write in this app guarded itself with one line, repeated 54 times:
 *
 *     if (isDemo || isPartnerView || !user)
 *       throw new Error(isPartnerView ? PARTNER_VIEW_READ_ONLY : 'Demo mode');
 *
 * The ternary separates PARTNER VIEW and nothing else, so `!user` - a perfectly ordinary state
 * after a session expires - fell through to the string `'Demo mode'`. That error is surfaced by
 * `onError: (e: Error) => toast.error(e.message)`, so the sentinel WAS the toast.
 *
 * THE PATH THAT REACHED HIM: `ResumeRecovery` finds the session gone after a long background,
 * signs out locally, and `user` becomes null while every mounted screen carries on. The next
 * write - including one fired from an effect, which needs no press - refused, and told him he
 * was in a demo of somebody else's money.
 *
 * ⚠️ THIS IS THE "A MESSAGE THAT LABELS A STATE INSTEAD OF NAMING ITS CAUSE" FAMILY, and it is
 * the worst version of it: the label named the WRONG state, on a financial app, where "you are
 * looking at demo data" and "your session ended" lead the user to opposite conclusions about
 * whether the numbers on screen are theirs.
 *
 * So there are THREE reasons a write is refused and they now say three different things. One
 * implementation, because 54 copies of a sentence is how one of them drifts.
 */

/** Viewing a partner's budget. Kept verbatim - this string already shipped and reads correctly. */
export const PARTNER_VIEW_READ_ONLY = "Read only: you are viewing your partner's budget";

/** Genuinely in the demo. Says what to do about it rather than naming the mode. */
export const DEMO_READ_ONLY = 'The demo is read only. Sign in to make changes.';

/**
 * Signed out - the case that was being reported as "Demo mode".
 *
 * It is worded as a CONSEQUENCE the user can act on, and it is honest whether the write came
 * from a button they pressed or from a background effect they never saw: in both cases the
 * session has gone and signing in again is the thing that fixes it.
 */
export const SIGNED_OUT_READ_ONLY = 'Your session has ended. Please sign in again.';

export interface WriteGuardState {
  isDemo?: boolean;
  isPartnerView?: boolean;
  /** Any truthy signed-in user. Typed loosely so every caller can pass whatever it holds. */
  user?: unknown;
}

/**
 * The error to throw when a write must not proceed.
 *
 * ⚠️ PRECEDENCE IS DELIBERATE AND MATCHES WHAT SHIPPED: partner view wins over demo, which wins
 * over signed-out. Partner view is the most specific thing the user is actually doing, and a
 * partner viewer is by definition signed in - so testing `user` first would relabel a correct,
 * long-standing message.
 */
export function writeBlockedError(state: WriteGuardState): Error {
  if (state.isPartnerView) return new Error(PARTNER_VIEW_READ_ONLY);
  if (state.isDemo) return new Error(DEMO_READ_ONLY);
  return new Error(SIGNED_OUT_READ_ONLY);
}

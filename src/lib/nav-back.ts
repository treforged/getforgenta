/**
 * WHERE "BACK" GOES WHEN THERE IS NOWHERE TO GO BACK TO.
 *
 * ⚠️ THE CASE THAT BREAKS IS A FRESH ENTRY, and this app has several: a push notification opening
 * a lesson, a pasted URL, and the native shell, which is a WebView whose FIRST navigation may be
 * any route at all. On any of those `history.back()` leaves the app — on iOS to whatever was in the
 * WebView before, which is usually nothing — instead of returning to the previous screen, because
 * there is no previous screen in this history.
 *
 * ⚠️ THE SIGNAL IS REACT-ROUTER'S OWN `idx`, not `history.length`. `history.length` counts the
 * whole tab's history including pages from before this app was loaded, so it is greater than 1 on
 * a fresh entry and would say "there is somewhere to go back to" when there is not. React Router
 * stamps `idx` into `history.state` and starts it at 0 for the entry the app was loaded on, which
 * is exactly the question being asked.
 */

/** Where the dashboard sits. A fallback must land INSIDE the app, never outside it. */
export const BACK_FALLBACK = '/dashboard';

/**
 * React Router's position in its own history stack, or 0 when it cannot be read.
 *
 * ⚠️ Unreadable reads as 0, which routes to the fallback. Sending somebody to the dashboard when
 * they could have gone back is a small wrong; sending them out of the app is the bug this exists
 * to prevent, so the uncertain case takes the safe branch.
 */
export function historyIndex(): number {
  try {
    const state = window.history.state as { idx?: unknown } | null;
    return typeof state?.idx === 'number' && Number.isFinite(state.idx) ? state.idx : 0;
  } catch {
    return 0;
  }
}

/**
 * `-1` to step back through the router, or a path to navigate to.
 *
 * `-1` is deliberate rather than reconstructing the previous path: it produces a POP, which is what
 * rule 8's scroll restoration (`useScrollRestoration`, `0982aa18`) listens for. A `navigate(path)`
 * would be a PUSH and would land at the top of a page the person had scrolled down.
 */
export function backTarget(idx: number): -1 | typeof BACK_FALLBACK {
  return idx > 0 ? -1 : BACK_FALLBACK;
}

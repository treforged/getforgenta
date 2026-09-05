import { useEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';

/**
 * PUT PEOPLE BACK WHERE THEY WERE.
 *
 * Rule 8 of the reel Tre sent (`docs/mobile-ux-rules-audit.md`): "When users leave a feed and
 * come back, preserve their exact scroll position." Forgenta had nothing — open a transaction
 * from halfway down the ledger, come back, and you are at the top with the row you were reading
 * somewhere below the fold.
 *
 * ⚠️ THIS WAS WRITTEN, PASSED EIGHT TESTS, FAILED IN CHROME THREE TIMES AND WAS REVERTED before
 * it worked. Five things had to be true at once. Four were found by the session that reverted it
 * and are recorded below so nobody pays for them twice; the fifth is at the bottom and is the one
 * that made the other four look broken.
 *
 * ── 1. THE SCROLLER IS `#scroll-main`, NOT THE WINDOW ───────────────────────
 * `main` in `DashboardLayout` carries `overflow-y-auto`, so `window.scrollY` is permanently 0 and
 * `window.scrollTo` moves a document that never scrolled. A restoration aimed at the window reads
 * zero, writes zero, passes against a `window` spy and is completely inert in the app. Same trap
 * the tab-to-top fix hit (`MobileNav.scrollMainToTop`): correct code pointed at the wrong object.
 *
 * ── 2. ONLY ON A POP, WHICH IS THE WHOLE POINT ──────────────────────────────
 * React Router reports how you arrived. POP — Back or a gesture: you were here before, so put you
 * back. PUSH — you tapped through to somewhere new, and the top is correct. REPLACE — a redirect,
 * likewise. Restoring on every navigation would drop somebody into the middle of a page they have
 * never seen, which is worse than the bug being fixed.
 *
 * ── 3. `scrollTop` CLAMPS SILENTLY ──────────────────────────────────────────
 * Assign 400 to a container still 600px tall because its data has not arrived and you get 0, with
 * no error and no way to tell anything failed. Measured: the Dashboard only reaches `scrollHeight`
 * 2517 once its queries resolve. Two nested `requestAnimationFrame`s was the first attempt; it
 * passed six tests and did nothing in the app. So this waits for the CONDITION
 * (`scrollHeight - clientHeight >= saved`) with a deadline, not for a number of frames.
 *
 * ── 4. A PROGRAMMATIC `scrollTop` ASSIGNMENT FIRES NO `scroll` EVENT ────────
 * Measured in Chrome: 0 events for an assignment the element accepted and read back as 400. So a
 * position tracked only from a scroll listener misses every non-gesture move. This keeps a
 * listener anyway — see the save path below for why BOTH sources are needed and neither is enough.
 *
 * ── 5. THE ONE THAT MADE THE OTHER FOUR LOOK BROKEN: `ScrollToTop` ──────────
 * `App.tsx` mounts a `ScrollToTop` that runs `document.getElementById('scroll-main')?.scrollTo(0,0)`
 * on EVERY pathname change — POP included. It predates this hook by months and is correct for PUSH
 * and REPLACE. Racing it is not a race worth entering: it now skips POP, which is also what a
 * browser does natively on Back. **Without that change this hook cannot work, however correct it
 * is**, and neither half is visible in a jsdom test, which is why eight green tests said nothing.
 *
 * ⚠️ NO JSDOM TEST CAN OBSERVE ANY OF THIS unaided: jsdom reports `scrollHeight`/`clientHeight` as
 * 0 and does not clamp `scrollTop`, so a test passes against all five failures at once. The test
 * beside this file MODELS the geometry on purpose. Keep that, and verify in a browser anyway.
 *
 * Positions live in memory, deliberately — not `sessionStorage`. A remembered offset is only
 * meaningful against a list of the same length, and after a reload the ledger may have synced new
 * rows, so a stored number would scroll to a place that no longer means anything. Losing it on a
 * reload is correct, not a limitation.
 */

/** Offsets by route key, for this page load only. */
const positions = new Map<string, number>();

/** Exported for tests, and the right thing to call if a route ever needs a deliberate reset. */
export function clearScrollPositions(): void {
  positions.clear();
}

export const SCROLLER_ID = 'scroll-main';

/** How long to keep waiting for a route's content to reach the height it had. Long enough for a
 *  query to resolve, short enough that a genuinely shorter page settles quickly. */
const RESTORE_TIMEOUT_MS = 1200;

/**
 * Next poll of the restore loop.
 *
 * ⚠️ `requestAnimationFrame` DOES NOT FIRE IN A HIDDEN TAB, and a restore that silently never
 * runs is the failure this whole file exists to avoid. Measured 2026-09-05: with
 * `document.visibilityState === 'hidden'`, zero frames in a full second, so an rAF-only retry loop
 * scheduled itself and then did nothing at all — indistinguishable from working.
 *
 * That is not only a test-harness quirk. A page restored into a background tab, or one the person
 * switched away from mid-navigation, is hidden in exactly the same way. rAF stays the scheduler
 * when the tab is visible, because aligning the write with a paint is what stops a visible jump;
 * a timer takes over when it is not, because a slightly less smooth restore beats none.
 */
function schedule(fn: () => void): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    setTimeout(fn, 50);
    return;
  }
  requestAnimationFrame(fn);
}

export function useScrollRestoration(): void {
  const location = useLocation();
  const navigationType = useNavigationType();

  // `search` is part of the identity: the ledger filtered to a different month is a different
  // list, and its offset is not transferable.
  const key = location.pathname + location.search;

  /** Last offset seen from a real gesture. See the save path for why this is not redundant. */
  const gestureOffset = useRef(0);

  useEffect(() => {
    const el = document.getElementById(SCROLLER_ID);
    if (!el) return;

    gestureOffset.current = el.scrollTop;
    const onScroll = () => { gestureOffset.current = el.scrollTop; };
    el.addEventListener('scroll', onScroll, { passive: true });

    let cancelled = false;

    if (navigationType === 'POP') {
      const saved = positions.get(key);
      if (saved !== undefined && saved > 0) {
        const deadline = Date.now() + RESTORE_TIMEOUT_MS;
        const attempt = () => {
          if (cancelled) return;
          const target = document.getElementById(SCROLLER_ID);
          if (!target) return;
          if (target.scrollHeight - target.clientHeight >= saved) {
            target.scrollTop = saved;
            // The assignment fires no scroll event (fact 4), so the ref would otherwise still hold
            // the pre-restore value and the next save would undo the restore.
            gestureOffset.current = saved;
            return;
          }
          if (Date.now() < deadline) schedule(attempt);
          // Past the deadline the page is genuinely shorter than it was. Leaving it at the top is
          // the honest outcome — scrolling to a maximum that is not where they were would be a
          // confident guess, and this hook exists to avoid one.
        };
        schedule(attempt);
      }
    }

    return () => {
      cancelled = true;
      el.removeEventListener('scroll', onScroll);

      // ⚠️ TWO SOURCES, AND THE LARGER ONE WINS. Neither is trustworthy alone, and this was
      // measured rather than reasoned — the first version preferred the live read and was wrong.
      //
      // **THE LIVE READ IS ALREADY STALE BY THE TIME THIS RUNS.** Measured in Chrome on the
      // Dashboard: the person was at 800, and `el.scrollTop` in this cleanup read **10**. The
      // outgoing route's content shrinks as it tears down, the browser clamps the scroller to the
      // new maximum, and the clamp happens BEFORE this line. It is not a zero you could test for
      // either — 10 is non-zero, plausible, and completely wrong. A "live read, falling back to the
      // ref when it is 0" rule saves 10 and returns the reader to the top of the ledger: the exact
      // bug, arriving through the fix, with nothing red anywhere.
      //
      // **THE REF ALONE MISSES PROGRAMMATIC MOVES**, because assigning `scrollTop` fires no scroll
      // event (fact 4) — so the restore path above updates the ref by hand when it writes.
      //
      // The clamp fires no scroll event before the cleanup (measured: the ref still held its
      // pre-collapse value while the DOM read had already dropped), so the ref survives exactly the
      // event that corrupts the live read. Taking the maximum keeps whichever source still knows.
      //
      // ⚠️ WHY MAX IS SAFE FOR "GO TO TOP". `MobileNav.scrollMainToTop` uses `el.scrollTo(...)`,
      // not a `scrollTop` assignment, and that DOES fire scroll events — so the ref follows it down
      // to 0 and the maximum is 0, not the stale 800. Any future "back to top" must use `scrollTo`
      // for the same reason. A bare `scrollTop = 0` would be remembered as wherever they were
      // before it.
      const live = el.scrollTop;
      positions.set(key, Math.max(live, gestureOffset.current));
    };
  }, [key, navigationType]);
}

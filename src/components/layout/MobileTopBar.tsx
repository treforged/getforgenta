import { Link, useLocation } from 'react-router';
import { Menu } from 'lucide-react';
import { useDemoSession } from '@/hooks/useDemoSession';
import IdentityBadge from '@/components/layout/IdentityBadge';
import BackButton from '@/components/layout/BackButton';
import { isPushedRoute, ACCOUNT_TAB_PATH } from '@/lib/nav-routes';

/**
 * The narrow-viewport top bar: a hamburger at the far LEFT that is on screen on every route, at
 * every scroll position, always.
 *
 * ⚠️ THIS EXISTS BECAUSE OF ONE INSTRUCTION AND THE HALF THAT MATTERS IS "AT ALL TIMES" — Tre,
 * 2026-08-18: *"make settings accessible from a hamburger in the top left at all times."* Settings
 * used to be reachable on a phone ONLY from inside the bottom bar's "More" grid: a path you had to
 * already know about to find. So the bar is `sticky` inside the layout's own sticky header and its
 * visibility is conditional on NOTHING — not the route, not a panel, not the scroll position.
 *
 * ⚠️ IT REPLACED THE "MORE" PANEL RATHER THAN SITTING BESIDE IT. Two menus holding the same rows is
 * how they drift apart. The drawer below carries everything that grid carried — Settings, the AI
 * advisor when its flag is on, Upgrade, Sign Out, and the demo's two links — so nothing lost a
 * path; what changed is that the bottom bar's fifth cell is now Garage (Tre, same day: "make Garage
 * the last tab for lower width viewports") instead of a button that opened this.
 *
 * The layout is the Monarch format Tre sent as a reference: hamburger far left, the name centred.
 * ⚠️ The centre is the WORDMARK, not the page title. Centring the screen's title the way Monarch
 * does needs a title registry the app does not have yet, and inventing one here would either
 * duplicate every page's own <h1> or quietly delete it. The wordmark is also the one thing a phone
 * user currently never sees — it lives in the desktop rail only.
 */
export default function MobileTopBar() {
  const { pathname } = useLocation();
  const { isDemo } = useDemoSession();

  /**
   * The hamburger belongs to the Account tab only. Compared against the shared `ACCOUNT_TAB_PATH`
   * rather than a literal, so a rename moves the tab and this predicate together - a hand-typed
   * '/account' here would silently stop matching and take the ONLY route to Settings with it.
   *
   * The trailing slash is normalised for the same reason `isPushedRoute` does it: links people
   * paste and some native shells add one, and `/account/` is the same screen.
   */
  const onAccountTab = pathname.replace(/\/+$/, '') === ACCOUNT_TAB_PATH;

  const brandTo = isDemo ? '/' : '/dashboard';

  return (
    <>
      {/* ⚠️ THE SAFE-AREA INSET IS ON THE BAR ITSELF, and it has to be. `index.html` sets
          `viewport-fit=cover`, so on a notched iPhone the web view extends UNDER the status bar —
          and this bar is the topmost element in the normal signed-in app. Without the inset its
          44px hamburger sat beneath the clock and the Dynamic Island, which is not merely ugly:
          the menu is the ONLY route to Settings on mobile, so the button being untappable put
          Settings out of reach entirely (Tre, 2026-08-19, from TestFlight).
          ⚠️ WHY NOBODY CAUGHT IT: `DemoBanner` carries its own safe-area padding and renders ABOVE
          this bar, so every check run in demo mode looked correct. The bug only exists signed in. */}
      {/* ⚠️ NO SAFE-AREA INSET HERE. `DashboardLayout`'s sticky wrapper owns it — see the comment
          there. This bar is `lg:hidden`, so it cannot be the inset's owner for the whole app, and
          for one build it carried the inset while `main` carried a second copy. */}
      <div className="lg:hidden relative flex items-center h-12 px-2 border-b border-border glass">
        {/* ⚠️ TOP RIGHT, AND THAT IS JAKOB'S LAW RATHER THAN A PREFERENCE (Tre, 2026-09-06). People
            spend nearly all their time in OTHER apps and arrive carrying a model of where things
            live; Instagram — his own reference — puts the menu far top right. Every place we
            differ costs a half-second of hesitation nobody reports and we never see.
            `ml-auto` rather than `justify-end` on the row: the brand is ABSOLUTELY centred, so it
            is not a flex sibling and a `justify-*` change would silently do nothing the day
            somebody adds a second child. */}
        {/* ⚠️ THE VACATED TOP-LEFT NOW ANSWERS "WHOSE MONEY IS THIS" — item 1 of
            `docs/navigation-jakobs-law.md`, ranked first on encounters per session. It is the only
            question in that plan that is unanswered on every screen of every session, and partner
            view makes it a real one. It renders BEFORE the `ml-auto` trigger, so the hamburger
            still sits hard right whether or not this is present. */}
        {/* ⚠️ BACK **REPLACES** IDENTITY, AND THAT IS MEASURED RATHER THAN CHOSEN. At 390px the
            centred wordmark starts at x=110 and the identity badge ends at x=90 — a 19px gap
            (same-origin iframe, 2026-09-06). A 44px control does not fit beside it, so the corner
            shows BACK where there is somewhere to go back from and IDENTITY otherwise. Nothing is
            lost: the pushed screens are Settings, the AI advisor and Premium, and Settings is
            itself where the account lives. */}
        {isPushedRoute(pathname) ? <BackButton /> : <IdentityBadge />}

        {/* ⚠️ THE HAMBURGER IS ON THE ACCOUNT TAB AND NOWHERE ELSE, and this NARROWS an earlier
            instruction rather than ignoring it. Tre, 2026-08-18: "make settings accessible from a
            hamburger in the top left at all times" - built exactly that, visibility conditional on
            nothing. Tre, 2026-09-16: "the hamburger should open its own page. and is only viewable
            and accessible from the account page." Both are his; the later one wins. Do not restore
            the unconditional version from the older comment alone.

            IT GOES STRAIGHT TO SETTINGS, AND THE DRAWER IT REPLACED IS GONE. Tre clarified the
            same day: "the hamburger should open the settings page, including the log out button,
            like how instagram does it." Instagram's hamburger opens "Settings and activity" - ONE
            page, with sign-out at the bottom of it - not an intermediate menu. An earlier attempt
            here built that intermediate page and it was the wrong shape; it is deleted rather than
            left dark. Settings is a pushed route, so it gets a back button and keeps the tab bar. */}
        {onAccountTab && (
          <Link
            to="/settings"
            aria-label="Open menu"
            className="ml-auto flex items-center justify-center min-w-[44px] min-h-[44px] -my-0.5 text-muted-foreground hover:text-foreground transition-colors btn-press"
          >
            <Menu size={20} />
          </Link>
        )}

        <Link
          to={brandTo}
          className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 hover:opacity-80 transition-opacity"
        >
          <img
            src="/logo-transparent.png"
            alt="Forgenta"
            // Sized against the 48px bar rather than the wordmark: 22 read as an afterthought
            // next to FORGENTA. 30 fills the row and still clears it top and bottom.
            style={{ height: 30, width: 30, objectFit: 'contain' }}
            draggable={false}
          />
          <span className="font-display font-bold text-sm tracking-tight text-primary">FORGENTA</span>
          {isDemo && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-gold bg-gold/10 px-1 py-0.5 rounded shrink-0">Demo</span>
          )}
        </Link>
      </div>

    </>
  );
}

import { Link, useLocation } from 'react-router';
import { cn } from '@/lib/utils';
import { useBankReviewQueueCount } from '@/hooks/useBankReviewQueue';
import { PRIMARY_NAV } from '@/lib/primary-nav';

// The bottom bar is a 5-column grid of five destinations. It used to be four plus a "More" button;
// the button's panel became the top-left hamburger drawer on 2026-08-18 (Tre: "make settings
// accessible from a hamburger in the top left at all times"), which freed the fifth cell — and
// Garage took it, LAST, because he asked for exactly that the same day: "make Garage the last tab
// for lower width viewports." ⚠️ Scoped to this nav. `Sidebar.tsx` keeps its own order.
//
// ⚠️ 2026-08-27: THE SURFACE IS NAMED "Transactions" AGAIN, at every width (Tre: "rename activity
// in the tab section to Transactions"). That reverses the label — NOT the one-name rule, which
// still holds: the desktop rail and the page's own <h1> say "Transactions" too, so nothing renames
// itself on a resize (Tre, 2026-08-18: "just keep it as [one name] all the time").
//
// ⚠️ AND IT DOES NOT FIT THE PHONE BAR. Measured at the real computed font (Inter 500 13.5px):
// five columns leave 66.8px of text width on a 390px phone (63.8px at 375, 52.8px at 320), and
// "Transactions" renders 83.3px, so it truncates to "Transactio…" on every phone. "Activity" was
// 49.1px and fit a 320px SE. The rename was asked for with that trade named; keeping the old label
// here alone would bring back the label that renames itself on a resize, which is worse.
//
// Accounts, Plan and Goals are all PANELS of tabs already in this row (of Dashboard,
// Transactions and Forecast respectively) rather than entries of their own — the "reduce how many
// separate tabs, especially on mobile" ask. Their old routes still resolve as redirects.
/**
 * ⚠️ RE-EXPORTED, NOT DECLARED. The destinations now live in `src/lib/primary-nav.ts` so the
 * desktop rail and this bar map over ONE list and cannot drift apart — Tre, 2026-09-15: the
 * selections on a big screen were different from the selections on mobile. Existing importers of
 * `PRIMARY` keep working; what changed is where the list comes from.
 */
export const PRIMARY = PRIMARY_NAV;

/**
 * TAPPING THE TAB YOU ARE ALREADY ON RETURNS YOU TO THE TOP.
 *
 * A convention every large mobile app shares, and one this bar did not have: the tab was a plain
 * `<Link>` to the route you were already on, so re-tapping it did nothing at all. Someone four
 * screens deep in Transactions had no way back to the top except to scroll all of it.
 *
 * The scroller is `#scroll-main` in `DashboardLayout`, NOT the window — `main` is the
 * `overflow-y-auto` element, so `window.scrollTo` scrolls a document that never moved and
 * silently does nothing. That is the whole reason this reaches for the element by id.
 *
 * `smooth` unless the reader has asked for less motion, which is the one case where an animated
 * jump is actively unwanted rather than merely a preference.
 */
function scrollMainToTop() {
  const main = document.getElementById('scroll-main');
  if (!main) return;
  const reduced = typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
  main.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
}

export default function MobileNav() {
  const { pathname } = useLocation();

  // §1B Stage 5 — see the identical block in `Sidebar.tsx`. NOT an unreviewed count; null while
  // loading and null at zero. The mobile bar gets it too because a review queue only a desktop user
  // can see is the same invisibility bug in a smaller window.
  const reviewQueueCount = useBankReviewQueueCount();

  return (
    // ⚠️ `z-40`, NOT `z-50`. The tab bar is CHROME and belongs under every overlay in the app.
    // It sat at `z-50` until 2026-08-24, which is the same layer as the lowest `modal-overlay`
    // call sites; the bar is mounted after `main` in `DashboardLayout`, so at equal z-index DOM
    // order handed it the win and it painted OVER any modal not portalled to `document.body`.
    // Measured on the Garage's Log Service sheet at 390x844: the sheet scrolled to its very end
    // still left 33 of the 38px submit button behind the bar, which is exactly Tre's "cut off by
    // the bottom of the viewport". `z-40` is the layer the sticky TOP bar already uses
    // (`DashboardLayout`), so the two ends of the chrome now agree.
    // ⚠️ IT FLOATS AS A PILL, INSET FROM THE EDGES — Tre, 2026-09-16: *"i want the bottom
    // selection of tabs like the liquid glass instagram does. for iphone"*, with screenshots of
    // iOS 26 Instagram. That shape is not a full-width bar with rounded corners: the bar is held
    // OFF all three edges, so the page's own content passes underneath it on every side, which is
    // what gives the material something to sample. `inset-x-0 bottom-0` was the opposite of it.
    //
    // ⚠️ THE SAFE-AREA INSET MOVED FROM `paddingBottom` TO THE BOTTOM OFFSET, and that is the
    // whole difference between the two shapes rather than a tidy-up. A bar pinned to the edge has
    // to ABSORB the home indicator as padding or its last row of pixels sits under it. A bar that
    // floats CLEARS it instead — so the inset becomes part of how far up the bar sits, and the
    // 0.75rem is the gap you see between the pill and the bottom of the screen. Left and right
    // carry their own insets for the same reason: on a landscape notch the pill must not slide
    // under the ear.
    //
    // ⚠️ `overflow-hidden` IS LOAD-BEARING, NOT TIDINESS. `backdrop-filter` establishes its own
    // backdrop root and paints to the element's border box — so without a clip the blurred
    // rectangle shows in the corners OUTSIDE the `rounded-full` border, and the pill reads as a
    // rectangle with a pill drawn on it. This is the same family as the concentricity rule: the
    // radius and the thing being clipped have to agree.
    <nav
      className="lg:hidden fixed z-40 border border-border glass rounded-full shadow-lg shadow-black/25 overflow-hidden"
      style={{
        left: 'calc(0.75rem + env(safe-area-inset-left))',
        right: 'calc(0.75rem + env(safe-area-inset-right))',
        bottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
      }}
    >
      {/* Tighter than the pinned bar was: the pill's own 0.75rem gap now does the work the bar's
          outer padding used to, and 64px still clears the 44px touch floor with room over. */}
      {/* CELLS SIZE TO THEIR WORDS, not five equal columns. Equal fifths cut "Transactions" to
          "Transacti…" at 390 (74px of text in 61px) and at 320 (70 in 57), and Tre keeps ONE name
          at every width (2026-08-27). Each cell is at least its word; the rest is shared.
          check:narrow-overflow asserts every label is whole (WIDTH=320 and 390). */}
      <div className="flex items-stretch px-0.5 min-[360px]:px-1.5 py-1.5 min-h-[64px]">
        {PRIMARY.map(item => {
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              onClick={active ? scrollMainToTop : undefined}
              className={cn(
                'flex flex-1 min-w-fit flex-col items-center justify-center gap-1 px-0 min-[360px]:px-1 py-1.5 text-xs font-medium transition-colors btn-press text-center',
                // A highlighted (not current) item: gold ICON + dot, full-contrast LABEL (be864a14). A faded-gold label
                // read 3.97:1 in light mode, and a full-gold one would look like the current page.
                active ? 'text-primary' : item.highlight ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              <div className="relative">
                <item.icon size={20} strokeWidth={active ? 2.2 : 1.8} className={item.highlight && !active ? 'text-primary' : undefined} />
                {item.highlight && !active && (
                  // Out on the corner with a ring in the bar's colour, the badge convention: at
                  // -top-0.5/-right-0.5 the dot sat ON the Landmark's roof and read as part of the glyph.
                  <span data-testid="nav-highlight-dot" className="absolute -top-1 -right-1.5 w-2 h-2 bg-primary rounded-full ring-2 ring-background" />
                )}
                {/* A NUMBER, not a dot, and it goes over the Transactions icon. The label has no
                    room to carry it at these widths (see the block above), so the count rides the
                    icon — and unlike the Debt dot, this one says how much is waiting. */}
                {item.to === '/transactions' && reviewQueueCount !== null && (
                  <span
                    className="absolute -top-1.5 -right-2.5 min-w-[16px] px-1 text-[9px] font-bold leading-[16px] text-primary-foreground bg-primary rounded-full text-center"
                    aria-label={`${reviewQueueCount} bank charges awaiting your decision`}
                  >
                    {reviewQueueCount > 9 ? '9+' : reviewQueueCount}
                  </span>
                )}
              </div>
              <span className="truncate max-w-full text-[10px] tracking-tight min-[360px]:text-xs min-[360px]:tracking-normal">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

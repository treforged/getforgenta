import { Link, useLocation } from 'react-router';
import {
  LayoutDashboard, ArrowLeftRight, Landmark, TrendingUp, Car,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBankReviewQueueCount } from '@/hooks/useBankReviewQueue';

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
export const PRIMARY = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Home' },
  { to: '/transactions', icon: ArrowLeftRight, label: 'Transactions' },
  { to: '/debt', icon: Landmark, label: 'Debt', highlight: true },
  { to: '/forecast', icon: TrendingUp, label: 'Forecast' },
  { to: '/vehicles', icon: Car, label: 'Garage' },
];

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
    <nav
      className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid grid-cols-5 items-stretch px-2 py-2 min-h-[72px]">
        {PRIMARY.map(item => {
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={active ? scrollMainToTop : undefined}
              className={cn(
                'flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-1.5 text-xs font-medium transition-colors btn-press text-center',
                active ? 'text-primary' : item.highlight ? 'text-primary/75' : 'text-muted-foreground',
              )}
            >
              <div className="relative">
                <item.icon size={20} strokeWidth={active ? 2.2 : 1.8} />
                {item.highlight && !active && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full" />
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
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

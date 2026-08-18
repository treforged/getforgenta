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
// Labels are deliberately SHORT. Measured at the real computed font (Inter 500 13.5px):
// five columns leave 66.8px of text width on a 390px phone (63.8px at 375, 52.8px at 320),
// and "Transactions" renders 83.3px — it would truncate to "Transacti…" on EVERY phone.
// "Activity" is 49.1px and fits even a 320px SE; it is also the label Apple Card, Venmo
// and Robinhood use for the same surface.
// ⚠️ 2026-08-18: "Activity" is now the surface's name EVERYWHERE — the desktop rail and the page's
// own <h1> say it too (Tre: "why does transactions change to activity with smaller width. just keep
// it as activity all the time"). The old trade kept the long name on desktop for discoverability
// and bought a label that renamed itself on a resize, which reads as two different pages.
//
// Accounts, Budget Control and Goals are all PANELS of tabs already in this row (of Dashboard,
// Activity and Forecast respectively) rather than entries of their own — the "reduce how many
// separate tabs, especially on mobile" ask. Their old routes still resolve as redirects.
const PRIMARY = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Home' },
  { to: '/transactions', icon: ArrowLeftRight, label: 'Activity' },
  { to: '/debt', icon: Landmark, label: 'Debt', highlight: true },
  { to: '/forecast', icon: TrendingUp, label: 'Forecast' },
  { to: '/vehicles', icon: Car, label: 'Garage' },
];

export default function MobileNav() {
  const { pathname } = useLocation();

  // §1B Stage 5 — see the identical block in `Sidebar.tsx`. NOT an unreviewed count; null while
  // loading and null at zero. The mobile bar gets it too because a review queue only a desktop user
  // can see is the same invisibility bug in a smaller window.
  const reviewQueueCount = useBankReviewQueueCount();

  return (
    <nav
      className="lg:hidden fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid grid-cols-5 items-stretch px-2 py-2 min-h-[72px]">
        {PRIMARY.map(item => {
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
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
                {/* A NUMBER, not a dot, and it goes over the Activity icon. The labels here are
                    pinned short for 320px phones (see the block above), so the count cannot ride
                    the label — and unlike the Debt dot, this one says how much is waiting. */}
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

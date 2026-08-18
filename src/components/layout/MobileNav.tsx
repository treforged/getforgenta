import { Link, useLocation } from 'react-router';
import {
  LayoutDashboard, ArrowLeftRight, Landmark,
  MoreHorizontal, PiggyBank, TrendingUp,
  Settings, Crown, LogOut, Home, X, Sparkles, Car,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useDemo } from '@/contexts/DemoContext';
import { useSubscription } from '@/hooks/useSubscription';
import { useState } from 'react';
import { AI_ADVISOR_ENABLED } from '@/lib/feature-flags';
import { useBankReviewQueueCount } from '@/hooks/useBankReviewQueue';

// The bottom bar is a 5-column grid: 4 primary tabs plus the "More" button.
// Tabs and order are Tre's spec: dashboard, transactions, debt payoff, forecast, More.
// Labels are deliberately SHORT. Measured at the real computed font (Inter 500 13.5px):
// five columns leave 66.8px of text width on a 390px phone (63.8px at 375, 52.8px at 320),
// and "Transactions" renders 83.3px — it would truncate to "Transacti…" on EVERY phone.
// "Activity" is 49.1px and fits even a 320px SE; it is also the label Apple Card, Venmo
// and Robinhood use for the same surface.
// ⚠️ 2026-08-18: "Activity" is now the surface's name EVERYWHERE — the desktop rail and the page's
// own <h1> say it too (Tre: "why does transactions change to activity with smaller width. just keep
// it as activity all the time"). The old trade kept the long name on desktop for discoverability
// and bought a label that renamed itself on a resize, which reads as two different pages.
const PRIMARY = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Home' },
  { to: '/transactions', icon: ArrowLeftRight, label: 'Activity' },
  { to: '/debt', icon: Landmark, label: 'Debt', highlight: true },
  { to: '/forecast', icon: TrendingUp, label: 'Forecast' },
];

// Accounts left this list on 2026-08-18: it is a panel of the Dashboard, which is already the
// first PRIMARY tab. Five entries here instead of six — the "reduce how many separate tabs,
// especially on mobile" ask, and the More grid is two columns so it loses a half-row.
// Budget Control left it the same day for the same reason: it is the third panel of Activity,
// which is already a PRIMARY tab. Four entries — the More grid is two columns, so it loses a row.
const SECONDARY = [
  { to: '/vehicles', icon: Car, label: 'Garage' },
  ...(AI_ADVISOR_ENABLED ? [{ to: '/ai', icon: Sparkles, label: 'AI Advisor' }] : []),
  { to: '/goals', icon: PiggyBank, label: 'Goals' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export default function MobileNav() {
  const { pathname } = useLocation();
  const { signOut } = useAuth();
  const { isDemo } = useDemo();
  const { isPremium } = useSubscription();
  // The More panel stores the route it was opened on rather than a bare boolean,
  // so it closes itself the moment the route changes — covering primary tabs, the
  // back button and programmatic navigation alike, with no effect to reset it.
  const [moreOpenedAt, setMoreOpenedAt] = useState<string | null>(null);
  const showMore = moreOpenedAt === pathname;
  const setShowMore = (open: boolean) => setMoreOpenedAt(open ? pathname : null);

  const moreActive = SECONDARY.some(i => pathname === i.to);

  // §1B Stage 5 — see the identical block in `Sidebar.tsx`. NOT an unreviewed count; null while
  // loading and null at zero. The mobile bar gets it too because a review queue only a desktop user
  // can see is the same invisibility bug in a smaller window.
  const reviewQueueCount = useBankReviewQueueCount();

  return (
    <>
      {showMore && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-background/60 backdrop-blur-sm"
          onClick={() => setShowMore(false)}
        >
          <div
            className="absolute left-3 right-3 bg-card border border-border shadow-xl max-h-[min(70vh,560px)] overflow-y-auto"
            style={{
              bottom: 'calc(5.5rem + env(safe-area-inset-bottom))',
              borderRadius: 'var(--radius)',
              paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card px-4 py-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                More
              </span>
              <button
                onClick={() => setShowMore(false)}
                className="p-1 text-muted-foreground hover:text-foreground icon-btn"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 p-3">
              {SECONDARY.map(item => {
                const active = pathname === item.to;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setShowMore(false)}
                    className={cn(
                      'flex min-h-[72px] flex-col items-center justify-center gap-1.5 px-2 py-3 text-xs font-medium transition-colors btn-press text-center',
                      active ? 'text-primary bg-primary/8' : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
                    )}
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    <item.icon size={18} />
                    <span className="leading-tight">{item.label}</span>
                  </Link>
                );
              })}
            </div>

            <div className="border-t border-border px-3 pt-2 space-y-1">
              {isDemo ? (
                <>
                  <Link
                    to="/auth"
                    onClick={() => setShowMore(false)}
                    className="flex items-center gap-2 px-3 py-3 text-sm font-semibold text-primary hover:bg-primary/8 btn-press w-full"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    Sign Up Free →
                  </Link>
                  <Link
                    to="/"
                    onClick={() => setShowMore(false)}
                    className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary btn-press w-full"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    <Home size={14} /> Main Page
                  </Link>
                </>
              ) : (
                <>
                  {!isPremium && (
                    <Link
                      to="/premium"
                      onClick={() => setShowMore(false)}
                      className="flex items-center gap-2 px-3 py-3 text-sm font-medium text-foreground hover:bg-secondary btn-press w-full"
                      style={{ borderRadius: 'var(--radius)' }}
                    >
                      <Crown size={14} className="text-primary" /> Upgrade to Premium
                    </Link>
                  )}
                  <button
                    onClick={() => { setShowMore(false); signOut(); }}
                    className="flex items-center gap-2 px-3 py-3 text-sm font-medium text-destructive hover:bg-destructive/10 btn-press w-full"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    <LogOut size={14} /> Sign Out
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

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
          <button
            onClick={() => setShowMore(!showMore)}
            className={cn(
              'flex min-w-0 flex-col items-center justify-center gap-1 px-1 py-1.5 text-xs font-medium transition-colors btn-press text-center',
              moreActive || showMore ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <MoreHorizontal size={20} strokeWidth={moreActive || showMore ? 2.2 : 1.8} />
            <span className="truncate">More</span>
          </button>
        </div>
      </nav>
    </>
  );
}
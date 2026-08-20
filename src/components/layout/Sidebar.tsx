import { Link, useLocation } from 'react-router';
import {
  LayoutDashboard, ArrowLeftRight, Landmark,
  Settings, Crown, LogOut, ChevronLeft, ChevronRight,
  TrendingUp, Home, Sparkles, Zap, Car, ArrowLeft,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/hooks/useSubscription';
import { useDemoSession } from '@/hooks/useDemoSession';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { AI_ADVISOR_ENABLED } from '@/lib/feature-flags';
import { useBankReviewQueueCount } from '@/hooks/useBankReviewQueue';

const navItems = [
  // Accounts is a PANEL of the Dashboard now, not a row here — Tre, 2026-08-18: "we need to reduce
  // how many separate tabs". The rail lost the row; the surface lost nothing.
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  // Budget Control is a PANEL of Activity now, for the same reason and on the same day. `/budget`
  // still resolves — it redirects to `/transactions?tab=budget` — so every bookmark and every
  // in-app link keeps landing; what it stopped being is a row of its own.
  // 'Activity', not 'Transactions' — one name for the surface at every width (Tre, 2026-08-18:
  // "why does transactions change to activity with smaller width. just keep it as activity all the
  // time"). The rail used to keep the long name so the vocabulary stayed discoverable; a label that
  // renames itself on a resize is worse than a short one.
  { to: '/transactions', icon: ArrowLeftRight, label: 'Activity' },
  { to: '/debt', icon: Landmark, label: 'Debt Payoff', highlight: true },
  { to: '/vehicles', icon: Car, label: 'Garage' },
  // Goals is a PANEL of the Dashboard now, for the same reason and by the same route as Accounts
  // and Budget Control (Tre, 2026-08-20: "move the goals section to the home/command center tab …
  // it makes more sense there."). `/goals` still resolves — it redirects to
  // `/dashboard?tab=goals` — so every bookmark and every in-app link keeps landing; what it
  // stopped being is a row of its own.
  { to: '/forecast', icon: TrendingUp, label: 'Forecast' },
  ...(AI_ADVISOR_ENABLED ? [{ to: '/ai', icon: Sparkles, label: 'AI Advisor' }] : []),
  { to: '/settings', icon: Settings, label: 'Settings' },
  { to: '/premium', icon: Crown, label: 'Upgrade' },
];

export default function Sidebar() {
  const { pathname } = useLocation();
  const { signOut } = useAuth();
  const { isDemo, isPreview, leaveDemo } = useDemoSession();
  const { isPremium } = useSubscription();
  const [collapsed, setCollapsed] = useState(false);

  /**
   * §1B Stage 5 — bank charges the app has a suggested match for and is waiting on.
   *
   * ⚠️ NOT a count of unreviewed rows. Most bank rows are unreviewed by design and always will be
   * (Tre, 2026-08-08); badging that would be a number nobody can drive to zero. Read
   * `@/lib/bank-activity-queue`'s header before changing what this means.
   *
   * ⚠️ THIS COSTS A REAL FETCH ON EVERY PAGE, and it is a deliberate trade. The rail renders app-wide,
   * so the all-history synced-transaction query now runs everywhere rather than only on
   * `/transactions`. That is the entire point: the suggestions already worked and were invisible
   * because reaching them required already being on the page that hides them. react-query serves
   * every consumer from one cache, so the tab badge and Bank Activity itself add nothing on top.
   *
   * Null while loading and null at zero — the badge simply is not rendered, because a "0" and a
   * badge that failed to compute look identical.
   */
  const reviewQueueCount = useBankReviewQueueCount();

  // Brand link: dashboard if logged in, landing if demo/auth
  const brandTo = isDemo ? '/' : '/dashboard';

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col bg-sidebar border-r border-sidebar-border h-screen sticky top-0 transition-all duration-200",
        collapsed ? "w-16" : "w-52"
      )}
    >
      <div className="flex items-center justify-between px-3 h-14 border-b border-sidebar-border">
        {!collapsed && (
          <Link to={brandTo} className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0">
            <img
              src="/logo-transparent.png"
              alt="Forgenta"
              // Kept in proportion with the mobile bar's mark, which went 22 -> 30.
              style={{ height: 34, width: 34, objectFit: 'contain' }}
              draggable={false}
            />
            <span className="font-display font-bold text-sm tracking-tight text-primary">FORGENTA</span>
            {isDemo && (
              <span className="text-[9px] font-bold uppercase tracking-wider text-gold bg-gold/10 px-1 py-0.5 rounded shrink-0">Demo</span>
            )}
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors btn-press"
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
        {navItems.filter(item => {
          if (isDemo && item.to === '/premium') return false;
          if (isPremium && item.to === '/premium') return false;
          return true;
        }).map(item => {
          const active = pathname === item.to;
          const badge = item.to === '/transactions' ? reviewQueueCount : null;
          return (
            <Link
              key={item.to}
              to={item.to}
              title={badge !== null
                ? `${badge} bank ${badge === 1 ? 'charge has' : 'charges have'} a suggested match waiting for you`
                : undefined}
              className={cn(
                "flex items-center gap-3 px-3 py-2 text-xs font-medium transition-colors duration-150 btn-press",
                active
                  ? "bg-sidebar-accent text-primary"
                  : item.highlight
                    ? "text-primary/80 bg-primary/8 hover:bg-primary/12 hover:text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
              )}
              style={{ borderRadius: 'var(--radius)' }}
            >
              {/* Collapsed, the label is gone and a number would have nothing to attach to — so the
                  badge degrades to a dot. Still says "there is something here", which is the whole
                  job of this affordance. */}
              <span className="relative shrink-0">
                <item.icon size={16} />
                {collapsed && badge !== null && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-primary rounded-full" />
                )}
              </span>
              {!collapsed && (
                <span className="flex items-center gap-1.5 flex-1 min-w-0">
                  <span className="truncate">{item.label}</span>
                  {item.highlight && !active && <Zap size={10} className="text-primary fill-primary shrink-0" />}
                  {badge !== null && (
                    <span
                      className="ml-auto text-[10px] font-semibold bg-primary/15 text-primary px-1.5 py-0.5 leading-none shrink-0"
                      style={{ borderRadius: 'var(--radius)' }}
                    >
                      {badge}
                    </span>
                  )}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="p-2 border-t border-sidebar-border space-y-1">
        {/* A signed-in user looking at the reference account leaves it, they do not sign up for it
            — one predicate, `useDemoSession().isPreview`, shared with the banner and the mobile
            menu so the three cannot offer three different doors. */}
        {isPreview ? (
          <button
            onClick={leaveDemo}
            className="flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors w-full btn-press"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {!collapsed && <span>Back to my account</span>}
            {collapsed && <ArrowLeft size={16} />}
          </button>
        ) : isDemo ? (
          <>
            <Link
              to="/auth"
              className="flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors w-full btn-press"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {!collapsed && <span>Sign Up Free</span>}
              {collapsed && <Crown size={16} />}
            </Link>
            {!collapsed && (
              <Link
                to="/"
                className="flex items-center gap-3 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full btn-press"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <Home size={16} />
                <span>Main Page</span>
              </Link>
            )}
          </>
        ) : (
          <button
            onClick={signOut}
            className="flex items-center gap-3 px-3 py-2 text-xs text-muted-foreground hover:text-destructive transition-colors w-full btn-press"
          >
            <LogOut size={16} />
            {!collapsed && <span>Sign Out</span>}
          </button>
        )}
      </div>
    </aside>
  );
}

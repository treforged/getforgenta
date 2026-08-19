import { Link, useLocation } from 'react-router';
import { useDemoSession } from '@/hooks/useDemoSession';

const routeDescriptions: Record<string, string> = {
  '/dashboard':    'Overview of all accounts, cash flow, and net worth in one place',
  // ⚠️ Keyed on the PATH, so a page that stops rendering silently loses its line with no error.
  // `/budget` became `/transactions?tab=budget` on 2026-08-18 and the two surfaces are now one, so
  // this line covers both — the demo is the sales surface and must not go quiet on it.
  '/transactions': 'One-time entries and the recurring rules behind every projection, in one place',
  '/debt':         'Avalanche engine computes the fastest payoff path using every dollar above your cash floor',
  '/goals':        'Goals track progress and link to real account balances automatically',
  '/forecast':     '60-month projection: debt payoff, savings growth, and cash flow in one view',
  '/settings':     'Cash floor, income settings, and pay schedule drive every calculation',
};

export default function DemoBanner() {
  const { isDemo, isPreview, leaveDemo } = useDemoSession();
  const { pathname } = useLocation();
  if (!isDemo) return null;

  const description = routeDescriptions[pathname] ?? 'Explore any page to see how it all connects';

  return (
    <div
      // ⚠️ NO SAFE-AREA INSET HERE. `DashboardLayout`'s sticky wrapper owns it, and this banner
      // sits BELOW `MobileTopBar` inside that wrapper — so an inset here was only ever correct on
      // the one path where the bar was hidden, and doubled everywhere else.
      className="bg-card border-b border-border/80 px-3 sm:px-5 pt-2.5 pb-2.5 flex items-center justify-between gap-3"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest text-primary bg-primary/15 px-2 py-0.5" style={{ borderRadius: 'var(--radius)' }}>
          Demo
        </span>
        <span className="text-[11px] text-muted-foreground hidden md:block truncate">
          <span className="text-foreground font-medium">Jordan's finances</span>
          {' · '}
          {description}
        </span>
        <span className="text-[11px] text-muted-foreground md:hidden">Sample profile</span>
      </div>

      {/* Two audiences, two ways out (`useDemoSession`). A visitor is being sold to. Someone who
          already signed up and opened the reference account mid-setup is not — offering them
          "Sign Up Free" would be nonsense, and their exit is the flag dropping, never a sign-out. */}
      <div className="flex items-center gap-2 shrink-0">
        {isPreview ? (
          <button
            onClick={leaveDemo}
            className="text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors px-3 py-1.5 btn-press"
            style={{ borderRadius: 'var(--radius)' }}
          >
            ← Back to my account
          </button>
        ) : (
          <>
            <Link
              to="/"
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 border border-border hover:border-border/80 btn-press"
              style={{ borderRadius: 'var(--radius)' }}
            >
              ← Home
            </Link>
            <Link
              to="/auth"
              className="text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors px-3 py-1.5 btn-press"
              style={{ borderRadius: 'var(--radius)' }}
            >
              Sign Up Free →
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

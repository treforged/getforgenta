import { Link, useLocation } from 'react-router';
import { Menu, Settings, Crown, LogOut, Home, X, Sparkles, Eye } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/hooks/useSubscription';
import { useDemoSession } from '@/hooks/useDemoSession';
import { useViewedProfile } from '@/contexts/ViewedProfileContext';
import { usePartnerLinkStatus } from '@/hooks/usePartnerLink';
import { AI_ADVISOR_ENABLED } from '@/lib/feature-flags';

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
  const { signOut } = useAuth();
  const { isDemo, isPreview, leaveDemo } = useDemoSession();
  const { isPremium } = useSubscription();

  // The partner-view switcher — same predicate as the sidebar's, so the two menus
  // cannot disagree about whether there is a partner to view.
  const { isPartnerView, switchTo, switchBack } = useViewedProfile();
  const { partnerUserId, partnerLabel } = usePartnerLinkStatus();
  const showPartnerSwitch = !isDemo && !!partnerUserId;

  // The drawer stores the route it was opened on rather than a bare boolean, so it closes itself
  // the moment the route changes — covering the links inside it, the bottom tabs, the back button
  // and programmatic navigation alike, with no effect to reset it. Lifted verbatim from the "More"
  // panel this replaces.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;
  const setOpen = (next: boolean) => setOpenedAt(next ? pathname : null);

  const brandTo = isDemo ? '/' : '/dashboard';

  const menuItems = [
    { to: '/settings', icon: Settings, label: 'Settings' },
    ...(AI_ADVISOR_ENABLED ? [{ to: '/ai', icon: Sparkles, label: 'AI Advisor' }] : []),
  ];

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
      <div className="lg:hidden relative flex items-center h-12 px-2 border-b border-border bg-card">
        {/* ⚠️ TOP RIGHT, AND THAT IS JAKOB'S LAW RATHER THAN A PREFERENCE (Tre, 2026-09-06). People
            spend nearly all their time in OTHER apps and arrive carrying a model of where things
            live; Instagram — his own reference — puts the menu far top right. Every place we
            differ costs a half-second of hesitation nobody reports and we never see.
            `ml-auto` rather than `justify-end` on the row: the brand is ABSOLUTELY centred, so it
            is not a flex sibling and a `justify-*` change would silently do nothing the day
            somebody adds a second child. */}
        <button
          onClick={() => setOpen(!open)}
          aria-label="Open menu"
          aria-expanded={open}
          className={cn(
            'ml-auto flex items-center justify-center min-w-[44px] min-h-[44px] -my-0.5 transition-colors btn-press',
            open ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Menu size={20} />
        </button>

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

      {open && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-background/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            /* ⚠️ THE DRAWER MOVED WITH THE TRIGGER, and this is a judgement call worth reversing
               separately if it is wrong. A control on the RIGHT that opens a panel from the LEFT
               is a worse mismatch than either consistent arrangement — the panel appears to come
               from nowhere the finger just was. Instagram's top-right menu opens a right-hand
               sheet, which is the model the law is about. Reverse this line alone to keep the
               drawer on the left. */
            className="absolute right-0 top-0 bottom-0 w-[min(78vw,300px)] bg-card border-l border-border shadow-xl overflow-y-auto"
            style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Menu</span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="p-1 text-muted-foreground hover:text-foreground icon-btn"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-2 space-y-1">
              {showPartnerSwitch && (
                <button
                  onClick={() => {
                    setOpen(false);
                    if (isPartnerView) switchBack(); else switchTo(partnerUserId);
                  }}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-3 text-sm font-medium transition-colors btn-press w-full',
                    isPartnerView ? 'text-primary bg-primary/8' : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
                  )}
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  <Eye size={16} />
                  <span className="truncate">
                    {isPartnerView ? 'Back to my account' : `View ${partnerLabel ?? 'partner'}`}
                  </span>
                </button>
              )}
              {menuItems.map(item => {
                const active = pathname === item.to;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-3 text-sm font-medium transition-colors btn-press w-full',
                      active ? 'text-primary bg-primary/8' : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
                    )}
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    <item.icon size={16} /> {item.label}
                  </Link>
                );
              })}
            </div>

            <div className="border-t border-border px-2 pt-2 space-y-1">
              {/* Same predicate as the sidebar and the banner: a signed-in preview leaves, a
                  visitor signs up. See `useDemoSession`. */}
              {isPreview ? (
                <button
                  onClick={() => { setOpen(false); leaveDemo(); }}
                  className="flex items-center gap-2 px-3 py-3 text-sm font-semibold text-primary hover:bg-primary/8 btn-press w-full"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  ← Back to my account
                </button>
              ) : isDemo ? (
                <>
                  <Link
                    to="/auth"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 px-3 py-3 text-sm font-semibold text-primary hover:bg-primary/8 btn-press w-full"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    Sign Up Free →
                  </Link>
                  <Link
                    to="/"
                    onClick={() => setOpen(false)}
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
                      onClick={() => setOpen(false)}
                      className="flex items-center gap-2 px-3 py-3 text-sm font-medium text-foreground hover:bg-secondary btn-press w-full"
                      style={{ borderRadius: 'var(--radius)' }}
                    >
                      <Crown size={14} className="text-primary" /> Upgrade to Premium
                    </Link>
                  )}
                  <button
                    onClick={() => { setOpen(false); signOut(); }}
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
    </>
  );
}
